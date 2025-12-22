/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                   SELF-DIAGNOSTICS SUITE                      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Part of the TeamBalancer Plugin
 *
 * Runs integrity checks on the database connection and performs
 * dry-run simulations of the Scrambler to verify plugin health.
 */
import Logger from '../../core/logger.js';
import Scrambler from './tb-scrambler.js';

export class TBDiagnostics {
  constructor(teamBalancer) {
    this.tb = teamBalancer;
    this.results = [];
  }

  async runAll() {
    await this.testDatabase();
    await this.testScrambler();
    return this.results;
  }

  async testDatabase() {
    const result = { name: 'Database', pass: false, message: 'Test not run' };
    try {
      if (!this.tb.db || !this.tb.db.TeamBalancerStateModel) {
        throw new Error('Database connector or model not initialized.');
      }

      // 1. Read current state
      const initialState = await this.tb.db.TeamBalancerStateModel.findByPk(1);
      if (!initialState) {
        throw new Error('Could not find state record in database.');
      }
      const originalCount = initialState.winStreakCount;

      // 2. Write a dummy value
      const testValue = 999;
      await this.tb.db.saveState(initialState.winStreakTeam, testValue);

      // 3. Read back and verify
      const updatedState = await this.tb.db.TeamBalancerStateModel.findByPk(1);
      if (updatedState.winStreakCount !== testValue) {
        throw new Error('Dummy data write could not be verified.');
      }

      // 4. Restore original value
      await this.tb.db.saveState(initialState.winStreakTeam, originalCount);
      const restoredState = await this.tb.db.TeamBalancerStateModel.findByPk(1);
      if (restoredState.winStreakCount !== originalCount) {
        throw new Error('Could not restore original database state.');
      }

      result.pass = true;
      result.message = 'PASS';
    } catch (err) {
      result.pass = false;
      result.message = `FAIL: ${err.message}`;
      Logger.verbose('TeamBalancer', 1, `[Diagnostics] Database test failed: ${err.message}`);
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
        result.message = `SKIPPED (Low Pop: ${players.length} players)`;
        this.results.push(result);
        return;
      }

      const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
        squads,
        players,
        winStreakTeam: this.tb.winStreakTeam,
        scramblePercentage: this.tb.options.scramblePercentage,
        debug: this.tb.options.debugLogs
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