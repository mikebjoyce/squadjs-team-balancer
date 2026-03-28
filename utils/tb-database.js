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
  static STALE_CUTOFF_MS = 2.5 * 60 * 60 * 1000;

  constructor(server, options, connectors) {
    this.sequelize = connectors && connectors.sqlite;
    this.TeamBalancerStateModel = null;
  }

  async _executeWithRetry(logicFn, attempts = 5) {
    const runAttempt = async () => {
      for (let i = 1; i <= attempts; i++) {
        try {
          return await logicFn();
        } catch (err) {
          const isLocked = err.message && (
            err.message.includes('SQLITE_BUSY') || 
            err.message.includes('database is locked') ||
            err.name === 'SequelizeTimeoutError'
          );
          if (isLocked && i < attempts) {
            const jitter = Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, 200 + jitter));
          } else {
            throw err;
          }
        }
      }
    };

    if (this.sequelize && typeof this.sequelize.getDialect === 'function' && this.sequelize.getDialect() === 'sqlite') {
      if (!this.sequelize._squadjs_mutex) {
        this.sequelize._squadjs_mutex = Promise.resolve();
      }
      
      const resultPromise = this.sequelize._squadjs_mutex.then(() => runAttempt());
      this.sequelize._squadjs_mutex = resultPromise.catch(() => {});
      return resultPromise;
    }

    return runAttempt();
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
          lastScrambleTime: { type: DataTypes.BIGINT, allowNull: true },
          consecutiveWinsTeam: { type: DataTypes.INTEGER, allowNull: true },
          consecutiveWinsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          manuallyDisabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
        },
        { timestamps: false, tableName: 'TeamBalancerState' }
      );

      await this.TeamBalancerStateModel.sync({ alter: true });

      return await this._executeWithRetry(async () => {
        return await this.sequelize.transaction(async (t) => {
        const [record] = await this.TeamBalancerStateModel.findOrCreate({
          where: { id: 1 },
          defaults: {
            winStreakTeam: null,
            winStreakCount: 0,
            lastSyncTimestamp: Date.now(),
            lastScrambleTime: null,
            consecutiveWinsTeam: null,
            consecutiveWinsCount: 0,
            manuallyDisabled: false
          },
          transaction: t
        });

        const isStale = !record.lastSyncTimestamp || Date.now() - record.lastSyncTimestamp > TBDatabase.STALE_CUTOFF_MS;

        if (!isStale) {
          Logger.verbose('TeamBalancer', 4, `[DB] Restored state: team=${record.winStreakTeam}, count=${record.winStreakCount}`);
          return {
            winStreakTeam: record.winStreakTeam,
            winStreakCount: record.winStreakCount,
            lastSyncTimestamp: record.lastSyncTimestamp,
            lastScrambleTime: record.lastScrambleTime,
            isStale: false,
            consecutiveWinsTeam: record.consecutiveWinsTeam,
            consecutiveWinsCount: record.consecutiveWinsCount,
            manuallyDisabled: record.manuallyDisabled
          };
        }

        Logger.verbose('TeamBalancer', 4, '[DB] State stale; resetting.');
        const lastScrambleTime = record.lastScrambleTime;
        record.winStreakTeam = null;
        record.winStreakCount = 0;
        record.lastSyncTimestamp = Date.now();
        record.consecutiveWinsTeam = null;
        record.consecutiveWinsCount = 0;
        await record.save({ transaction: t });

        return {
          winStreakTeam: null,
          winStreakCount: 0,
          lastSyncTimestamp: record.lastSyncTimestamp,
          lastScrambleTime,
          isStale: true,
          consecutiveWinsTeam: null,
          consecutiveWinsCount: 0,
          manuallyDisabled: false
        };
      });
      });
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] initDB failed: ${err.message}`);
      return {
        winStreakTeam: null,
        winStreakCount: 0,
        lastSyncTimestamp: null,
        lastScrambleTime: null,
        isStale: true,
        consecutiveWinsTeam: null,
        consecutiveWinsCount: 0,
        manuallyDisabled: false
      };
    }
  }

  async saveState(team, count, conTeam = null, conCount = 0) {
    if (!this.TeamBalancerStateModel) {
      Logger.verbose('TeamBalancer', 1, '[DB] saveState called before initDB.');
      return null;
    }

    try {
      return await this._executeWithRetry(async () => {
        return await this.sequelize.transaction(async (t) => {
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
          record.consecutiveWinsTeam = conTeam;
          record.consecutiveWinsCount = conCount;
          await record.save({ transaction: t });
          Logger.verbose('TeamBalancer', 4, `[DB] Updated: team=${team}, count=${count}`);
          return {
            winStreakTeam: record.winStreakTeam,
            winStreakCount: record.winStreakCount,
            lastSyncTimestamp: record.lastSyncTimestamp,
            lastScrambleTime: record.lastScrambleTime,
            consecutiveWinsTeam: record.consecutiveWinsTeam,
            consecutiveWinsCount: record.consecutiveWinsCount
          };
        });
      });
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] saveState failed: ${err.message}`);
      return null;
    }
  }

  async incrementStreak(winnerID, conTeam, conCount) {
    try {
      return await this._executeWithRetry(async () => {
        return await this.sequelize.transaction(async (t) => {
        const record = await this.TeamBalancerStateModel.findByPk(1, { transaction: t });
        
        if (!record) return null;

        if (record.winStreakTeam === winnerID) {
          record.winStreakCount += 1;
        } else {
          record.winStreakTeam = winnerID;
          record.winStreakCount = 1;
        }

        record.lastSyncTimestamp = Date.now();
        record.consecutiveWinsTeam = conTeam;
        record.consecutiveWinsCount = conCount;
        await record.save({ transaction: t });
        
        return {
          winStreakTeam: record.winStreakTeam,
          winStreakCount: record.winStreakCount,
          lastSyncTimestamp: record.lastSyncTimestamp,
          consecutiveWinsTeam: record.consecutiveWinsTeam,
          consecutiveWinsCount: record.consecutiveWinsCount
        };
      });
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
        promises.push(this.incrementStreak(1, null, 0));
      }
      
      const results = await Promise.all(promises);
      const successCount = results.filter(r => r !== null).length;

      // 4. Verify
      const finalRecord = await this.TeamBalancerStateModel.findByPk(1);
      const finalCount = finalRecord ? finalRecord.winStreakCount : -1;

      // 5. Restore
      if (originalState) {
        await this.saveState(
          originalState.winStreakTeam,
          originalState.winStreakCount,
          originalState.consecutiveWinsTeam,
          originalState.consecutiveWinsCount
        );
      }

      return finalCount === successCount
        ? { success: true, message: `PASS (${successCount}/${iterations} txs committed)` }
        : { success: false, message: `FAIL (Committed: ${finalCount}, Expected: ${successCount})` };
    } catch (err) {
      if (originalState) await this.saveState(
        originalState.winStreakTeam,
        originalState.winStreakCount,
        originalState.consecutiveWinsTeam,
        originalState.consecutiveWinsCount
      );
      return { success: false, message: `Error: ${err.message}` };
    }
  }

  async saveScrambleTime(timestamp) {
    if (!this.TeamBalancerStateModel) {
      Logger.verbose('TeamBalancer', 1, '[DB] saveScrambleTime called before initDB.');
      return null;
    }

    try {
      return await this._executeWithRetry(async () => {
        return await this.sequelize.transaction(async (t) => {
          const record = await this.TeamBalancerStateModel.findByPk(1, {
            transaction: t
          });
          if (!record) return null;
          record.lastScrambleTime = timestamp;
          await record.save({ transaction: t });
          Logger.verbose('TeamBalancer', 4, `[DB] Updated lastScrambleTime: ${timestamp}`);
          return { lastScrambleTime: record.lastScrambleTime };
        });
      });
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] saveScrambleTime failed: ${err.message}`);
      return null;
    }
  }

  async saveManuallyDisabledState(disabled) {
    if (!this.TeamBalancerStateModel) {
      Logger.verbose('TeamBalancer', 1, '[DB] saveManuallyDisabledState called before initDB.');
      return null;
    }

    try {
      return await this._executeWithRetry(async () => {
        return await this.sequelize.transaction(async (t) => {
          const record = await this.TeamBalancerStateModel.findByPk(1, {
            transaction: t
          });
          if (!record) return null;
          record.manuallyDisabled = disabled;
          await record.save({ transaction: t });
          Logger.verbose('TeamBalancer', 4, `[DB] Updated manuallyDisabled: ${disabled}`);
          return { manuallyDisabled: record.manuallyDisabled };
        });
      });
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] saveManuallyDisabledState failed: ${err.message}`);
      return null;
    }
  }
}
