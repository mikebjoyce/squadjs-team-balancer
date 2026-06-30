/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                   SELF-DIAGNOSTICS SUITE                      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * ─── PURPOSE ─────────────────────────────────────────────────────
 *
 * Runs integrity checks against the live plugin instance. Verifies
 * S³ database connectivity (reachability + table count) and performs
 * a live dry-run scramble simulation against the current server
 * population.
 *
 * ─── EXPORTS ─────────────────────────────────────────────────────
 * 
 * TBDiagnostics (named)
 *   Class. Instantiate with a TeamBalancer instance.
 *     runAll()              — Runs all tests; returns Array<{ name, pass, message }>.
 *     testS3Integration()   — S³ DB reachability + model count check.
 *     testScrambler()       — Live scramble dry-run against current server state.
 *
 * ─── DEPENDENCIES ────────────────────────────────────────────────
 *
 * Logger (../../core/logger.js)
 *   Verbose logging for test failures.
 * Scrambler (./tb-scrambler.js)
 *   Invoked directly for the dry-run scramble test.
 *
 * ─── NOTES ───────────────────────────────────────────────────────
 *
 * - testS3Integration() replaces the old testDatabase() (which tried
 *   to access a non-existent model path on the S³ compatibility wrapper)
 *   and the synthetic concurrency test (which was always skipped).
 * - testScrambler() is skipped (not failed) if server population
 *   is below 10 players. Result message reflects the skip reason.
 * - Triggered by !teambalancer diag in-game or via Discord.
 *
 * Author:
 * Discord: `real_slacker`
 *
 * ═══════════════════════════════════════════════════════════════
 */

import Logger from '../../core/logger.js';
import Scrambler from './tb-scrambler.js';

export class TBDiagnostics {
  constructor(teamBalancer) {
    this.tb = teamBalancer;
    this.results = [];
  }

  async runAll() {
    await this.testS3Integration();
    await this.testScrambler();
    return this.results;
  }

  async testS3Integration() {
    const result = { name: 'S³ Integration', pass: false, message: 'Test not run' };
    try {
      const s3db = this.tb.s3db;
      if (!s3db || !s3db.isReady()) {
        throw new Error('S³ DB not reachable');
      }

      // Quick connectivity check — query the model count
      const modelNames = Object.keys(s3db.models || {});
      const tbModelNames = modelNames.filter(n => n.startsWith('TeamBalancer') || n.startsWith('TB_'));

      // Verify at least one TB model exists
      if (!tbModelNames.length) {
        throw new Error('No TeamBalancer models found on S³ connector');
      }

      // Spot-check: query TeamBalancerState to confirm read works
      const stateModel = s3db.models['TeamBalancerState'];
      if (stateModel) {
        const count = await s3db.withTransactionWithRetry(async () => {
          return await stateModel.count();
        });
      }

      const tableCount = tbModelNames.length;
      result.pass = true;
      result.message = `PASS (S³ connected, ${tableCount} TB table${tableCount !== 1 ? 's' : ''})`;
    } catch (err) {
      result.pass = false;
      result.message = `FAIL: ${err.message}`;
      Logger.verbose('TeamBalancer', 1, `[Diagnostics] S³ Integration test failed: ${err.message}`);
    }
    this.results.push(result);
  }

  async testScrambler() {
    const result = { name: 'Live Scramble Test', pass: false, message: 'Test not run' };
    try {
      const { squads, players } = this.tb.transformSquadJSData(
        this.tb.server.squads,
        this.tb.server.players
      );

      if (players.length < 10) {
        result.pass = true; // Not a failure, just not enough players
        result.message = `SKIPPED (${players.length} players — need ≥ 10)`;
        this.results.push(result);
        return;
      }

      const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
        squads,
        players,
        winStreakTeam: this.tb.winStreakTeam,
        scramblePercentage: this.tb.options.scramblePercentage,
      });

      if (swapPlan && Array.isArray(swapPlan)) {
        result.pass = true;
        result.message = `SUCCESS (${swapPlan.length} moves calculated)`;
      } else {
        throw new Error('Scrambler did not return a valid swap plan.');
      }
    } catch (err) {
      result.pass = false;
      result.message = `FAIL: ${err.message}`;
      Logger.verbose('TeamBalancer', 1, `[Diagnostics] Scrambler test failed: ${err.message}`);
    }
    this.results.push(result);
  }
}