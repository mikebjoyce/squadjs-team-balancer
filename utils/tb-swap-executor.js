/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                   SWAP EXECUTION ENGINE                       ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * ─── PURPOSE ─────────────────────────────────────────────────────
 *
 * Executes team scramble swap plans via RCON. Manages a pending-move
 * queue, delegating retry/verification to S3PluginBase._requestTeamChange,
 * with session lifecycle, timeout protection, and post-execution
 * batch verification. Supports both live and dry-run (simulation) modes.
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
 * - Move is considered complete when _requestTeamChange returns success,
 *   or the player disconnects.
 * - verifyMoves() performs a post-session batch check that is independent
 *   of the per-move verification inside _requestTeamChange — double-
 *   verification is harmless and provides a final cross-check.
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
  constructor(server, options = {}, RconMessages = {}, teamBalancer = null, requestTeamChange = null) {
    this.server = server;
    this.options = options;
    this.RconMessages = RconMessages;
    this.teamBalancer = teamBalancer;
    this._requestTeamChange = requestTeamChange || null;  // Bound S3PluginBase._requestTeamChange

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
      movesSent: 0, // Incremented on each successful _requestTeamChange
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

      for (const [eosID] of this.pendingPlayerMoves.entries()) {
        try {
          // Delegate to the base class method which handles retry/verify/warn
          if (this._requestTeamChange) {
            const result = await this._requestTeamChange(eosID, {
              maxAttempts: 5,
              retryIntervalMs: this.options.changeTeamRetryInterval || 50,
              timeoutMs: this.options.maxScrambleCompletionTime || 15000,
              warnPlayer: !!this.options.warnOnSwap,
              warnMessage: this.RconMessages?.playerScrambledWarning || 'You have been scrambled',
              source: 'TeamBalancer'
            });

            if (result && result.success) {
              this.activeSession.movesSent++;
              Logger.verbose('TeamBalancer', 4, `[SwapExecutor] Move succeeded for ${eosID}`);
            } else if (result === null) {
              // Player not found — disconnected
              this.activeSession.movesSent++; // Count as "moved" since disconnected players don't need moves
              Logger.verbose('TeamBalancer', 4, `[SwapExecutor] Player ${eosID} disconnected — removing from queue.`);
            } else {
              // Failed after all retries
              this.activeSession.failedMoves++;
              Logger.verbose('TeamBalancer', 2, `[SwapExecutor] Move failed for ${eosID} after ${result.attempts} attempts.`);
            }

            playersToRemove.push(eosID);
          } else {
            Logger.verbose('TeamBalancer', 2, `[SwapExecutor] No _requestTeamChange available — cannot process ${eosID}.`);
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
        await this.teamBalancer?._s3?.players?.refreshNow('TeamBalancer');
      } catch (err) {
        Logger.verbose('TeamBalancer', 1, `[SwapExecutor] Failed to refresh player list for verification: ${err?.message || err}`);
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
        const player = (this.teamBalancer?._s3?.players?.getPlayer(eosID)) || this.server.players.find(p => p.eosID === eosID);

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

    const results = await this.verifyMoves();
    const { totalMoves, movedSuccessfully, failedToMove, disconnected } = results;
    const duration = Date.now() - this.activeSession.startTime;
    const successRate = totalMoves > 0 ? Math.round((movedSuccessfully / totalMoves) * 100) : 100;

    // Store session report for post-scramble JSON log
    this._lastSessionReport = {
      totalMoves,
      movedSuccessfully,
      failedToMove,
      disconnected,
      duration,
      successRate
    };

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

  /**
   * Returns the last session report (verification results) after completeSession runs.
   * Cleared on next queueMove. Returns null if no session has completed.
   */
  getLastSessionReport() {
    return this._lastSessionReport || null;
  }
}
