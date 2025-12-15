export default class SwapExecutor {
  constructor(server, options = {}, log = console, RconMessages = {}) {
    this.server = server;
    this.options = options;
    this.log = log || console;
    this.RconMessages = RconMessages;

    this.pendingPlayerMoves = new Map();
    this.scrambleRetryTimer = null;
    this.overallTimeout = null;
    this.activeSession = null;
  }

  async queueMove(steamID, targetTeamID, isSimulated = false) {
    if (isSimulated) {
      this.log.debug?.(`[SwapExecutor][Dry Run] Would queue ${steamID} -> ${targetTeamID}`) ||
        console.log(`[SwapExecutor][Dry Run] Would queue ${steamID} -> ${targetTeamID}`);
      return;
    }

    this.pendingPlayerMoves.set(steamID, {
      targetTeamID,
      attempts: 0,
      startTime: Date.now()
    });

    this.log.debug?.(`[SwapExecutor] Queued move for ${steamID} -> ${targetTeamID}`) ||
      console.log(`[SwapExecutor] Queued move for ${steamID} -> ${targetTeamID}`);

    if (!this.scrambleRetryTimer) this.startMonitoring();
  }

  startMonitoring() {
    this.log.debug?.('[SwapExecutor] Starting monitoring') || console.log('[SwapExecutor] Starting monitoring');

    this.activeSession = {
      startTime: Date.now(),
      totalMoves: this.pendingPlayerMoves.size,
      completedMoves: 0,
      failedMoves: 0
    };

    this.scrambleRetryTimer = setInterval(() => {
      this.processRetries().catch((err) => {
        (this.log.error || console.error)(`[SwapExecutor] Error in retry loop: ${err?.message || err}`);
        this.completeSession();
      });
    }, this.options.changeTeamRetryInterval || 200);

    this.overallTimeout = setTimeout(() => {
      this.completeSession();
    }, this.options.maxScrambleCompletionTime || 15000);
  }

  async processRetries() {
    const now = Date.now();
    const playersToRemove = [];
    const currentPlayers = this.server.players;

    for (const [steamID, moveData] of this.pendingPlayerMoves.entries()) {
      try {
        if (now - moveData.startTime > (this.options.maxScrambleCompletionTime || 15000)) {
          (this.log.warn || console.warn)(`[SwapExecutor] Move timeout for ${steamID}`);
          this.activeSession.failedMoves++;
          playersToRemove.push(steamID);
          continue;
        }

        const player = currentPlayers.find((p) => p.steamID === steamID);
        if (!player) {
          this.activeSession.completedMoves++;
          playersToRemove.push(steamID);
          continue;
        }

        moveData.attempts++;
        const maxRconAttempts = 5;

        if (moveData.attempts <= maxRconAttempts) {
          try {
            await this.server.rcon.switchTeam(steamID, moveData.targetTeamID);
            this.activeSession.completedMoves++;
            playersToRemove.push(steamID);
            if (this.options.warnOnSwap) {
              try {
                await this.server.rcon.warn(steamID, this.RconMessages.playerScrambledWarning);
              } catch (err) {
                this.log.debug?.(`[SwapExecutor] warn failed for ${steamID}: ${err}`) || console.log(err);
              }
            }
          } catch (err) {
            (this.log.warn || console.warn)(`[SwapExecutor] Move attempt ${moveData.attempts} failed for ${steamID}: ${err?.message || err}`);
            if (moveData.attempts >= maxRconAttempts) {
              this.activeSession.failedMoves++;
              playersToRemove.push(steamID);
            }
          }
        } else {
          this.activeSession.failedMoves++;
          playersToRemove.push(steamID);
        }
      } catch (err) {
        (this.log.error || console.error)(`[SwapExecutor] Error processing ${steamID}: ${err?.message || err}`);
        this.activeSession.failedMoves++;
        playersToRemove.push(steamID);
      }
    }

    for (const sid of playersToRemove) this.pendingPlayerMoves.delete(sid);

    if (this.pendingPlayerMoves.size === 0) this.completeSession();
  }

  completeSession() {
    if (!this.activeSession) return;

    const duration = Date.now() - this.activeSession.startTime;
    const { totalMoves, completedMoves, failedMoves } = this.activeSession;

    if (this.scrambleRetryTimer) {
      clearInterval(this.scrambleRetryTimer);
      this.scrambleRetryTimer = null;
    }
    if (this.overallTimeout) {
      clearTimeout(this.overallTimeout);
      this.overallTimeout = null;
    }

    const successRate = totalMoves > 0 ? Math.round((completedMoves / totalMoves) * 100) : 100;

    console.log(`[SwapExecutor] Session complete in ${duration}ms: ${completedMoves}/${totalMoves} (${successRate}%), ${failedMoves} failed`);

    if (failedMoves > 0) {
      (this.log.warn || console.warn)(`[SwapExecutor] ${failedMoves} players failed to move; manual action may be required.`);
    }

    this.pendingPlayerMoves.clear();
    this.activeSession = null;
  }

  async waitForCompletion(timeoutMs = 10000, intervalMs = 100) {
    const start = Date.now();
    while (this.pendingPlayerMoves.size > 0) {
      if (Date.now() - start > timeoutMs) {
        (this.log.warn || console.warn)(`[SwapExecutor] waitForCompletion timed out after ${timeoutMs}ms`);
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
    this.activeSession = null;
  }
}
