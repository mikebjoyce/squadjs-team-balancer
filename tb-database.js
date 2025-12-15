import Sequelize from 'sequelize';
const { DataTypes } = Sequelize;

export default class TBDatabase extends BasePlugin {
  constructor(server, options, connectors) {
    super(server, options, connectors);
    this.sequelize = connectors && connectors.sqlite;
    this.TeamBalancerStateModel = null;
  }

  // Initialize DB and return plain state object. Accepts an external logger.
  async initDB(logger) {
    try {
      if (!this.sequelize) {
        logger?.warn('[DB] No sequelize connector available.');
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
        logger?.debug(`[DB] Restored state: team=${record.winStreakTeam}, count=${record.winStreakCount}`);
        return {
          winStreakTeam: record.winStreakTeam,
          winStreakCount: record.winStreakCount,
          lastSyncTimestamp: record.lastSyncTimestamp,
          lastScrambleTime: record.lastScrambleTime,
          isStale: false
        };
      }

      // If stale, reset streak but preserve lastScrambleTime
      logger?.debug('[DB] State stale; resetting.');
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
      logger?.warn(`[DB] initDB failed: ${err.message}`);
      return { winStreakTeam: null, winStreakCount: 0, lastSyncTimestamp: null, lastScrambleTime: null, isStale: true };
    }
  }

  // Save win-streak state and return plain object representation
  async saveState(team, count, logger) {
    try {
      if (!this.TeamBalancerStateModel) {
        logger?.warn('[DB] saveState called before initDB.');
        return null;
      }
      const record = await this.TeamBalancerStateModel.findByPk(1);
      if (!record) {
        logger?.warn('[DB] saveState: state record missing.');
        return null;
      }
      record.winStreakTeam = team;
      record.winStreakCount = count;
      record.lastSyncTimestamp = Date.now();
      await record.save();
      logger?.debug(`[DB] Updated: team=${team}, count=${count}`);
      return {
        winStreakTeam: record.winStreakTeam,
        winStreakCount: record.winStreakCount,
        lastSyncTimestamp: record.lastSyncTimestamp,
        lastScrambleTime: record.lastScrambleTime
      };
    } catch (err) {
      logger?.warn(`[DB] saveState failed: ${err.message}`);
      return null;
    }
  }

  // Save last scramble timestamp and return plain object
  async saveScrambleTime(timestamp, logger) {
    try {
      if (!this.TeamBalancerStateModel) {
        logger?.warn('[DB] saveScrambleTime called before initDB.');
        return null;
      }
      const record = await this.TeamBalancerStateModel.findByPk(1);
      if (!record) return null;
      record.lastScrambleTime = timestamp;
      await record.save();
      logger?.debug(`[DB] Updated lastScrambleTime: ${timestamp}`);
      return { lastScrambleTime: record.lastScrambleTime };
    } catch (err) {
      logger?.warn(`[DB] saveScrambleTime failed: ${err.message}`);
      return null;
    }
  }
}
