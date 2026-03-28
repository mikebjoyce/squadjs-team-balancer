/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                   SWAP EXECUTION ENGINE                       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Part of the TeamBalancer Plugin
 *
 * This class is responsible for the execution of team scramble plans. It manages a queue of
 * player moves, handling RCON commands with retry logic, timeout protection, and error handling.
 * It supports both "dry runs" (simulation) and live execution, and provides real-time feedback
 * to Discord via the DiscordHelpers module upon completion.
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
      completedMoves: 0,
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
            this.activeSession.completedMoves++;
            playersToRemove.push(eosID);
            continue;
          }

          // Check if player is already on the target team to prevent RCON spam
          if (String(player.teamID) === String(moveData.targetTeamID)) {
            this.activeSession.completedMoves++;
            playersToRemove.push(eosID);
            continue;
          }

          moveData.attempts++;
          const maxRconAttempts = 5;

          if (moveData.attempts <= maxRconAttempts) {
            try {
              const rconIdentifier = player?.steamID ?? player?.name;
              if (!player?.steamID) {
                Logger.verbose('TeamBalancer', 1, 
                  `[SwapExecutor] No steamID for ${eosID}, falling back to name: ${player?.name}`);
              }
              await this.server.rcon.switchTeam(rconIdentifier, moveData.targetTeamID);
              this.activeSession.completedMoves++;
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

  async verifyMoves() {
    try {
      await this.server.updatePlayerList();
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[SwapExecutor] Failed to update player list for verification: ${err?.message || err}`);
      // Fall back to current counts if update fails
      return {
        totalMoves: this.activeSession.totalMoves,
        movedSuccessfully: this.activeSession.completedMoves,
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
    if (!this.activeSession) return;

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
