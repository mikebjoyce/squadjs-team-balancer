/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                   SWAP EXECUTION ENGINE                       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * ─── PURPOSE ─────────────────────────────────────────────────────
 *
 * Executes team scramble swap plans via RCON. Manages a pending-move
 * queue with retry logic, timeout protection, and post-execution
 * verification. Supports both live and dry-run (simulation) modes.
 *
 * ─── EXPORTS ─────────────────────────────────────────────────────
 *
 * SwapExecutor (default)
 *   Class. Key public methods:
 *     queueMove(eosID, targetTeamID, isSimulated) — Add a player to the move queue.
 *     waitForCompletion(timeoutMs, intervalMs)     — Await queue drain or timeout.
 *     cleanup()                                    — Cancel timers and clear all state.
 *
 * ─── DEPENDENCIES ────────────────────────────────────────────────
 *
 * Logger (../../core/logger.js)
 *   Verbose logging for move attempts, retries, and session summary.
 * DiscordHelpers (./tb-discord-helpers.js)
 *   Sends scramble-completed embed to Discord on session end.
 *
 * ─── NOTES ───────────────────────────────────────────────────────
 *
 * - Queue is processed on a setInterval at changeTeamRetryInterval ms.
 *   A separate setTimeout enforces the maxScrambleCompletionTime hard cap.
 * - Move is considered complete when the player is observed on the
 *   correct team, or when they disconnect (counted separately).
 * - RCON identifier prefers steamID, falls back to player name with a
 *   warning log. Max 5 RCON attempts per player before marking failed.
 * - verifyMoves() calls server.updatePlayerList() before checking final
 *   team positions. Falls back to session counters if the update fails.
 * - cleanup() is safe to call at any time; idempotent.
 *
 * Author:
 * Discord: `real_slacker`
 *
 * ═══════════════════════════════════════════════════════════════
 */

import Logger from '../../core/logger.js';
import { DiscordHelpers } from './tb-discord-helpers.js';

export default class SwapExecutor {
  constructor(server, options = {}, RconMessages = {}, teamBalancer = null) {
    this.server = server;
    this.options = options;
    this.RconMessages = RconMessages;
    this.teamBalancer = teamBalancer;

    this.pendingPlayerMoves = new Map();
    this.scrambleRetryTimer = null;
    this.overallTimeout = null;
    this.activeSession = null;
    this.isProcessing = false;
    this._completing = false; // Atomic lock to prevent duplicate verifyMoves() calls
    this.sessionMoves = new Map(); // Track all moves for verification
  }

  async queueMove(eosID, targetTeamID, isSimulated = false) {
    if (isSimulated) {
      Logger.verbose('TeamBalancer', 4, `[SwapExecutor][Dry Run] Would queue ${eosID} -> ${targetTeamID}`);
      return;
    }

    this.pendingPlayerMoves.set(eosID, {
      targetTeamID,
      attempts: 0,
      startTime: Date.now()
    });

    this.sessionMoves.set(eosID, { targetTeamID });

    Logger.verbose('TeamBalancer', 4, `[SwapExecutor] Queued move for ${eosID} -> ${targetTeamID}`);

    if (!this.scrambleRetryTimer) {
      this.startMonitoring();
    } else if (this.activeSession) {
      this.activeSession.totalMoves++;
    }
  }

  startMonitoring() {
    Logger.verbose('TeamBalancer', 4, '[SwapExecutor] Starting monitoring');

    this.activeSession = {
      startTime: Date.now(),
      totalMoves: this.pendingPlayerMoves.size,
      movesSent: 0, // Counts RCON sends, used only as a fallback for verifyMoves
      failedMoves: 0
    };

    this.scrambleRetryTimer = setInterval(() => {
      this.processRetries().catch((err) => {
        Logger.verbose('TeamBalancer', 1, `[SwapExecutor] Error in retry loop: ${err?.message || err}`);
        this.completeSession();
      });
    }, this.options.changeTeamRetryInterval || 50);

    this.overallTimeout = setTimeout(() => {
      this.completeSession();
    }, this.options.maxScrambleCompletionTime || 15000);
  }

  async processRetries() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = Date.now();
      const playersToRemove = [];
      const currentPlayers = this.server.players;

      for (const [eosID, moveData] of this.pendingPlayerMoves.entries()) {
        try {
          if (now - moveData.startTime > (this.options.maxScrambleCompletionTime || 15000)) {
            Logger.verbose('TeamBalancer', 1, `[SwapExecutor] Move timeout for ${eosID}`);
            this.activeSession.failedMoves++;
            playersToRemove.push(eosID);
            continue;
          }

          const player = currentPlayers.find((p) => p.eosID === eosID);
          if (!player) {
            this.activeSession.movesSent++;
            playersToRemove.push(eosID);
            continue;
          }

          // Check if player is already on the target team to prevent RCON spam
          if (String(player.teamID) === String(moveData.targetTeamID)) {
            this.activeSession.movesSent++;
            playersToRemove.push(eosID);
            continue;
          }

          moveData.attempts++;
          const maxRconAttempts = 5;

          if (moveData.attempts <= maxRconAttempts) {
            try {
              const rconIdentifier = player?.steamID || player?.name;
              if (!player?.steamID) {
                Logger.verbose('TeamBalancer', 1, 
                  `[SwapExecutor] No steamID for ${eosID}, falling back to name: ${player?.name}`);
              }
              await this.server.rcon.switchTeam(rconIdentifier, moveData.targetTeamID);
              this.activeSession.movesSent++;
              playersToRemove.push(eosID);
              if (this.options.warnOnSwap) {
                try {
                  await this.server.rcon.warn(rconIdentifier, this.RconMessages.playerScrambledWarning);
                } catch (err) { Logger.verbose('TeamBalancer', 4, `[SwapExecutor] warn failed for ${eosID}: ${err}`); }
              }
            } catch (err) {
              Logger.verbose('TeamBalancer', 2, `[SwapExecutor] Move attempt ${moveData.attempts} failed for ${eosID}: ${err?.message || err}`);
              if (moveData.attempts >= maxRconAttempts) {
                this.activeSession.failedMoves++;
                playersToRemove.push(eosID);
              }
            }
          } else {
            this.activeSession.failedMoves++;
            playersToRemove.push(eosID);
          }
        } catch (err) {
          Logger.verbose('TeamBalancer', 1, `[SwapExecutor] Error processing ${eosID}: ${err?.message || err}`);
          this.activeSession.failedMoves++;
          playersToRemove.push(eosID);
        }
      }

      for (const sid of playersToRemove) this.pendingPlayerMoves.delete(sid);

      if (this.pendingPlayerMoves.size === 0) this.completeSession();
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Verifies that players actually ended up on their intended teams.
   * This fetches the live player list from the server after RCON moves are complete,
   * tallying successes/failures, and producing a report to ensure no silent failures.
   */
  async verifyMoves() {
    try {
      await this.server.updatePlayerList();
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[SwapExecutor] Failed to update player list for verification: ${err?.message || err}`);
      // Fall back to current counts if update fails
      return {
        totalMoves: this.activeSession.totalMoves,
        movedSuccessfully: this.activeSession.movesSent,
        failedToMove: this.activeSession.failedMoves,
        disconnected: 0
      };
    }

    const verified = { moved: 0, failed: 0, disconnected: 0 };

    for (const [eosID, moveData] of this.sessionMoves.entries()) {
      const player = this.server.players.find(p => p.eosID === eosID);

      if (!player) {
        verified.disconnected++; // Player disconnected
      } else if (String(player.teamID) === String(moveData.targetTeamID)) {
        verified.moved++; // Successfully on correct team
      } else {
        verified.failed++; // Still on wrong team
      }
    }

    Logger.verbose('TeamBalancer', 2, `[SwapExecutor][Verification] ${verified.moved} moved, ${verified.disconnected} disconnected, ${verified.failed} failed (${this.sessionMoves.size} total)`);

    return {
      totalMoves: this.sessionMoves.size,
      movedSuccessfully: verified.moved,
      failedToMove: verified.failed,
      disconnected: verified.disconnected
    };
  }

  async completeSession() {
    if (!this.activeSession || this._completing) return;
    this._completing = true;

    if (this.scrambleRetryTimer) {
      clearInterval(this.scrambleRetryTimer);
      this.scrambleRetryTimer = null;
    }
    if (this.overallTimeout) {
      clearTimeout(this.overallTimeout);
      this.overallTimeout = null;
    }

    const { totalMoves, movedSuccessfully, failedToMove, disconnected } = await this.verifyMoves();
    const duration = Date.now() - this.activeSession.startTime;
    const successRate = totalMoves > 0 ? Math.round((movedSuccessfully / totalMoves) * 100) : 100;

    Logger.verbose('TeamBalancer', 2, `[SwapExecutor] Session complete in ${duration}ms: ${movedSuccessfully} moved, ${disconnected} disconnected, ${failedToMove} failed (${totalMoves} total, ${successRate}%)`);

    if (failedToMove > 0) {
      Logger.verbose('TeamBalancer', 1, `[SwapExecutor] ${failedToMove} players failed to move; manual action may be required.`);
    }

    if (this.teamBalancer && this.teamBalancer.discordChannel) {
      const embed = DiscordHelpers.buildScrambleCompletedEmbed(
        totalMoves,
        movedSuccessfully,
        failedToMove,
        disconnected,
        duration
      );
      DiscordHelpers.sendDiscordMessage(this.teamBalancer.discordChannel, { embeds: [embed] });
    }

    this.pendingPlayerMoves.clear();
    this.sessionMoves.clear(); 
    this.activeSession = null;
    this._completing = false;
  }

  async waitForCompletion(timeoutMs = 10000, intervalMs = 100) {
    const start = Date.now();
    while (this.pendingPlayerMoves.size > 0) {
      if (Date.now() - start > timeoutMs) {
        Logger.verbose('TeamBalancer', 1, `[SwapExecutor] waitForCompletion timed out after ${timeoutMs}ms`);
        break;
      }
      await new Promise((res) => setTimeout(res, intervalMs));
    }
  }

  cleanup() {
    if (this.scrambleRetryTimer) {
      clearInterval(this.scrambleRetryTimer);
      this.scrambleRetryTimer = null;
    }
    if (this.overallTimeout) {
      clearTimeout(this.overallTimeout);
      this.overallTimeout = null;
    }
    this.pendingPlayerMoves.clear();
    this.sessionMoves.clear(); 
    this.activeSession = null;
  }
}
