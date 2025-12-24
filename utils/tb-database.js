/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                     PERSISTENCE LAYER                         ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Part of the TeamBalancer Plugin
 *
 * This class manages the persistence layer for the TeamBalancer plugin using Sequelize (SQLite).
 * It handles saving and restoring critical state data such as win streaks, team IDs, and timestamps
 * across server restarts. It ensures data integrity by checking for stale state upon initialization
 * and provides methods for the main plugin instance to update persistent records.
 */

import Sequelize from 'sequelize';
import Logger from '../../core/logger.js';
const { DataTypes } = Sequelize;

export default class TBDatabase {
  constructor(server, options, connectors) {
    this.sequelize = connectors && connectors.sqlite;
    this.TeamBalancerStateModel = null;
  }

  async initDB() {
    try {
      if (!this.sequelize) {
        Logger.verbose('TeamBalancer', 1, '[DB] No sequelize connector available.');
        return { winStreakTeam: null, winStreakCount: 0, lastSyncTimestamp: null, lastScrambleTime: null, isStale: true };
      }

      this.TeamBalancerStateModel = this.sequelize.define(
        'TeamBalancerState',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: false, defaultValue: 1 },
          winStreakTeam: { type: DataTypes.INTEGER, allowNull: true },
          winStreakCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          lastSyncTimestamp: { type: DataTypes.BIGINT, allowNull: true },
          lastScrambleTime: { type: DataTypes.BIGINT, allowNull: true }
        },
        { timestamps: false, tableName: 'TeamBalancerState' }
      );

      await this.TeamBalancerStateModel.sync({ alter: true });

      return await this.sequelize.transaction({ type: Sequelize.Transaction.TYPES.IMMEDIATE }, async (t) => {
        const [record] = await this.TeamBalancerStateModel.findOrCreate({
          where: { id: 1 },
          defaults: {
            winStreakTeam: null,
            winStreakCount: 0,
            lastSyncTimestamp: Date.now(),
            lastScrambleTime: null
          },
          transaction: t
        });

        const staleCutoff = 2.5 * 60 * 60 * 1000;
        const isStale = !record.lastSyncTimestamp || Date.now() - record.lastSyncTimestamp > staleCutoff;

        if (!isStale) {
          Logger.verbose('TeamBalancer', 4, `[DB] Restored state: team=${record.winStreakTeam}, count=${record.winStreakCount}`);
          return {
            winStreakTeam: record.winStreakTeam,
            winStreakCount: record.winStreakCount,
            lastSyncTimestamp: record.lastSyncTimestamp,
            lastScrambleTime: record.lastScrambleTime,
            isStale: false
          };
        }

        Logger.verbose('TeamBalancer', 4, '[DB] State stale; resetting.');
        const lastScrambleTime = record.lastScrambleTime;
        record.winStreakTeam = null;
        record.winStreakCount = 0;
        record.lastSyncTimestamp = Date.now();
        await record.save({ transaction: t });

        return {
          winStreakTeam: null,
          winStreakCount: 0,
          lastSyncTimestamp: record.lastSyncTimestamp,
          lastScrambleTime,
          isStale: true
        };
      });
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] initDB failed: ${err.message}`);
      return { winStreakTeam: null, winStreakCount: 0, lastSyncTimestamp: null, lastScrambleTime: null, isStale: true };
    }
  }

  async saveState(team, count) {
    try {
      if (!this.TeamBalancerStateModel) {
        Logger.verbose('TeamBalancer', 1, '[DB] saveState called before initDB.');
        return null;
      }
      return await this.sequelize.transaction({ type: Sequelize.Transaction.TYPES.IMMEDIATE }, async (t) => {
        const record = await this.TeamBalancerStateModel.findByPk(1, {
          transaction: t
        });
        if (!record) {
          Logger.verbose('TeamBalancer', 1, '[DB] saveState: state record missing.');
          return null;
        }
        record.winStreakTeam = team;
        record.winStreakCount = count;
        record.lastSyncTimestamp = Date.now();
        await record.save({ transaction: t });
        Logger.verbose('TeamBalancer', 4, `[DB] Updated: team=${team}, count=${count}`);
        return {
          winStreakTeam: record.winStreakTeam,
          winStreakCount: record.winStreakCount,
          lastSyncTimestamp: record.lastSyncTimestamp,
          lastScrambleTime: record.lastScrambleTime
        };
      });
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] saveState failed: ${err.message}`);
      return null;
    }
  }

  async incrementStreak(winnerID) {
    try {
      return await this.sequelize.transaction({
        type: Sequelize.Transaction.TYPES.IMMEDIATE
      }, async (t) => {
        const record = await this.TeamBalancerStateModel.findByPk(1, { transaction: t });
        
        if (!record) return null;

        if (record.winStreakTeam === winnerID) {
          record.winStreakCount += 1;
        } else {
          record.winStreakTeam = winnerID;
          record.winStreakCount = 1;
        }

        record.lastSyncTimestamp = Date.now();
        await record.save({ transaction: t });
        
        return {
          winStreakTeam: record.winStreakTeam,
          winStreakCount: record.winStreakCount,
          lastSyncTimestamp: record.lastSyncTimestamp
        };
      });
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] incrementStreak failed: ${err.message}`);
      return null;
    }
  }

  async runConcurrencyTest() {
    Logger.verbose('TeamBalancer', 1, '[DB] Starting concurrency test...');
    let originalState = null;
    try {
      // 1. Backup current state
      originalState = await this.TeamBalancerStateModel.findByPk(1);
      
      // 2. Reset to known state (Team 1, Count 0)
      if (!await this.saveState(1, 0)) throw new Error("Setup saveState failed");

      // 3. Run parallel increments
      const iterations = 5;
      const promises = [];
      for (let i = 0; i < iterations; i++) {
        promises.push(this.incrementStreak(1));
      }
      
      const results = await Promise.all(promises);
      const successCount = results.filter(r => r !== null).length;

      // 4. Verify
      const finalRecord = await this.TeamBalancerStateModel.findByPk(1);
      const finalCount = finalRecord ? finalRecord.winStreakCount : -1;

      // 5. Restore
      if (originalState) await this.saveState(originalState.winStreakTeam, originalState.winStreakCount);

      return finalCount === successCount
        ? { success: true, message: `Passed (${successCount}/${iterations} txs committed).` }
        : { success: false, message: `Failed. Committed: ${finalCount}, Expected: ${successCount}.` };
    } catch (err) {
      if (originalState) await this.saveState(originalState.winStreakTeam, originalState.winStreakCount);
      return { success: false, message: `Error: ${err.message}` };
    }
  }

  async saveScrambleTime(timestamp) {
    try {
      if (!this.TeamBalancerStateModel) {
        Logger.verbose('TeamBalancer', 1, '[DB] saveScrambleTime called before initDB.');
        return null;
      }
      return await this.sequelize.transaction({ type: Sequelize.Transaction.TYPES.IMMEDIATE }, async (t) => {
        const record = await this.TeamBalancerStateModel.findByPk(1, {
          transaction: t
        });
        if (!record) return null;
        record.lastScrambleTime = timestamp;
        await record.save({ transaction: t });
        Logger.verbose('TeamBalancer', 4, `[DB] Updated lastScrambleTime: ${timestamp}`);
        return { lastScrambleTime: record.lastScrambleTime };
      });
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] saveScrambleTime failed: ${err.message}`);
      return null;
    }
  }
}
