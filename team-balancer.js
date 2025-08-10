import BasePlugin from './base-plugin.js';
import Sequelize from 'sequelize';
const { DataTypes } = Sequelize;

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                      TEAM BALANCER PLUGIN                     ║
 * ║             SquadJS Plugin for Fair Match Enforcement         ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * OVERVIEW:
 * Tracks dominant win streaks and rebalances teams using a squad-preserving
 * scramble algorithm. Designed for Squad servers to avoid steamrolling,
 * reduce churn, and maintain match fairness over time.
 *
 * Scramble execution swaps entire squads or unassigned players, balancing
 * team sizes while respecting the 50-player cap and preserving squad cohesion.
 * Includes dry-run mode for safe simulation, configurable thresholds, and
 * fallback logic for emergency breaking if needed.
 *
 * CORE FEATURES:
 * - Detects dominant win streaks based on ticket difference thresholds.
 * - Triggers automatic or manual squad-preserving scrambles.
 * - Supports real-time diagnostics and dry-run simulation via chat.
 * - Sends warning messages to swapped players (optional).
 * - Logs all actions with verbose debug output (configurable).
 * - Reliable swap system with retry mechanism for failed moves.
 * - Option to use generic "Team 1" and "Team 2" names in broadcasts.
 *
 * SCRAMBLE STRATEGY:
 * - Uses randomized backtracking to select balanced swap sets.
 * - Applies swap actions through RCON using SquadJS interfaces.
 * - Tracks and retries failed swaps over configurable timeouts.
 * - Fills or trims teams after swaps to achieve near 50-player parity.
 * - Breaks squads only if necessary to enforce hard team caps.
 *
 * INSTALLATION:
 * Add this to your `config.json` plugins array:
 *

  "connectors": {
    "sqlite": {
      "dialect": "sqlite",
      "storage": "squad-server.sqlite"
    }
  },
  
 ...
 
    {
      "plugin": "TeamBalancer",
      "enabled": true,
      "database": "sqlite",
      "enableWinStreakTracking": true,
      "maxWinStreak": 2,
      "minTicketsToCountAsDominantWin": 150,
      "invasionAttackTeamThreshold": 300,
      "invasionDefenceTeamThreshold": 650,
      "scrambleAnnouncementDelay": 12,
      "scramblePercentage": 0.5,
      "changeTeamRetryInterval": 200,
      "maxScrambleCompletionTime": 15000,
      "showWinStreakMessages": true,
      "warnOnSwap": true,
      "useGenericTeamNamesInBroadcasts": false,
      "debugLogs": false,
      "dryRunMode": true
    },
    
 *
 * ADMIN COMMANDS:
 * !teambalancer on|off           → Enable/disable win streak tracking system
 * !teambalancer status           → View win streak and plugin status
 * !teambalancer dryrun on|off    → Enable/disable dry-run (manual only)
 * !teambalancer debug on|off     → Enable/disable debug logging
 * !teambalancer diag             → Runs diagnostic with dry-run scrambles
 * !teambalancer scramble         → Manually trigger scramble with countdown
 * !teambalancer cancel           → Cancel pending scramble countdown
 * !scramble                      → Alias for manual scramble with countdown
 * !scramble now                  → Immediate scramble (no countdown)
 * !scramble cancel               → Cancel pending scramble countdown
 *
 * CHAT COMMANDS:
 * !teambalancer                  → Shows current win streak, last scramble, plugin status
 *
 * CONFIGURATION OPTIONS:
 *
 * enableWinStreakTracking        - Enables or disables the automatic win streak tracking system.
 * maxWinStreak                   - The number of dominant wins required for a team to trigger an automatic scramble.
 * minTicketsToCountAsDominantWin - The minimum ticket difference required for a win to be considered "dominant" in non-Invasion game modes.
 * invasionAttackTeamThreshold    - The ticket difference threshold for the attacking team to be considered "dominant" in Invasion game mode.
 * invasionDefenceTeamThreshold   - The ticket difference threshold for the defending team to be considered "dominant" in Invasion game mode.
 *
 * Scramble Execution & Messaging:
 * scrambleAnnouncementDelay      - The delay in seconds before a scramble executes after being announced.
 * scramblePercentage             - The percentage of total players the scramble algorithm will attempt to move to balance teams (0.0 to 1.0).
 * changeTeamRetryInterval        - The interval in milliseconds between retry attempts when moving players between teams.
 * maxScrambleCompletionTime      - The maximum total time in milliseconds allowed for all player swaps to complete during a scramble.
 * showWinStreakMessages          - Controls whether messages about win streaks are broadcast to the server.
 * warnOnSwap                     - Controls whether players receive a warning message when they are swapped between teams.
 * useGenericTeamNamesInBroadcasts - If true, broadcasts will use "Team 1" and "Team 2" instead of faction names.
 *
 * Debug & Simulation:
 * debugLogs                      - Enables verbose debug logging to the server console.
 * dryRunMode                     - If true, manual scrambles will only simulate the moves without actually executing them via RCON.
 *
 * DEV MODE:
 * Set devMode = true to enable command testing in all chat (not admin-only).
 *
 * AUTHOR:
 * Slacker (Discord: real_slacker)
 *
 * ════════════════════════════════════════════════════════════════
 */

export default class TeamBalancer extends BasePlugin {
  static get description() {
    return 'Tracks dominant wins by team ID and scrambles teams if one team wins too many rounds.';
  }

  static get defaultEnabled() {
    return true;
  }

  static get optionsSpecification() {
    return {
      // Enables or disables the automatic win streak tracking system.
      database: {
        required: true,
        connector: 'sequelize',
        description: 'The Sequelize connector for persistent data storage.',
        default: 'sqlite'
      },
      // Core Win Streak & Scramble Logic
      enableWinStreakTracking: {
        default: true,
        type: 'boolean'
      },
      // The number of dominant wins required for a team to trigger an automatic scramble.
      maxWinStreak: {
        default: 2,
        type: 'number'
      },
      // The minimum ticket difference required for a win to be considered "dominant" in non-Invasion game modes.
      minTicketsToCountAsDominantWin: {
        default: 150,
        type: 'number'
      },
      // The ticket difference threshold for the attacking team to be considered "dominant" in Invasion game mode.
      invasionAttackTeamThreshold: {
        default: 300,
        type: 'number'
      },
      // The ticket difference threshold for the defending team to be considered "dominant" in Invasion game mode.
      invasionDefenceTeamThreshold: {
        default: 650,
        type: 'number'
      },
      // Scramble Execution & Messaging
      // The delay in seconds before a scramble executes after being announced.
      scrambleAnnouncementDelay: {
        default: 12,
        type: 'number'
      },
      // The percentage of total players the scramble algorithm will attempt to move to balance teams (0.0 to 1.0).
      scramblePercentage: {
        default: 0.5,
        type: 'number'
      },
      // The interval in milliseconds between retry attempts when moving players between teams.
      changeTeamRetryInterval: {
        default: 200, // Reverted to original 200ms
        type: 'number'
      },
      // The maximum total time in milliseconds allowed for all player swaps to complete during a scramble.
      maxScrambleCompletionTime: {
        default: 15000,
        type: 'number'
      },
      // Controls whether messages about win streaks are broadcast to the server.
      showWinStreakMessages: {
        default: true,
        type: 'boolean'
      },
      // Controls whether players receive a warning message when they are swapped between teams.
      warnOnSwap: {
        default: true,
        type: 'boolean'
      },
      // If true, broadcasts will use "Team 1" and "Team 2" instead of faction names.
      useGenericTeamNamesInBroadcasts: {
        default: false,
        type: 'boolean'
      },
      // Debug & Simulation
      // Enables verbose debug logging to the server console.
      debugLogs: {
        default: false,
        type: 'boolean'
      },
      // If true, manual scrambles will only simulate the moves without actually executing them via RCON.
      dryRunMode: {
        default: true,
        type: 'boolean'
      }
    };
  }

  validateOptions() {
    // If scrambleAnnouncementDelay is less than 10s, admins have no time to react and the RCON broadcast might overlap in game.
    if (this.options.scrambleAnnouncementDelay < 10) {
      this.logWarning(
        `scrambleAnnouncementDelay (${this.options.scrambleAnnouncementDelay}s) too low. Enforcing minimum 10 seconds.`
      );
      this.options.scrambleAnnouncementDelay = 10;
    }

    // If changeTeamRetryInterval is less than 200ms then the server might be spammed too quickly and time out.
    if (this.options.changeTeamRetryInterval < 200) {
      this.logWarning(
        `changeTeamRetryInterval (${this.options.changeTeamRetryInterval}ms) too low. Enforcing minimum 200ms.`
      );
      this.options.changeTeamRetryInterval = 200;
    }

    // If maxScrambleCompletionTime is too short, there might not be enough time to swap all the players.
    if (this.options.maxScrambleCompletionTime < 5000) {
      this.logWarning(
        `maxScrambleCompletionTime (${this.options.maxScrambleCompletionTime}ms) too low. Enforcing minimum 5000ms.`
      );
      this.options.maxScrambleCompletionTime = 5000;
    }

    // Ensure scramblePercentage is within a valid range (0.0 to 1.0).
    if (this.options.scramblePercentage < 0.0 || this.options.scramblePercentage > 1.0) {
      this.logWarning(
        `scramblePercentage (${this.options.scramblePercentage}) is outside the valid range (0.0 to 1.0). Enforcing 0.5.`
      );
      this.options.scramblePercentage = 0.5;
    }
  }

    constructor(server, options, connectors) {
        super(server, options, connectors);
        // Ensure this.log is always available, even if BasePlugin's setup is delayed or inconsistent
        this.log = this.log || {
            debug: (...args) => console.log('[TeamBalancer][DEBUG]', ...args),
            info: (...args) => console.log('[TeamBalancer][INFO]', ...args),
            warn: (...args) => console.warn('[TeamBalancer][WARN]', ...args),
            error: (...args) => console.error('[TeamBalancer][ERROR]', ...args)
        };
        this.devMode = false; // <-- DEV MODE TOGGLE
        CommandHandlers.register(this);

        // DB integration
        this.sequelize = connectors.sqlite;
        this.TeamBalancerStateModel = null;
        this.stateRecord = null;

        // Core state
        this.winStreakTeam = null;
        this.winStreakCount = 0;
        this.lastSyncTimestamp = null;
        this.manuallyDisabled = false;

        this._scramblePending = false;
        this._scrambleTimeout = null;
        this._scrambleCountdownTimeout = null;
        this._flippedAfterScramble = false;
        this.lastScrambleTime = null;

        this.pendingPlayerMoves = new Map();
        this.scrambleRetryTimer = null;
        this.activeScrambleSession = null;
        this._scrambleInProgress = false;

        // A single place to store bound listeners for easy cleanup
        this.listeners = {};

        // Bind methods once for consistent reference
        this.listeners.onRoundEnded = this.onRoundEnded.bind(this);
        this.listeners.onNewGame = this.onNewGame.bind(this);
        this.listeners.onChatCommand = this.onChatCommand.bind(this);
        this.listeners.onScrambleCommand = this.onScrambleCommand.bind(this);
        this.listeners.onChatMessage = this.onChatMessage.bind(this);
        // Explicitly bind processScrambleRetries to ensure 'this' context
        this.listeners.processScrambleRetries = this.processScrambleRetries.bind(this);

        this._gameInfoPollingInterval = null;
        this.gameModeCached = null;
        this.cachedAbbreviations  = {};
    }

    logDebug(...args) {
        if (this.options.debugLogs) {
            console.log('[TeamBalancer]', ...args);
        }
    }

    logWarning(...args) {
        console.log('[WARNING] [TeamBalancer]', ...args);
    }

    async mount() {
        this.logDebug('Mounting plugin and adding listeners.');
        await this.prepareToMount();
        this.server.on('ROUND_ENDED', this.listeners.onRoundEnded);
        this.server.on('NEW_GAME', this.listeners.onNewGame);
        this.server.on('CHAT_COMMAND:teambalancer', this.listeners.onChatCommand);
        this.server.on('CHAT_COMMAND:scramble', this.listeners.onScrambleCommand);
        this.server.on('CHAT_MESSAGE', this.listeners.onChatMessage);
        this.startPollingGameInfo();
        this.startPollingTeamAbbreviations(); // Add this line
        this.validateOptions();
    }

    async unmount() {
        this.logDebug('Unmounting plugin and removing listeners.');
        this.server.removeListener('ROUND_ENDED', this.listeners.onRoundEnded);
        this.server.removeListener('NEW_GAME', this.listeners.onNewGame);
        this.server.removeListener('CHAT_COMMAND:teambalancer', this.listeners.onChatCommand);
        this.server.removeListener('CHAT_COMMAND:scramble', this.listeners.onScrambleCommand);
        this.server.removeListener('CHAT_MESSAGE', this.listeners.onChatMessage);

        if (this._scrambleTimeout) clearTimeout(this._scrambleTimeout);
        if (this._scrambleCountdownTimeout) clearTimeout(this._scrambleCountdownTimeout);
        this.cleanupScrambleTracking();
        this.stopPollingGameInfo(); // Add this line
        this.stopPollingTeamAbbreviations();
        this._scrambleInProgress = false;
    }


    // ╔═══════════════════════════════════════╗
    // ║          POLLING MECHANISMS           ║
    // ╚═══════════════════════════════════════╝

    async startPollingGameInfo() {
        this.logDebug('Starting game info polling.');

        // An async function to get the game mode and update the cache.
        const pollGameInfo = async () => {
            try {
                // Await the promise to get the resolved layer object.
                const layer = await this.server.currentLayer;

                // Check if the layer and its gamemode property are available.
                if (layer && layer.gamemode) {
                    this.gameModeCached = layer.gamemode;
                    this.logDebug(`Game mode resolved and cached: ${this.gameModeCached}`);

                    // Clear the polling interval once the game mode is successfully retrieved.
                    if (this.gameInfoPollInterval) {
                        clearInterval(this.gameInfoPollInterval);
                        this.gameInfoPollInterval = null;
                        this.logDebug('Game info polling stopped.');
                    }
                } else {
                    this.logDebug('Game info not yet available. Retrying...');
                }
            } catch (err) {
                this.logDebug(`Error during game info polling: ${err.message}`);
            }
        };

        // Run the poll immediately to get a head start.
        await pollGameInfo();

        // Start a periodic poll that will terminate itself once the game mode is found.
        this.gameInfoPollInterval = setInterval(pollGameInfo, 10000); // Poll every 10 seconds.
    }

    stopPollingGameInfo() {
        if (this._gameInfoPollingInterval) {
            this.logDebug('Stopping game info polling.');
            clearInterval(this._gameInfoPollingInterval);
            this._gameInfoPollingInterval = null;
        }
    }

    getTeamName(teamID) {
        if (this.options.useGenericTeamNamesInBroadcasts) {
            return `Team ${teamID}`;
        }
        return this.cachedAbbreviations [teamID] || `Team ${teamID}`;
    }

    startPollingTeamAbbreviations() {
        this.logDebug('Starting team abbreviation polling.');
        this.stopPollingTeamAbbreviations();
        this._teamAbbreviationPollingInterval = setInterval(() => this.pollTeamAbbreviations(), 5000);
    }

    stopPollingTeamAbbreviations() {
        if (this._teamAbbreviationPollingInterval) {
            this.logDebug('Stopping team abbreviation polling.');
            clearInterval(this._teamAbbreviationPollingInterval);
            this._teamAbbreviationPollingInterval = null;
        }
    }

    pollTeamAbbreviations() {
        this.logDebug('Running periodic team abbreviation poll.');
        const newAbbreviations = this.extractTeamAbbreviationsFromRoles();

        // Only update cache if new abbreviations are found.
        if (Object.keys(newAbbreviations).length > 0) {
            this.cachedAbbreviations  = Object.assign({}, this.cachedAbbreviations , newAbbreviations);
            this.logDebug(`Updated cached abbreviations: ${JSON.stringify(this.cachedAbbreviations )}`);
        }

        const hasBothTeams = Object.keys(this.cachedAbbreviations ).length === 2;

        // Stop polling once two teams are found in the cache.
        if (hasBothTeams) {
            this.logDebug(`Polling successful! Cached abbreviations: ${JSON.stringify(this.cachedAbbreviations )}`);
            this.stopPollingTeamAbbreviations();
        }
    }

    extractTeamAbbreviationsFromRoles() {
        this.logDebug('extractTeamAbbreviationsFromRoles: Starting extraction from player roles.');
        const abbreviations = {};
        for (const player of this.server.players) {
            const teamID = player.teamID;
            if (!teamID) {
                this.logDebug(`extractTeamAbbreviationsFromRoles: Skipping player ${player.name} with no teamID.`);
                continue;
            }

            if (abbreviations[teamID]) {
                this.logDebug(`extractTeamAbbreviationsFromRoles: Skipping player ${player.name}, abbreviation for Team ${teamID} already found.`);
                continue;
            }

            const role = player.roles?.[0] || player.role; // Check for player.role as fallback
            if (role) {
                // New regex to match abbreviations like "PLANMC" at the start of the string
                const match = role.match(/^([A-Z]{2,6})_/);
                if (match) {
                    this.logDebug(`extractTeamAbbreviationsFromRoles: Found abbreviation ${match[1]} for Team ${teamID} from role ${role}.`);
                    abbreviations[teamID] = match[1];
                } else {
                    this.logDebug(`extractTeamAbbreviationsFromRoles: No abbreviation found in role ${role} for player ${player.name}.`);
                }
            } else {
                this.logDebug(`extractTeamAbbreviationsFromRoles: No role found for player ${player.name}.`);
            }
        }
        this.logDebug(`extractTeamAbbreviationsFromRoles: Finished extraction. Result: ${JSON.stringify(abbreviations)}`);
        return abbreviations;
    }

  // ╔═══════════════════════════════════════╗
  // ║      DATABASE & STATE PERSISTENCE     ║
  // ╚═══════════════════════════════════════╝

  async prepareToMount() {
    try {
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

      this.stateRecord = record;

      const staleCutoff = 2.5 * 60 * 60 * 1000;
      const isStale =
        !record.lastSyncTimestamp || Date.now() - record.lastSyncTimestamp > staleCutoff;

      if (!isStale) {
        this.winStreakTeam = record.winStreakTeam;
        this.winStreakCount = record.winStreakCount;
        this.lastSyncTimestamp = record.lastSyncTimestamp;
        this.lastScrambleTime = record.lastScrambleTime;
        this.logDebug(
          `[DB] Restored state: team=${this.winStreakTeam}, count=${this.winStreakCount}`
        );
      } else {
        this.logDebug('[DB] State stale; resetting.');
        this.lastScrambleTime = record.lastScrambleTime;
        await this.updateDBState(null, 0);
      }
    } catch (err) {
      this.logWarning(`[DB] prepareToMount failed: ${err.message}`);
    }
  }

  async updateDBState(team, count) {
    try {
      if (!this.stateRecord) return;
      this.winStreakTeam = team;
      this.winStreakCount = count;
      this.lastSyncTimestamp = Date.now();
      this.stateRecord.winStreakTeam = team;
      this.stateRecord.winStreakCount = count;
      this.stateRecord.lastSyncTimestamp = this.lastSyncTimestamp;
      await this.stateRecord.save();
      this.logDebug(`[DB] Updated: team=${team}, count=${count}`);
    } catch (err) {
      this.logWarning(`[DB] updateDBState failed: ${err.message}`);
    }
  }

  async updateLastScrambleTime(timestamp) {
    try {
      if (!this.stateRecord) return;
      this.lastScrambleTime = timestamp;
      this.stateRecord.lastScrambleTime = timestamp;
      await this.stateRecord.save();
      this.logDebug(`[DB] Updated lastScrambleTime: ${timestamp}`);
    } catch (err) {
      this.logWarning(`[DB] updateLastScrambleTime failed: ${err.message}`);
    }
  }

  // ╔═══════════════════════════════════════╗
  // ║         ROUND EVENT HANDLERS          ║
  // ╚═══════════════════════════════════════╝

    async onNewGame() {
        try {
            this.logDebug('[onNewGame] Event triggered');

            // Reset cached game and team info
            this.gameModeCached = null;
            this.cachedAbbreviations  = {};
            this.startPollingGameInfo();
            this.startPollingTeamAbbreviations(); // Add this line

            this._scrambleInProgress = false;
            this._scramblePending = false;

            // ... (rest of the onNewGame function remains unchanged)
            // Squad servers swap sides between games, so winning team IDs flip.
            // This flip maintains streak continuity and prevents incorrect resets.
            await this.updateDBState(
                this.winStreakTeam === 1 ? 2 : this.winStreakTeam === 2 ? 1 : null,
                this.winStreakCount
            );
        } catch (err) {
            this.log.error(`[TeamBalancer] Error in onNewGame: ${err.message}`);
            // Fallback: Attempt to reset state to prevent cascading issues
            this.winStreakTeam = null;
            this.winStreakCount = 0;
            await this.updateDBState(null, 0);
            this._scrambleInProgress = false;
            this._scramblePending = false;
            this.cleanupScrambleTracking();

        }
    }

    async onRoundEnded(data) {
        try {
            this.logDebug(`Round ended event received: ${JSON.stringify(data)}`);

            // Stop both polling loops after a round ends.
            this.stopPollingGameInfo();
            this.stopPollingTeamAbbreviations(); // Add this line

            const winnerID = parseInt(data?.winner?.team);
            const winnerTickets = parseInt(data?.winner?.tickets);
            const loserTickets = parseInt(data?.loser?.tickets);
            const margin = winnerTickets - loserTickets;

            if (isNaN(winnerID) || isNaN(winnerTickets) || isNaN(loserTickets)) {
                this.logWarning('Could not parse round end data, skipping evaluation.');
                return;
            }

            this.logDebug(
                `Parsed winnerID=${winnerID}, winnerTickets=${winnerTickets}, loserTickets=${loserTickets}, margin=${margin}`
            );

            const isInvasion = this.gameModeCached?.toLowerCase().includes('invasion') ?? false;
            const dominantThreshold = this.options.minTicketsToCountAsDominantWin ?? 175;
            const stompThreshold = Math.floor(dominantThreshold * 1.5);
            const closeGameMargin = Math.floor(dominantThreshold * 0.34);
            const moderateWinThreshold = Math.floor((dominantThreshold + closeGameMargin) / 2);

            this.logDebug(`Thresholds computed: {
    gameMode: ${this.gameModeCached},
    isInvasion: ${isInvasion},
    dominantThreshold: ${dominantThreshold},
    stompThreshold: ${stompThreshold},
    closeGameMargin: ${closeGameMargin},
    moderateWinThreshold: ${moderateWinThreshold}
}`);

            // Invasion-specific dominant thresholds
            const invasionAttackThreshold = this.options.invasionAttackTeamThreshold ?? 300;
            const invasionDefenceThreshold = this.options.invasionDefenceTeamThreshold ?? 650;

            // Determine dominance state
            let isDominant = false;
            let isStomp = false;

            if (isInvasion) {
                if (
                    (winnerID === 1 && margin >= invasionAttackThreshold) ||
                    (winnerID === 2 && margin >= invasionDefenceThreshold)
                ) {
                    isDominant = true;
                    isStomp = true; // Treat invasion dominant as stomp for messaging
                }
            } else {
                isDominant = margin >= dominantThreshold;
                isStomp = margin >= stompThreshold;
            }
            this.logDebug(`Dominance state: isDominant=${isDominant}, isStomp=${isStomp}`);

            const nextStreakCount = this.winStreakTeam === winnerID ? this.winStreakCount + 1 : 1;
            const maxStreakReached = nextStreakCount >= this.options.maxWinStreak;
            this.logDebug(`Streak info: nextStreakCount=${nextStreakCount}, maxStreakReached=${maxStreakReached}`);

            const winnerName =
                (this.options.useGenericTeamNamesInBroadcasts
                    ? `Team ${winnerID}`
                    : this.getTeamName(winnerID)) || `Team ${winnerID}`;
            const loserName =
                (this.options.useGenericTeamNamesInBroadcasts
                    ? `Team ${3 - winnerID}`
                    : this.getTeamName(3 - winnerID)) || `Team ${3 - winnerID}`;

            this.logDebug(`Team names for broadcast: winnerName=${winnerName}, loserName=${loserName}`);

            // The prefixing logic below is only applicable when using faction names
            // and should be skipped for generic team names.
            let broadcastWinnerName = winnerName;
            let broadcastLoserName = loserName;
            if (!this.options.useGenericTeamNamesInBroadcasts) {
                if (!/^The\s+/i.test(winnerName) && !winnerName.startsWith('Team ')) {
                    broadcastWinnerName = 'The ' + winnerName;
                }
                if (!/^The\s+/i.test(loserName) && !loserName.startsWith('Team ')) {
                    broadcastLoserName = 'The ' + loserName;
                }
            }

            const teamNames = { winnerName: broadcastWinnerName, loserName: broadcastLoserName };
            this.logDebug(`Final team names for broadcast: winnerName=${teamNames.winnerName}, loserName=${teamNames.loserName}`);


            if (!isDominant && !maxStreakReached) {
                this.logDebug('Handling non-dominant win branch.');
                if (this.options.showWinStreakMessages) {
                    let template;

                    if (this.winStreakTeam && this.winStreakTeam !== winnerID) {
                        template = this.RconMessages.nonDominant.streakBroken;
                    } else if (isInvasion) {
                        template =
                            winnerID === 1
                                ? this.RconMessages.nonDominant.invasionAttackWin
                                : this.RconMessages.nonDominant.invasionDefendWin;
                    } else {
                        const threshold = this.options.minTicketsToCountAsDominantWin ?? 175;

                        const veryCloseCutoff = Math.floor(threshold * 0.11);
                        const closeCutoff = Math.floor(threshold * 0.45);
                        const tacticalCutoff = Math.floor(threshold * 0.68);

                        if (margin < veryCloseCutoff) {
                            template = this.RconMessages.nonDominant.narrowVictory;
                        } else if (margin < closeCutoff) {
                            template = this.RconMessages.nonDominant.marginalVictory;
                        } else if (margin < tacticalCutoff) {
                            template = this.RconMessages.nonDominant.tacticalAdvantage;
                        } else {
                            template = this.RconMessages.nonDominant.operationalSuperiority;
                        }
                    }
                    this.logDebug(`Using template for non-dominant win: ${template}`);

                    const message = `${this.RconMessages.prefix} ${this.formatMessage(template, {
                        team: teamNames.winnerName,
                        loser: teamNames.loserName,
                        margin
                    })}`;
                    this.logDebug(`Broadcasting non-dominant message: ${message}`);
                    try {
                        await this.server.rcon.broadcast(message);
                    } catch (broadcastErr) {
                        this.logWarning(`Failed to broadcast non-dominant message: ${broadcastErr.message}`);
                    }
                }
                return await this.resetStreak(`Non-dominant win by team ${winnerID}`);
            }

            this.logDebug('Dominant win detected under standard mode.');
            this.logDebug(
                `Current streak: winStreakTeam=${this.winStreakTeam}, winStreakCount=${this.winStreakCount}`
            );

            const streakBroken = this.winStreakTeam && this.winStreakTeam !== winnerID;
            if (streakBroken) {
                this.logDebug(`Streak broken. Previous streak team: ${this.winStreakTeam}`);
                await this.resetStreak('Streak broken by opposing team');
            }

            await this.updateDBState(winnerID, nextStreakCount);
            this.logDebug(
                `New win streak started: team ${this.winStreakTeam}, count ${this.winStreakCount}`
            );

            const scrambleComing = this.winStreakCount >= this.options.maxWinStreak;
            this.logDebug(`Scramble check: winStreakCount=${this.winStreakCount}, maxWinStreak=${this.options.maxWinStreak}, scrambleComing=${scrambleComing}`);


            if (this.options.showWinStreakMessages && !scrambleComing) {
                let template;

                if (isInvasion) {
                    template =
                        winnerID === 1
                            ? this.RconMessages.dominant.invasionAttackStomp
                            : this.RconMessages.dominant.invasionDefendStomp;
                } else if (isStomp) {
                    template = this.RconMessages.dominant.stomped;
                } else {
                    template = this.RconMessages.dominant.steamrolled;
                }
                this.logDebug(`Using template for dominant win: ${template}`);

                const message = `${this.RconMessages.prefix} ${this.formatMessage(template, {
                    team: teamNames.winnerName,
                    loser: teamNames.loserName,
                    margin
                })}`;
                this.logDebug(`Broadcasting dominant win message: ${message}`);
                try {
                    await this.server.rcon.broadcast(message);
                } catch (broadcastErr) {
                    this.logWarning(`Failed to broadcast dominant win message: ${broadcastErr.message}`);
                }
            }

            this.logDebug(
                `Evaluating scramble trigger: streakCount=${this.winStreakCount}, streakTeam=${this.winStreakTeam}, margin=${margin}`
            );
            this.logDebug(
                `_scramblePending=${this._scramblePending}, _scrambleInProgress=${this._scrambleInProgress}`
            );

            if (this._scramblePending || this._scrambleInProgress) return;

            if (this.winStreakCount >= this.options.maxWinStreak) {
                this.logDebug(`Scramble condition met. Preparing to broadcast announcement.`);
                const message = this.formatMessage(this.RconMessages.scrambleAnnouncement, {
                    team: teamNames.winnerName,
                    count: this.winStreakCount,
                    margin,
                    delay: this.options.scrambleAnnouncementDelay
                });
                this.logDebug(`Scramble announcement message: ${message}`);
                try {
                    await this.server.rcon.broadcast(`${this.RconMessages.prefix} ${message}`);
                } catch (broadcastErr) {
                    this.logWarning(`Failed to broadcast scramble announcement: ${broadcastErr.message}`);
                }
                this.initiateScramble(false, false);
            }
        } catch (err) {
            this.log.error(`[TeamBalancer] Error in onRoundEnded: ${err.message}`);
            // Fallback: Attempt to reset state to prevent cascading issues
            this.winStreakTeam = null;
            this.winStreakCount = 0;
            this._scrambleInProgress = false;
            this._scramblePending = false;
            this.cleanupScrambleTracking();
        }
    }

  resetStreak(reason = 'unspecified') {
    this.logDebug(`Resetting streak: ${reason}`);
    this.updateDBState(null, 0);
    this._scramblePending = false;
  }

  // ╔═══════════════════════════════════════╗
  // ║        SCRAMBLE EXECUTION FLOW        ║
  // ╚═══════════════════════════════════════╝

  async initiateScramble(isSimulated = false, immediate = false, steamID = null, player = null) {
    if (this._scramblePending || this._scrambleInProgress) {
      this.logDebug('Scramble initiation blocked: scramble already pending or in progress.');
      return false;
    }
    const adminName = player?.name || (steamID ? `admin ${steamID}` : 'system');

    // If it's a simulated scramble (dry run), force immediate execution and no public broadcast.
    if (isSimulated) {
      console.log(`[TeamBalancer] Simulating immediate scramble initiated by ${adminName}`);
      await this.executeScramble(true, steamID, player); // Always pass true for isSimulated
      return true;
    }

    // This block is for LIVE scrambles only.
    if (!immediate) {
      // This means it's a live scramble with a countdown
      this._scramblePending = true;
      const delaySeconds = this.options.scrambleAnnouncementDelay;
      this._scrambleCountdownTimeout = setTimeout(async () => {
        this.logDebug('Scramble countdown finished, executing scramble.');
        await this.executeScramble(false, steamID, player); // Always pass false for isSimulated (live)
      }, delaySeconds * 1000);
      return true;
    } else {
      // This means it's an immediate LIVE scramble (!scramble now)
      console.log(`[TeamBalancer] Immediate live scramble initiated by ${adminName}`);
      await this.executeScramble(false, steamID, player); // Always pass false for isSimulated (live)
      return true;
    }
  }

  transformSquadJSData(squads, players) {
    this.logDebug('Transforming SquadJS data for scrambler...');

    // Normalize and validate input
    const normalizedSquads = (squads || []).filter(
      (squad) =>
        squad &&
        squad.squadID &&
        squad.teamID &&
        typeof squad.squadID !== 'undefined' &&
        typeof squad.squadID !== 'undefined'
    );

    const normalizedPlayers = (players || []).filter(
      (player) =>
        player &&
        player.steamID &&
        player.teamID &&
        typeof player.steamID === 'string' &&
        typeof player.teamID !== 'undefined'
    );

    this.logDebug(
      `Input validation: ${normalizedSquads.length} valid squads, ${normalizedPlayers.length} valid players`
    );

    // Create a map of squadID -> array of player steamIDs
    const squadPlayerMap = new Map();

    for (const player of normalizedPlayers) {
      if (player.squadID) {
        const squadKey = String(player.squadID);
        if (!squadPlayerMap.has(squadKey)) {
          squadPlayerMap.set(squadKey, []);
        }
        squadPlayerMap.get(squadKey).push(player.steamID);
      }
    }

    this.logDebug(`Squad-player mapping created for ${squadPlayerMap.size} squads`);

    // Transform squads to expected format
    const transformedSquads = normalizedSquads.map((squad) => {
      const squadKey = String(squad.squadID);
      const playersInSquad = squadPlayerMap.get(squadKey) || [];

      const transformed = {
        id: squadKey,
        teamID: String(squad.teamID), // Ensure string format
        players: playersInSquad,
        locked: squad.locked === 'True' || squad.locked === true // Handle both string and boolean
      };

      this.logDebug(
        `Transformed squad ${squadKey}: ${playersInSquad.length} players, team ${transformed.teamID}, locked: ${transformed.locked}`
      );

      return transformed;
    });

    // Transform players to expected format
    const transformedPlayers = normalizedPlayers.map((player) => ({
      steamID: player.steamID,
      teamID: String(player.teamID), // Ensure string format
      squadID: player.squadID ? String(player.squadID) : null
    }));

    this.logDebug(
      `Transformation complete: ${transformedSquads.length} squads, ${transformedPlayers.length} players`
    );

    // Log sample data for debugging
    if (transformedSquads.length > 0) {
      this.logDebug(`Sample transformed squad:`, JSON.stringify(transformedSquads[0], null, 2));
    }
    if (transformedPlayers.length > 0) {
      this.logDebug(`Sample transformed player:`, JSON.stringify(transformedPlayers[0], null, 2));
    }

    return {
      squads: transformedSquads,
      players: transformedPlayers
    };
  }

  async executeScramble(isSimulated = false, steamID = null, player = null) {
    if (this._scrambleInProgress) {
      this.logWarning('Scramble already in progress.');
      return false;
    }

    this._scrambleInProgress = true;
    // Prioritize player name for adminName
    const adminName = player?.name || (steamID ? `admin ${steamID}` : 'system');
    this.logDebug(`Scramble started by ${adminName}`);

    try {
      let broadcastMessage;
      if (isSimulated) {
        broadcastMessage = `${
          this.RconMessages.prefix
        } ${this.RconMessages.executeDryRunMessage.trim()}`;
        console.log(`[TeamBalancer] Simulating scramble initiated by ${adminName}`);
      } else {
        broadcastMessage = `${
          this.RconMessages.prefix
        } ${this.RconMessages.executeScrambleMessage.trim()}`;
        console.log(`[TeamBalancer] Executing scramble initiated by ${adminName}`);
      }

      this.logDebug(`Broadcasting: "${broadcastMessage}"`);
      // Only broadcast if it's not a simulated dry run
      if (!isSimulated) {
        try {
          await this.server.rcon.broadcast(broadcastMessage);
        } catch (broadcastErr) {
          this.logWarning(
            `Failed to broadcast scramble execution message: ${broadcastErr.message}`
          );
          // Continue execution even if broadcast fails
        }
      }

      // Determine which logger to use for the Scrambler based on simulation mode
      const scramblerLogger = isSimulated ? this.log.info.bind(this) : this.logDebug.bind(this);

      // Transform SquadJS data to expected format
      const { squads: transformedSquads, players: transformedPlayers } = this.transformSquadJSData(
        this.server.squads,
        this.server.players
      );

      this.logDebug(
        `Calling scrambler with ${transformedSquads.length} squads and ${transformedPlayers.length} players`
      );

      // Call the Scrambler and get the swap plan
      const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
        squads: transformedSquads,
        players: transformedPlayers,
        winStreakTeam: this.winStreakTeam,
        log: scramblerLogger, // Use the selected logger
        scramblePercentage: this.options.scramblePercentage
      });

      if (swapPlan && swapPlan.length > 0) {
        this.log.info(`Dry run: Scrambler returned ${swapPlan.length} player moves.`); // Changed from logDebug
        if (!isSimulated) {
          // Queue all player moves into the reliablePlayerMove system
          for (const move of swapPlan) {
            // reliablePlayerMove handles its own retries and errors
            await this.reliablePlayerMove(move.steamID, move.targetTeamID, isSimulated);
          }
          // Wait for all queued moves to complete
          await this.waitForScrambleToFinish(this.options.maxScrambleCompletionTime);
        } else {
          // Changed from logDebug to log.info for dry run output
          this.log.info(`Dry run: Would have queued ${swapPlan.length} player moves.`);
          for (const move of swapPlan) {
            this.log.info(`  [Dry Run] Player ${move.steamID} to Team ${move.targetTeamID}`);
          }
        }
      } else {
        this.log.info('Scrambler returned no player moves or an empty plan.'); // Changed from logDebug
      }

      const msg = `${this.RconMessages.prefix} ${this.RconMessages.scrambleCompleteMessage.trim()}`;
      if (!isSimulated) {
        this.logDebug(`Broadcasting: "${msg}"`);
        try {
          await this.server.rcon.broadcast(msg);
        } catch (broadcastErr) {
          this.logWarning(`Failed to broadcast scramble complete message: ${broadcastErr.message}`);
        }
        const scrambleTimestamp = Date.now();
        this.lastScrambleTime = scrambleTimestamp;
        await this.updateLastScrambleTime(scrambleTimestamp);
        await this.resetStreak('Post-scramble cleanup');
      } else {
        this.log.info(msg);
      }

      return true;
    } catch (error) {
      console.error(`[TeamBalancer] Critical error during scramble execution:`, error);
      // Log additional debugging info on error
      this.logDebug(`Squad data at error:`, JSON.stringify(this.server.squads, null, 2));
      this.logDebug(`Player data at error:`, JSON.stringify(this.server.players, null, 2));
      // Fallback: Attempt to clean up and reset state to prevent stuck state
      this.cleanupScrambleTracking();
      await this.resetStreak('Scramble execution failed');
      return false;
    } finally {
      this._scrambleInProgress = false;
      this.logDebug('Scramble finished');
    }
  }

  async cancelPendingScramble(steamID, player = null, isAutomatic = false) {
    if (!this._scramblePending) {
      return false;
    }

    if (this._scrambleInProgress) {
      if (!isAutomatic) {
        const adminName = player?.name || steamID;
        console.log(
          `[TeamBalancer] ${adminName} attempted to cancel scramble, but it's already executing`
        );
      }
      return false;
    }

    if (this._scrambleCountdownTimeout) {
      clearTimeout(this._scrambleCountdownTimeout);
      this._scrambleCountdownTimeout = null;
    }

    this._scramblePending = false;

    const adminName = player?.name || steamID; // Prioritize player name
    const cancelReason = isAutomatic ? 'automatically' : `by admin ${adminName}`;

    console.log(`[TeamBalancer] Scramble countdown cancelled ${cancelReason}`);

    if (!isAutomatic) {
      const msg = `${this.RconMessages.prefix} Scramble cancelled by admin.`;
      this.logDebug(`Broadcasting: "${msg}"`);
      try {
        await this.server.rcon.broadcast(msg);
      } catch (err) {
        this.logWarning(`Failed to broadcast scramble cancellation message: ${err.message}`);
      }
    }

    return true;
  }

  async waitForScrambleToFinish(timeoutMs = 10000, intervalMs = 100) {
    const start = Date.now();

    while (this.pendingPlayerMoves.size > 0) {
      // Check if there are still pending moves
      if (Date.now() - start > timeoutMs) {
        this.logWarning(
          'Timeout waiting for scramble to finish. Some player moves may still be pending.'
        );
        break; // Break the loop, don't throw, let the process continue
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    this.logDebug('All player moves processed or timeout reached.');
  }

  // ╔═══════════════════════════════════════╗
  // ║      RELIABLE PLAYER MOVE SYSTEM      ║
  // ╚═══════════════════════════════════════╝

  async reliablePlayerMove(steamID, targetTeamID, isSimulated = false) {
    if (isSimulated) {
      this.logDebug(`[Dry Run] Would queue player move for ${steamID} to team ${targetTeamID}`);
      return;
    }

    this.pendingPlayerMoves.set(steamID, {
      targetTeamID: targetTeamID,
      attempts: 0,
      startTime: Date.now()
    });

    this.logDebug(`Queued player move for ${steamID} to team ${targetTeamID}`);

    if (!this.scrambleRetryTimer) {
      this.startScrambleMonitoring();
    }
  }

  startScrambleMonitoring() {
    this.logDebug('Starting scramble monitoring system');
    this.activeScrambleSession = {
      startTime: Date.now(),
      totalMoves: this.pendingPlayerMoves.size,
      completedMoves: 0,
      failedMoves: 0
    };

    this.scrambleRetryTimer = setInterval(async () => {
      // Wrap the interval callback in a try-catch to prevent it from crashing the whole process
      try {
        // Use the bound method from this.listeners
        await this.listeners.processScrambleRetries();
      } catch (err) {
        // Defensive check: ensure this.log exists before using it
        if (this.log && typeof this.log.error === 'function') {
          this.log.error(`[TeamBalancer] Error in scramble retry interval: ${err.message}`);
        } else {
          console.error(
            `[TeamBalancer] Critical error in scramble retry interval, logger unavailable: ${err.message}`
          );
        }
        // Attempt to clean up if the interval itself is failing repeatedly
        this.completeScrambleSession();
      }
    }, this.options.changeTeamRetryInterval);

    // The overall timeout for the scramble session, after which we give up on remaining moves
    setTimeout(() => {
      this.completeScrambleSession();
    }, this.options.maxScrambleCompletionTime);
  }

  async processScrambleRetries() {
    const now = Date.now();
    const playersToRemove = [];

    // Relying on SquadJS's internal player list update mechanism.
    const currentServerPlayers = this.server.players;

    for (const [steamID, moveData] of this.pendingPlayerMoves.entries()) {
      // Each iteration should be robust
      try {
        if (now - moveData.startTime > this.options.maxScrambleCompletionTime) {
          this.logWarning(
            `Player move timeout exceeded for ${steamID} after ${this.options.maxScrambleCompletionTime}ms, giving up`
          );
          this.logDebug(
            `Player ${steamID} move history: ${moveData.attempts} attempts, target team ${moveData.targetTeamID}`
          );
          this.activeScrambleSession.failedMoves++;
          playersToRemove.push(steamID);
          continue;
        }

        const player = currentServerPlayers.find((p) => p.steamID === steamID);
        if (!player) {
          this.logDebug(
            `Player ${steamID} no longer on server, removing from move queue (was targeting team ${moveData.targetTeamID})`
          );
          // If player left, consider the move "completed" in terms of our responsibility
          this.activeScrambleSession.completedMoves++;
          playersToRemove.push(steamID);
          continue;
        }

        // Added debug log to show current player team ID
        this.logDebug(
          `Checking player ${steamID} (${player.name}): Current Team = ${player.teamID}, Target Team = ${moveData.targetTeamID}`
        );

        moveData.attempts++;
        const maxRconAttempts = 5;

        if (moveData.attempts <= maxRconAttempts) {
          this.logDebug(
            `Attempting move for ${steamID} (${player.name}) from team ${player.teamID} to team ${moveData.targetTeamID} (attempt ${moveData.attempts}/${maxRconAttempts})`
          );

          try {
            await this.server.rcon.switchTeam(steamID, moveData.targetTeamID);
            this.logDebug(
              `RCON switchTeam command sent for ${steamID} (${player.name}) to team ${moveData.targetTeamID}. Assuming success for this attempt.`
            );
            // Assume success after sending the RCON command without error
            this.activeScrambleSession.completedMoves++;
            playersToRemove.push(steamID);
            if (this.options.warnOnSwap) {
              try {
                await this.server.rcon.warn(steamID, this.RconMessages.playerScrambledWarning); // Use the new succinct message
              } catch (err) {
                this.logDebug(`Failed to send move warning to ${steamID} (${player.name}):`, err);
              }
            }
          } catch (err) {
            this.logWarning(
              `✗ Move attempt ${moveData.attempts}/${maxRconAttempts} failed for player ${steamID} (${player.name}) to team ${moveData.targetTeamID}:`,
              err.message || err
            );

            if (moveData.attempts >= maxRconAttempts) {
              this.logWarning(
                `✗ FINAL FAILURE: Player ${steamID} (${player.name}) could not be moved to team ${moveData.targetTeamID} after ${maxRconAttempts} attempts`
              );
              this.logDebug(
                `Failed player details: Currently on team ${player.teamID}, squad ${player.squadID}, role ${player.role}`
              );
              this.activeScrambleSession.failedMoves++;
              playersToRemove.push(steamID);
            }
          }
        } else {
          this.logDebug(
            `Player ${steamID} has exceeded max RCON attempts, giving up on this move.`
          );
          // If max attempts reached and still not moved (based on previous logic, which we're changing),
          // mark as failed and remove. This path should now only be hit if the RCON command itself
          // consistently failed for maxRconAttempts times.
          this.activeScrambleSession.failedMoves++;
          playersToRemove.push(steamID);
        }
      } catch (iterationErr) {
        this.log.error(`Error processing move for player ${steamID}: ${iterationErr.message}`); // Removed redundant prefix
        // If an unexpected error occurs during processing a single player,
        // mark them as failed and remove them to prevent infinite loops.
        this.activeScrambleSession.failedMoves++;
        playersToRemove.push(steamID);
      }
    }

    playersToRemove.forEach((steamID) => {
      this.pendingPlayerMoves.delete(steamID);
    });

    if (this.pendingPlayerMoves.size === 0) {
      this.logDebug('All player moves completed, finishing scramble session immediately');
      this.completeScrambleSession();
    }
  }

  completeScrambleSession() {
    if (!this.activeScrambleSession) return;

    const duration = Date.now() - this.activeScrambleSession.startTime;
    const { totalMoves, completedMoves, failedMoves } = this.activeScrambleSession;

    if (this.scrambleRetryTimer) {
      clearInterval(this.scrambleRetryTimer);
      this.scrambleRetryTimer = null;
    }

    const successRate = totalMoves > 0 ? Math.round((completedMoves / totalMoves) * 100) : 100;
    // const completionReason =
    //    this.pendingPlayerMoves.size === 0 ? 'all moves completed' : 'timeout reached';

    // Trimmed this log for conciseness
    console.log(
      `[TeamBalancer] Scramble session completed in ${duration}ms: ` +
        `${completedMoves}/${totalMoves} successful moves (${successRate}%), ${failedMoves} failed`
    );

    if (failedMoves > 0) {
      this.logWarning(
        `${failedMoves} players could not be moved during scramble. They may need manual intervention.`
      );
    }

    this.cleanupScrambleTracking();
  }

  cleanupScrambleTracking() {
    if (this.scrambleRetryTimer) {
      clearInterval(this.scrambleRetryTimer);
      this.scrambleRetryTimer = null;
    }
    this.pendingPlayerMoves.clear();
    this.activeScrambleSession = null;
    this._scrambleInProgress = false;
  }
}

// ╔═══════════════════════════════════════════════════════════════╗
// ║                PLAYER COMMAND & RESPONSE LOGIC                ║
// ╚═══════════════════════════════════════════════════════════════╝

const CommandHandlers = {
  register(tb) {
    // Modified tb.respond to include player name and conditionally SteamID
    tb.respond = function (player, msg) {
      const playerName = player?.name || 'Unknown Player';
      const steamID = player?.steamID || 'Unknown SteamID';
      let logMessage = `[TeamBalancer][Response to ${playerName}`;

      if (this.options.debugLogs) {
        logMessage += ` (${steamID})`;
      }
      logMessage += `]\n${msg}`; // Added newline here for better formatting
      console.log(logMessage);

      // The RCON warn part (if uncommented in future) would still use steamID
      // await this.server.rcon.warn(steamID, msg);
    };

    tb.formatMessage = (template, values) => {
      for (const key in values) {
        template = template.split(`{${key}}`).join(values[key]);
      }
      return template;
    };

    tb.RconMessages = {
      prefix: '[TeamBalancer]',

      nonDominant: {
        streakBroken: "{team} ended {loser}'s domination streak | ({margin} tickets)",

        narrowVictory: '{team} narrowly defeated {loser} | ({margin} tickets)',
        marginalVictory: '{team} gained ground on {loser} | ({margin} tickets)',
        tacticalAdvantage: '{team} pushed through {loser} | ({margin} tickets)',
        operationalSuperiority: '{team} outmaneuvered {loser} | ({margin} tickets)'
      },

      dominant: {
        steamrolled: '{team} steamrolled {loser} | ({margin} tickets)',
        stomped: '{team} stomped {loser} | ({margin} tickets)',
        dominantVictory: '{team} dominated {loser} | ({margin} tickets)',
        invasionAttackStomp: '{team} crushed defenders with force | ({margin} tickets)',
        invasionDefendStomp: '{team} decisively repelled attackers | ({margin} tickets)'
      },

      scrambleAnnouncement:
        '{team} has reached {count} dominant wins ({margin} tickets) | Scrambling in {delay}s...',
      manualScrambleAnnouncement:
        'Manual team balance triggered by admin | Scramble in {delay}s...',
      dryRunScrambleAnnouncement:
        'Manual dry run scramble triggered by admin | Simulating scramble in {delay}s...',
      immediateManualScramble: 'Manual team balance triggered by admin | Scrambling teams...',
      immediateDryRunScramble:
        'Manual dry run scramble triggered by admin | Simulating immediate scramble...',
      executeScrambleMessage: 'Executing scramble...',
      executeDryRunMessage: 'Dry Run: Simulating scramble...',
      scrambleCompleteMessage: ' Balance has been restored.',
      playerScrambledWarning: "You've been scrambled.", // Changed message

      system: {
        trackingEnabled: 'Team Balancer has been enabled.',
        trackingDisabled: 'Team Balancer has been disabled.'
      }
    };

        tb.onChatMessage = async function (info) {
            const message = info.message?.trim();
            // Only respond to the exact '!teambalancer' command without arguments
            if (!message || message.toLowerCase() !== '!teambalancer') return;

            const steamID = info.steamID;
            const playerName = info.player?.name || 'Unknown';

            // This debug log remains as is, as it's for internal debugging of the request itself
            this.logDebug(`General teambalancer info requested by ${playerName} (${steamID})`);

            const now = Date.now();
            const lastScrambleText = this.lastScrambleTime
                ? `${Math.floor((now - this.lastScrambleTime) / 60000)} minutes ago`
                : 'Never';
            const statusText = this.manuallyDisabled
                ? 'Manually disabled'
                : this.options.enableWinStreakTracking
                    ? 'Active'
                    : 'Disabled in config';

            const winStreakText =
                this.winStreakCount > 0
                    ? `${this.getTeamName(this.winStreakTeam)} has ${this.winStreakCount} dominant win(s)`
                    : `No current win streak`;

            // Formatted response for !teambalancer
            const infoMsg = [
                `=== TeamBalancer ===`,
                `Status: ${statusText}`,
                `Dominance Streak: ${winStreakText}`,
                `Last Scramble: ${lastScrambleText}`,
                `Max Streak Threshold: ${this.options.maxWinStreak} dominant win(s)`
            ].join('\n');

            // Conditional logging based on debugLogs
            if (this.options.debugLogs) {
                console.log(
                    `[TeamBalancer] !teambalancer response sent to ${playerName} (${steamID}):\n${infoMsg}`
                );
            } else {
                // Normal mode: concise log
                console.log(
                    `[TeamBalancer] !teambalancer command received from ${playerName} and responded.`
                );
            }

            try {
                // This is what gets sent in-game via RCON warn
                await this.server.rcon.warn(steamID, infoMsg);
            } catch (err) {
                this.logDebug(`Failed to send info message to ${steamID}:`, err);
            }
        };

    tb.onChatCommand = async function (command) {
      this.logDebug(`Chat command received: !teambalancer ${command.message}`);

      // This line ensures commands are only processed from admin chat when devMode is false
      // The public-facing '!teambalancer' (no args) is handled by onChatMessage.
      if (!this.devMode && command.chat !== 'ChatAdmin') return;

      const message = command.message; // This is the part AFTER !teambalancer
      const steamID = command.steamID;
      const player = command.player; // Get the player object
      const adminName = player?.name || steamID; // Prioritize player name

      // If no subcommand is provided (i.e., just "!teambalancer"),
      // let onChatMessage handle the public status display.
      // This prevents an "Invalid command" response for the public status check.
      if (!message.trim()) {
        this.logDebug(
          'No subcommand provided for !teambalancer (admin chat), letting onChatMessage handle public status.'
        );
        return;
      }

      const args = message.trim().split(/\s+/);
      const subcommand = args[0]?.toLowerCase();

      try {
        switch (subcommand) {
          case 'on': {
            if (!this.manuallyDisabled) {
              this.respond(player, 'Win streak tracking is already enabled.');
              return;
            }
            this.manuallyDisabled = false;
            console.log(`[TeamBalancer] Win streak tracking enabled by ${adminName}`);
            this.respond(player, 'Win streak tracking enabled.');
            try {
              await this.server.rcon.broadcast(
                `${this.RconMessages.prefix} ${this.RconMessages.system.trackingEnabled}`
              );
            } catch (err) {
              this.logWarning(`Failed to broadcast tracking enabled message: ${err.message}`);
            }
            break;
          }
          case 'off': {
            if (this.manuallyDisabled) {
              this.respond(player, 'Win streak tracking is already disabled.');
              return;
            }
            this.manuallyDisabled = true;
            console.log(`[TeamBalancer] Win streak tracking disabled by ${adminName}`);
            this.respond(player, 'Win streak tracking disabled.');
            await this.resetStreak('Manual disable');
            try {
              await this.server.rcon.broadcast(
                `${this.RconMessages.prefix} ${this.RconMessages.system.trackingDisabled}`
              );
            } catch (err) {
              this.logWarning(`Failed to broadcast tracking disabled message: ${err.message}`);
            }
            break;
          }
          case 'dryrun': {
            const arg = args[1]?.toLowerCase();
            if (arg === 'on') {
              this.options.dryRunMode = true;
              console.log(`[TeamBalancer] Dry run mode enabled by ${adminName}`);
              this.respond(player, 'Dry run mode enabled.');
            } else if (arg === 'off') {
              this.options.dryRunMode = false;
              console.log(`[TeamBalancer] Dry run mode disabled by ${adminName}`);
              this.respond(player, 'Dry run mode disabled.');
            } else {
              this.respond(player, 'Usage: !teambalancer dryrun on|off');
            }
            break;
          }
          case 'debug': {
            const arg = args[1]?.toLowerCase();
            if (arg === 'on') {
              this.options.debugLogs = true;
              console.log(`[TeamBalancer] Debug logging enabled by ${adminName}`);
              this.respond(player, 'Debug logging enabled.');
            } else if (arg === 'off') {
              this.options.debugLogs = false;
              console.log(`[TeamBalancer] Debug logging disabled by ${adminName}`);
              this.respond(player, 'Debug logging disabled.');
            } else {
              this.respond(player, 'Usage: !teambalancer debug on|off');
            }
            break;
          }
            case 'status': {
                // Determine the effective plugin status
                const effectiveStatus = this.manuallyDisabled
                    ? 'DISABLED (manual)'
                    : this.options.enableWinStreakTracking
                        ? 'ENABLED'
                        : 'DISABLED (config)';

                // Get information about any pending scrambles
                const scrambleInfo =
                    this.pendingPlayerMoves.size > 0
                        ? `${this.pendingPlayerMoves.size} pending player moves`
                        : 'No active scramble';

                // Format the last scramble timestamp
                const lastScrambleTimeFormatted = this.lastScrambleTime
                    ? new Date(this.lastScrambleTime).toLocaleString()
                    : 'Never';

                // Directly use the cached game mode and team names for administrative output
                const gameMode = this.gameModeCached || 'N/A';
                const team1Name = this.cachedAbbreviations ['1'] || 'Team 1';
                const team2Name = this.cachedAbbreviations ['2'] || 'Team 2';

                // Formatted response for !teambalancer status
                const statusMsg = [
                    `--- TeamBalancer Status ---`,
                    `Plugin Status: ${effectiveStatus}`,
                    `Win Streak: ${this.winStreakTeam ? `${this.cachedAbbreviations [this.winStreakTeam] || `Team ${this.winStreakTeam}`} has ${this.winStreakCount} win(s)` : 'N/A'}`,
                    `Scramble State: ${scrambleInfo}`,
                    `Last Scramble: ${lastScrambleTimeFormatted}`,
                    `Scramble Pending: ${this._scramblePending ? 'Yes' : 'No'}`,
                    `Scramble In Progress: ${this._scrambleInProgress ? 'Yes' : 'No'}`,
                    `Debug Logging: ${this.options.debugLogs ? 'ON' : 'OFF'}`,
                    `Cached Game Mode: ${gameMode}`,
                    `Team 1 Name: ${team1Name}`,
                    `Team 2 Name: ${team2Name}`,
                    `---------------------------`
                ].join('\n');

                this.respond(player, statusMsg);
                break;
            }
          case 'cancel': {
            const cancelled = await this.cancelPendingScramble(steamID, player, false);
            if (cancelled) {
              console.log(`[TeamBalancer] Scramble cancelled by ${adminName}`);
              this.respond(player, 'Pending scramble cancelled.');
            } else if (this._scrambleInProgress) {
              this.respond(player, 'Cannot cancel scramble - it is already executing.');
            } else {
              this.respond(player, 'No pending scramble to cancel.');
            }
            break;
          }
            case 'scramble': {
                if (this._scramblePending || this._scrambleInProgress) {
                    const status = this._scrambleInProgress ? 'executing' : 'pending';
                    this.respond(player, `[WARNING] Scramble already ${status}. Use "!teambalancer cancel" to cancel pending scrambles.`);
                    return;
                }

                const arg = args[1]?.toLowerCase();
                const immediateExecution = (arg === 'now');

                if (!this.options.dryRunMode) {
                    // Live mode — broadcast to players
                    const broadcastMsg = immediateExecution
                        ? `${this.RconMessages.prefix} ${this.RconMessages.immediateManualScramble}`
                        : `${this.RconMessages.prefix} ${this.formatMessage(this.RconMessages.manualScrambleAnnouncement, { delay: this.options.scrambleAnnouncementDelay })}`;

                    try {
                        await this.server.rcon.broadcast(broadcastMsg);
                    } catch (err) {
                        console.error('[TeamBalancer] Error broadcasting scramble message:', err);
                    }
                }

                console.log(`[TeamBalancer] ${adminName} initiated a manual scramble${immediateExecution ? ' (NOW)' : ''}.`);
                this.respond(player,
                    immediateExecution
                        ? (this.options.dryRunMode ? 'Initiating immediate dry run scramble...' : 'Initiating immediate scramble...')
                        : (this.options.dryRunMode ? 'Initiating dry run scramble with countdown...' : 'Initiating manual scramble with countdown...')
                );

                const success = await this.initiateScramble(
                    this.options.dryRunMode,
                    immediateExecution,
                    steamID,
                    player
                );
                if (!success) {
                    this.respond(player, 'Failed to initiate scramble - another scramble may be in progress.');
                }
                break;
            }
            case 'diag': {
                this.logDebug('Diagnostics command received.');

                // Gather all data regardless of debugLogs, as this is the primary purpose of 'diag'
                const players = this.server.players;
                const squads = this.server.squads;
                const t1Players = players.filter((p) => p.teamID === 1);
                const t2Players = players.filter((p) => p.teamID === 2);
                const t1UnassignedPlayers = t1Players.filter((p) => p.squadID === null);
                const t2UnassignedPlayers = t2Players.filter((p) => p.squadID === null);
                const t1Squads = squads.filter((s) => s.teamID === 1);
                const t2Squads = squads.filter((s) => s.teamID === 2);
                const scrambleInfo =
                    this.pendingPlayerMoves.size > 0
                        ? `${this.pendingPlayerMoves.size} pending player moves`
                        : 'No active scramble';

                // Directly use the cached values for diagnostic output
                const gameMode = this.gameModeCached || 'N/A';
                const team1Name = this.cachedAbbreviations ['1'] || 'Team 1';
                const team2Name = this.cachedAbbreviations ['2'] || 'Team 2';

                // Formatted diagnostic message
                const diagMsg = [
                    `--- TeamBalancer Diagnostics for ${adminName} ---`,
                    '',
                    '----- CORE STATUS -----',
                    `Plugin Status: ${this.manuallyDisabled ? 'DISABLED (Manual override)' : 'ENABLED'}`,
                    `Win Streak: ${this.winStreakTeam ? `Team ${this.cachedAbbreviations [this.winStreakTeam] || `Team ${this.winStreakTeam}`} with ${this.winStreakCount} win(s)` : 'N/A'}`,
                    `Max Win Streak Threshold: ${this.options.maxWinStreak} wins`,
                    `Dry Run Mode: ${this.options.dryRunMode ? 'ON' : 'OFF'}`,
                    `Scramble Pending: ${this._scramblePending ? 'Yes' : 'No'}`,
                    `Scramble In Progress: ${this._scrambleInProgress ? 'Yes' : 'No'}`,
                    `Scramble System: ${scrambleInfo}`,
                    '',
                    '----- ROUND/LAYER INFO -----',
                    `Game Mode: ${gameMode}`,
                    `Team 1 Name: ${team1Name}`,
                    `Team 2 Name: ${team2Name}`,
                    '',
                    '----- PLAYER/SQUAD INFO -----',
                    `Total Players: ${players.length}`,
                    `Team 1 Players: ${t1Players.length}`,
                    `Team 2 Players: ${t2Players.length}`,
                    `Team 1 Unassigned Players: ${t1UnassignedPlayers.length}`,
                    `Team 2 Unassigned Players: ${t2UnassignedPlayers.length}`,
                    `Total Squads: ${squads.length}`,
                    `Team 1 Squads: ${t1Squads.length}`,
                    `Team 2 Squads: ${t2Squads.length}`,
                    '',
                    '----- CONFIGURATION -----',
                    `Min Tickets for Dominant Win: ${this.options.minTicketsToCountAsDominantWin}`,
                    `Invasion Attack/Defence Thresholds: ${this.options.invasionAttackTeamThreshold} / ${this.options.invasionDefenceTeamThreshold}`,
                    `Scramble Announcement Delay: ${this.options.scrambleAnnouncementDelay}s`,
                    `Player Swap Retry Interval: ${this.options.changeTeamRetryInterval}ms`,
                    `Max Scramble Time: ${this.options.maxScrambleCompletionTime}ms`,
                    `Use Generic Team Names: ${this.options.useGenericTeamNamesInBroadcasts ? 'YES' : 'NO'}`,
                    `Scramble Percentage: ${this.options.scramblePercentage}`,
                    `Debug Logging: ${this.options.debugLogs ? 'ON' : 'OFF'}`,
                    `------------------------------------------`
                ].join('\n');
                this.respond(player, diagMsg);
                break;
            }
          default: {
            this.respond(
              player,
              'Invalid command. Usage: !teambalancer [on|off | dryrun on|off | status | scramble | cancel | diag | debug on|off]'
            );
          }
        }
      } catch (err) {
        console.error(`[TeamBalancer] Error processing chat command:`, err);
        this.respond(player, `Error processing command: ${err.message}`);
      }
    };

    tb.onScrambleCommand = async function (command) {
      this.logDebug(`Scramble command received: !scramble ${command.message}`);
      // This line ensures commands are only processed from admin chat when devMode is false
      if (!this.devMode && command.chat !== 'ChatAdmin') return;

      const message = command.message;
      const steamID = command.steamID;
      const player = command.player;

      const subcommand = message?.trim().toLowerCase();

      try {
          if (subcommand === 'now') {
              if (this._scrambleInProgress) {
                  this.respond(player, 'A scramble is already in progress.');
                  return;
              }
              if (this._scramblePending) {
                  await this.cancelPendingScramble(steamID, player, true);
              }

              if (!this.options.dryRunMode) {
                  const broadcastMsg = `${this.RconMessages.prefix} ${this.RconMessages.immediateManualScramble}`;
                  try {
                      await this.server.rcon.broadcast(broadcastMsg);
                  } catch (err) {
                      console.error('[TeamBalancer] Error broadcasting immediate scramble message:', err);
                  }
              }

              this.respond(player, this.options.dryRunMode
                  ? 'Initiating immediate dry run scramble...'
                  : 'Initiating immediate scramble...');

              const success = await this.initiateScramble(
                  this.options.dryRunMode,
                  true,
                  steamID,
                  player
              );
              if (!success) {
                  this.respond(player, 'Failed to initiate immediate scramble.');
              }
          } else {
              if (this._scramblePending || this._scrambleInProgress) {
                  const status = this._scrambleInProgress ? 'executing' : 'pending';
                  this.respond(player, `[WARNING] Scramble already ${status}. Use "!scramble cancel" to cancel pending scrambles.`);
                  return;
              }

              if (!this.options.dryRunMode) {
                  const broadcastMsg = `${this.RconMessages.prefix} ${this.formatMessage(this.RconMessages.manualScrambleAnnouncement, { delay: this.options.scrambleAnnouncementDelay })}`;
                  try {
                      await this.server.rcon.broadcast(broadcastMsg);
                  } catch (err) {
                      console.error('[TeamBalancer] Error broadcasting scramble message:', err);
                  }
              }

              this.respond(player, this.options.dryRunMode
                  ? 'Initiating dry run scramble with countdown...'
                  : 'Initiating manual scramble with countdown...');

              const success = await this.initiateScramble(
                  this.options.dryRunMode,
                  false,
                  steamID,
                  player
              );
              if (!success) {
                  this.respond(player, 'Failed to initiate scramble - another scramble may be in progress.');
              }
          }
      } catch (err) {
        console.error(`[TeamBalancer] Error processing scramble command:`, err);
        this.respond(player, `Error processing command: ${err.message}`);
      }
    };
  }
};

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║             SQUAD-PRESERVING TEAM SCRAMBLE ALGORITHM          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * This algorithm efficiently rebalances Squad teams by swapping whole squads
 * or unassigned players. It prioritizes maintaining squad cohesion and
 * respects team size limits (default 50 players). The goal is to introduce
 * a calculated amount of churn to prevent dominant win streaks and ensure fair matches.
 *
 * The process involves:
 * 1.  **Data Preparation:** Normalizing player and squad data, treating unassigned
 * players as individual "pseudo-squads."
 * 2.  **Target Calculation:** Determining the ideal number of players to move
 * based on the configured `scramblePercentage` and current team imbalance.
 * 3.  **Squad Selection:** Using a randomized, iterative approach to find the
 * best combination of squads to swap, scoring candidates based on balance
 * and churn targets.
 * 4.  **Swap Plan Generation:** Creating a detailed plan of player movements.
 * 5.  **Cap Enforcement:** A final adjustment phase to ensure no team exceeds
 * the maximum player limit, prioritizing unassigned or unlocked players for movement.
 */

export const Scrambler = {
  async scrambleTeamsPreservingSquads({
    squads,
    players,
    winStreakTeam,
    log = () => {},
    scramblePercentage = 0.5
  }) {
    const maxTeamSize = 50;
    // Allow for slight overcap due to admin moves, etc.
    const maxTotalPlayersAllowed = maxTeamSize * 2 + 2;

    log(
      `========== Starting Team Scramble (Max cap = ${maxTeamSize}, Total cap = ${maxTotalPlayersAllowed}) ==========`
    );

    // EARLY VALIDATION: Check if scramble is even possible
    const totalPlayers = players.length;
    if (totalPlayers > maxTotalPlayersAllowed) {
      log(
        `CRITICAL: Server has ${totalPlayers} players, exceeding maximum allowed capacity of ${maxTotalPlayersAllowed}`
      );
      log(`Cannot scramble with current player count. Consider removing excess players first.`);
      return []; // Return empty array as no swaps can be made
    }

    if (![1, 2].includes(winStreakTeam)) {
      winStreakTeam = Math.random() < 0.5 ? 1 : 2;
      log(`No win streak team set. Randomly selecting Team ${winStreakTeam} as starting side.`);
    }

    // Create working copy with normalized team IDs
    const workingPlayers = players.map((p) => ({
      ...p,
      teamID: String(p.teamID)
    }));
    const workingSquads = squads.map((s) => ({
      ...s,
      teamID: String(s.teamID),
      players: [...s.players]
    }));

    // Helper function to update player team assignments consistently in the working copy
    const updatePlayerTeam = (steamID, newTeamID) => {
      const player = workingPlayers.find((p) => p.steamID === steamID);
      if (player) {
        player.teamID = String(newTeamID);
      }
    };

    // Helper function to get current team counts, given that all players are on Team 1 or Team 2
    const getCurrentTeamCounts = () => {
      const team1Players = workingPlayers.filter((p) => p.teamID === '1');
      const team2Players = workingPlayers.filter((p) => p.teamID === '2');

      const team1Count = team1Players.length;
      const team2Count = team2Players.length;
      // Unassigned players are those on team 1 or 2 but with squadID === null
      const unassignedCount = workingPlayers.filter((p) => p.squadID === null).length;
      return { team1Count, team2Count, unassignedCount };
    };

    const initialCounts = getCurrentTeamCounts();
    log(
      `Initial team sizes: Team1 = ${initialCounts.team1Count}, Team2 = ${initialCounts.team2Count}, Unassigned (no squad) = ${initialCounts.unassignedCount}`
    );

    // Calculate the target number of players to be moved based on scramblePercentage
    const targetPlayersToMove = Math.round(totalPlayers * scramblePercentage);
    log(`Target players to move (total): ${targetPlayersToMove} (${scramblePercentage * 100}%)`);

    const allSquads = workingSquads.filter((s) => s.players?.length > 0);
    const unassigned = workingPlayers.filter((p) => p.squadID === null);

    log(
      `Total players: ${totalPlayers}, Max per team: ${maxTeamSize}, Scramble Percentage: ${
        scramblePercentage * 100
      }%`
    );

    // Unassigned players are treated as individual pseudo-squads for selection purposes
    const unassignedPseudoSquads = unassigned.map((p) => ({
      id: `Unassigned - ${p.steamID}`,
      teamID: p.teamID, // Their actual team (1 or 2)
      players: [p.steamID]
    }));

    // All squads are candidates, including pseudo-squads of unassigned players
    const filterCandidates = (teamID) =>
      allSquads
        .filter((s) => s.teamID === teamID)
        .concat(unassignedPseudoSquads.filter((s) => s.teamID === teamID));

    const t1Candidates = filterCandidates('1');
    const t2Candidates = filterCandidates('2');

    log(
      `Candidate squads filtered: Team1 = ${t1Candidates.length}, Team2 = ${t2Candidates.length}`
    );

    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };

    // Helper function to select squads based on a target player count
    const selectTieredSquads = (candidates, maxPlayersToSelect, usedSquadIds) => {
      const selected = [];
      let currentCount = 0;

      // Sort candidates by size descending, with unassigned (size 1) last
      const sortedCandidates = [...candidates].sort((a, b) => {
        if (a.players.length === 1 && b.players.length !== 1) return 1;
        if (a.players.length !== 1 && b.players.length === 1) return -1;
        return b.players.length - a.players.length;
      });

      for (const squad of sortedCandidates) {
        if (usedSquadIds.has(squad.id)) {
          continue;
        }

        const size = squad.players.length;
        if (currentCount + size <= maxPlayersToSelect) {
          selected.push(squad);
          usedSquadIds.add(squad.id);
          currentCount += size;
        } else {
          // Allow small overshoots if it's the only way to get close to the target
          if (currentCount < maxPlayersToSelect && currentCount + size - maxPlayersToSelect <= 3) {
            selected.push(squad);
            usedSquadIds.add(squad.id);
            currentCount += size;
          }
        }
      }
      return selected;
    };

    // Revised scoreSwap function to prioritize churn AND balance
    const scoreSwap = (
      selectedT1Squads,
      selectedT2Squads,
      initialT1Count,
      initialT2Count,
      maxTeamSize,
      targetPlayersToMoveOverall
    ) => {
      const sum = (squads) => squads.reduce((n, s) => n + s.players.length, 0);
      const playersMovedFromT1 = sum(selectedT1Squads);
      const playersMovedFromT2 = sum(selectedT2Squads);

      // Total players involved in the swap
      const actualPlayersMoved = playersMovedFromT1 + playersMovedFromT2;

      // Calculate hypothetical new team sizes after the swap
      const hypotheticalNewT1 = initialT1Count - playersMovedFromT1 + playersMovedFromT2;
      const hypotheticalNewT2 = initialT2Count - playersMovedFromT2 + playersMovedFromT1;

      // Score 1: How close are we to the target number of players moved?
      const churnScore = Math.abs(actualPlayersMoved - targetPlayersToMoveOverall);

      // Score 2: How balanced are the final teams?
      const balanceScore = Math.abs(hypotheticalNewT1 - hypotheticalNewT2);

      // Penalties for exceeding maxTeamSize after swap
      const penaltyT1Overcap = Math.max(0, hypotheticalNewT1 - maxTeamSize) * 1000; // High penalty
      const penaltyT2Overcap = Math.max(0, hypotheticalNewT2 - maxTeamSize) * 1000; // High penalty

      // Consider penalties for very small team sizes if total players are high
      const totalPlayers = initialT1Count + initialT2Count;
      const idealTeamSize = totalPlayers / 2;
      let sizeDeviationPenalty = 0;
      if (hypotheticalNewT1 < idealTeamSize - 5 || hypotheticalNewT2 < idealTeamSize - 5) {
        sizeDeviationPenalty += 50; // Moderate penalty for significant underpopulation
      }

      // Combine scores with weights. Churn is important, but balance is also critical.
      // Overcaps are severely penalized.
      let combinedScore =
        churnScore * 10 + // Increased weight for hitting the churn target
        balanceScore * 5 + // Higher weight for final balance
        penaltyT1Overcap +
        penaltyT2Overcap +
        sizeDeviationPenalty;

      // Additional penalty for very low churn if the target is high
      if (
        targetPlayersToMoveOverall > 10 &&
        actualPlayersMoved < targetPlayersToMoveOverall * 0.5
      ) {
        combinedScore += 100; // Significant penalty for not meeting at least half the churn target
      }

      return combinedScore;
    };

    const MAX_ATTEMPTS = 100; // Increased attempts to find a good solution
    let bestScore = Infinity;
    let bestT1SwapCandidates = null;
    let bestT2SwapCandidates = null;

    log(`Starting swap attempts (max ${MAX_ATTEMPTS})`);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const currentUsedSquadIds = new Set(); // Reset for each attempt

      // Shuffle candidates before selection to introduce randomness for each attempt
      shuffle(t1Candidates);
      shuffle(t2Candidates);

      // Aim to move half of the targetPlayersToMove from each side,
      // but allow for slight adjustments to achieve overall balance.
      let targetMoveFromT1 = Math.round(targetPlayersToMove / 2);
      let targetMoveFromT2 = Math.round(targetPlayersToMove / 2);

      // Add some randomness to the target moves to explore different combinations
      targetMoveFromT1 = Math.max(0, targetMoveFromT1 + Math.floor(Math.random() * 5) - 2); // +/- 2 players
      targetMoveFromT2 = Math.max(0, targetMoveFromT2 + Math.floor(Math.random() * 5) - 2); // +/- 2 players

      // Ensure we don't try to move more players than available in candidates
      targetMoveFromT1 = Math.min(
        targetMoveFromT1,
        t1Candidates.reduce((sum, s) => sum + s.players.length, 0)
      );
      targetMoveFromT2 = Math.min(
        targetMoveFromT2,
        t2Candidates.reduce((sum, s) => sum + s.players.length, 0)
      );

      // Select squads based on these target move counts
      const selT1 = selectTieredSquads(t1Candidates, targetMoveFromT1, currentUsedSquadIds);
      const selT2 = selectTieredSquads(t2Candidates, targetMoveFromT2, currentUsedSquadIds);

      const currentScore = scoreSwap(
        selT1,
        selT2,
        initialCounts.team1Count,
        initialCounts.team2Count,
        maxTeamSize,
        targetPlayersToMove
      );

      log(
        `Attempt ${i + 1}: Score = ${currentScore.toFixed(2)}, ` +
          `Move T1->T2 = ${selT1.reduce((n, s) => n + s.players.length, 0)}, ` +
          `Move T2->T1 = ${selT2.reduce((n, s) => n + s.players.length, 0)}, ` +
          `Hypo T1 = ${
            initialCounts.team1Count -
            selT1.reduce((n, s) => n + s.players.length, 0) +
            selT2.reduce((n, s) => n + s.players.length, 0)
          }, ` +
          `Hypo T2 = ${
            initialCounts.team2Count -
            selT2.reduce((n, s) => n + s.players.length, 0) +
            selT1.reduce((n, s) => n + s.players.length, 0)
          }`
      );
      log(`Team1 selected squads IDs: ${selT1.map((s) => s.id).join(', ')}`);
      log(`Team2 selected squads IDs: ${selT2.map((s) => s.id).join(', ')}`);

      const t1Ids = new Set(selT1.map((s) => s.id));
      const t2Ids = new Set(selT2.map((s) => s.id));
      const intersection = [...t1Ids].filter((id) => t2Ids.has(id));

      if (intersection.length > 0) {
        log(
          `WARNING: Duplicate squad selection detected: ${intersection.join(
            ', '
          )} - skipping attempt ${i + 1}`
        );
        continue;
      }

      if (currentScore < bestScore) {
        bestScore = currentScore;
        bestT1SwapCandidates = selT1;
        bestT2SwapCandidates = selT2;
        log(`New best score found: ${bestScore.toFixed(2)} at attempt ${i + 1}`);
        // Optimization: If a very good score is found, no need to continue
        if (bestScore <= 5) {
          // A score of 0-5 indicates very good balance and churn
          log(`Very good score (${bestScore}) found. Breaking early from swap attempts.`);
          break;
        }
      }
    }

    if (!bestT1SwapCandidates || !bestT2SwapCandidates) {
      log('No valid swap solution found within attempt limit.');
      return []; // Return empty array if no solution found
    }

    // FINAL VALIDATION: Double-check no duplicates in best solution
    const finalT1Ids = new Set(bestT1SwapCandidates.map((s) => s.id));
    const finalT2Ids = new Set(bestT2SwapCandidates.map((s) => s.id));
    const finalIntersection = [...finalT1Ids].filter((id) => finalT2Ids.has(id));

    if (finalIntersection.length > 0) {
      log(`CRITICAL ERROR: Final solution has duplicate squads: ${finalIntersection.join(', ')}`);
      log('Aborting scramble to prevent team count corruption.');
      return []; // Return empty array if critical error
    }

    const preSwapCounts = getCurrentTeamCounts();
    log(
      `Pre-swap team sizes: Team1 = ${preSwapCounts.team1Count}, Team2 = ${preSwapCounts.team2Count}`
    );

    // Use a Map to store final player moves to ensure no player is moved twice
    const finalPlayerMovesMap = new Map(); // Map<steamID, {steamID, targetTeamID}>

    // Collect players from bestT1SwapCandidates to move to Team 2
    for (const squad of bestT1SwapCandidates) {
      for (const steamID of squad.players) {
        finalPlayerMovesMap.set(steamID, { steamID, targetTeamID: '2' });
        updatePlayerTeam(steamID, '2'); // Update internal working copy
      }
    }

    // Collect players from bestT2SwapCandidates to move to Team 1
    for (const squad of bestT2SwapCandidates) {
      for (const steamID of squad.players) {
        finalPlayerMovesMap.set(steamID, { steamID, targetTeamID: '1' });
        updatePlayerTeam(steamID, '1'); // Update internal working copy
      }
    }

    const postInitialSwapCounts = getCurrentTeamCounts();
    log(
      `Post-initial-swap internal team sizes: Team1 = ${postInitialSwapCounts.team1Count}, Team2 = ${postInitialSwapCounts.team2Count}`
    );

    // Helper function to get players for trimming, prioritizing unassigned, then unlocked squads, then locked squads
    // This version EXCLUDES players already in finalPlayerMovesMap
    const getPlayersForTrimming = (
      teamID,
      currentWorkingPlayers,
      currentWorkingSquads,
      existingMovesMap
    ) => {
      const playersOnTeam = currentWorkingPlayers.filter((p) => p.teamID === String(teamID));

      // Filter out players who are already part of the main swap plan
      const eligiblePlayers = playersOnTeam.filter((p) => !existingMovesMap.has(p.steamID));

      const unassignedPlayers = eligiblePlayers.filter((p) => p.squadID === null);

      const playersInSquads = eligiblePlayers.filter((p) => p.squadID !== null);

      // Map players to their squad's locked status
      const playersWithSquadStatus = playersInSquads.map((p) => {
        const squad = currentWorkingSquads.find((s) => s.id === p.squadID);
        return {
          ...p,
          isLocked: squad ? squad.locked : false // Default to not locked if squad not found (shouldn't happen)
        };
      });

      const unlockedSquadPlayers = playersWithSquadStatus.filter((p) => !p.isLocked);
      const lockedSquadPlayers = playersWithSquadStatus.filter((p) => p.isLocked);

      // Prioritize: Unassigned -> Unlocked Squad Players -> Locked Squad Players
      return [...unassignedPlayers, ...unlockedSquadPlayers, ...lockedSquadPlayers];
    };

    let team1Overcap = postInitialSwapCounts.team1Count - maxTeamSize;
    let team2Overcap = postInitialSwapCounts.team2Count - maxTeamSize;

    // Iteratively trim until no more moves are possible or caps are met
    let madeProgress = true;
    while (madeProgress && (team1Overcap > 0 || team2Overcap > 0)) {
      madeProgress = false;

      // Attempt to trim Team 1 if overcapped
      if (team1Overcap > 0) {
        // Pass finalPlayerMovesMap to exclude already-moved players
        const playersToConsider = getPlayersForTrimming(
          '1',
          workingPlayers,
          workingSquads,
          finalPlayerMovesMap
        );
        for (const player of playersToConsider) {
          // Check if target team has space BEFORE attempting to move
          if (getCurrentTeamCounts().team2Count < maxTeamSize) {
            finalPlayerMovesMap.set(player.steamID, { steamID: player.steamID, targetTeamID: '2' });
            updatePlayerTeam(player.steamID, '2');
            log(`Trimming: Player ${player.steamID} from Team 1 to Team 2 (overcap fix)`);
            madeProgress = true;
            break; // Move one player at a time and re-evaluate
          }
        }
      }

      // Recalculate counts after potential T1->T2 trimming
      const currentCountsAfterT1Trim = getCurrentTeamCounts();
      team1Overcap = currentCountsAfterT1Trim.team1Count - maxTeamSize;
      team2Overcap = currentCountsAfterT1Trim.team2Count - maxTeamSize;

      // Attempt to trim Team 2 if overcapped
      if (team2Overcap > 0) {
        // Pass finalPlayerMovesMap to exclude already-moved players
        const playersToConsider = getPlayersForTrimming(
          '2',
          workingPlayers,
          workingSquads,
          finalPlayerMovesMap
        );
        for (const player of playersToConsider) {
          // Check if target team has space BEFORE attempting to move
          if (getCurrentTeamCounts().team1Count < maxTeamSize) {
            finalPlayerMovesMap.set(player.steamID, { steamID: player.steamID, targetTeamID: '1' });
            updatePlayerTeam(player.steamID, '1');
            log(`Trimming: Player ${player.steamID} from Team 2 to Team 1 (overcap fix)`);
            madeProgress = true;
            break; // Move one player at a time and re-evaluate
          }
        }
      }

      // Recalculate counts for the next iteration
      const currentCounts = getCurrentTeamCounts();
      team1Overcap = currentCounts.team1Count - maxTeamSize;
      team2Overcap = currentCounts.team2Count - maxTeamSize;
    }

    const finalInternalCounts = getCurrentTeamCounts();
    log(
      `Final internal team sizes after all adjustments: Team1 = ${finalInternalCounts.team1Count}, Team2 = ${finalInternalCounts.team2Count}, Unassigned (no squad) = ${finalInternalCounts.unassignedCount}`
    );

    // Final check for unresolvable overcaps given the constraints
    const finalTeam1Overcap = finalInternalCounts.team1Count - maxTeamSize;
    const finalTeam2Overcap = finalInternalCounts.team2Count - maxTeamSize;

    if (finalTeam1Overcap > 0 || finalTeam2Overcap > 0) {
      log(
        `WARNING: Scramble plan results in teams still exceeding caps after all possible internal moves.`
      );
      log(`Team1 still over by: ${finalTeam1Overcap}, Team2 still over by: ${finalTeam2Overcap}`);
      log(`This may require manual intervention or a change in balancing strategy.`);
    }

    log(`========== Scramble Plan Generated ==========`);
    log(`Total player moves in plan: ${finalPlayerMovesMap.size}`);
    log(
      `Final desired balance: Team1 = ${finalInternalCounts.team1Count}, Team2 = ${finalInternalCounts.team2Count}`
    );
    log(`Unassigned players in plan: ${finalInternalCounts.unassignedCount}`);

    return Array.from(finalPlayerMovesMap.values()); // Return the plan to the TeamBalancer
  }
};
