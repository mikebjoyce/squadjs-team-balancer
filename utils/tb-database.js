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

      const [record] = await this.TeamBalancerStateModel.findOrCreate({
        where: { id: 1 },
        defaults: {
          winStreakTeam: null,
          winStreakCount: 0,
          lastSyncTimestamp: Date.now(),
          lastScrambleTime: null
        }
      });

      const staleCutoff = 2.5 * 60 * 60 * 1000;
      const isStale = !record.lastSyncTimestamp || Date.now() - record.lastSyncTimestamp > staleCutoff;

      if (!isStale) {
        if (this.options?.debugLogs) Logger.verbose('TeamBalancer', 4, `[DB] Restored state: team=${record.winStreakTeam}, count=${record.winStreakCount}`);
        return {
          winStreakTeam: record.winStreakTeam,
          winStreakCount: record.winStreakCount,
          lastSyncTimestamp: record.lastSyncTimestamp,
          lastScrambleTime: record.lastScrambleTime,
          isStale: false
        };
      }

      if (this.options?.debugLogs) Logger.verbose('TeamBalancer', 4, '[DB] State stale; resetting.');
      const lastScrambleTime = record.lastScrambleTime;
      record.winStreakTeam = null;
      record.winStreakCount = 0;
      record.lastSyncTimestamp = Date.now();
      await record.save();

      return {
        winStreakTeam: null,
        winStreakCount: 0,
        lastSyncTimestamp: record.lastSyncTimestamp,
        lastScrambleTime,
        isStale: true
      };
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
      const record = await this.TeamBalancerStateModel.findByPk(1);
      if (!record) {
        Logger.verbose('TeamBalancer', 1, '[DB] saveState: state record missing.');
        return null;
      }
      record.winStreakTeam = team;
      record.winStreakCount = count;
      record.lastSyncTimestamp = Date.now();
      await record.save();
      if (this.options?.debugLogs) Logger.verbose('TeamBalancer', 4, `[DB] Updated: team=${team}, count=${count}`);
      return {
        winStreakTeam: record.winStreakTeam,
        winStreakCount: record.winStreakCount,
        lastSyncTimestamp: record.lastSyncTimestamp,
        lastScrambleTime: record.lastScrambleTime
      };
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] saveState failed: ${err.message}`);
      return null;
    }
  }

  async saveScrambleTime(timestamp) {
    try {
      if (!this.TeamBalancerStateModel) {
        Logger.verbose('TeamBalancer', 1, '[DB] saveScrambleTime called before initDB.');
        return null;
      }
      const record = await this.TeamBalancerStateModel.findByPk(1);
      if (!record) return null;
      record.lastScrambleTime = timestamp;
      await record.save();
      if (this.options?.debugLogs) Logger.verbose('TeamBalancer', 4, `[DB] Updated lastScrambleTime: ${timestamp}`);
      return { lastScrambleTime: record.lastScrambleTime };
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] saveScrambleTime failed: ${err.message}`);
      return null;
    }
  }
}
