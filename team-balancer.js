import BasePlugin from './base-plugin.js';
import Scrambler from './tb-scrambler.js';
import SwapExecutor from './tb-swap-executor.js';
import CommandHandlers from './tb-commands.js';
import TBDatabase from './tb-database.js';

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
  static get version() {
    return '2.0.0';
  }

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
    this.db = new TBDatabase(this.server, this.options, connectors);

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

    this._scrambleInProgress = false;

    // A single place to store bound listeners for easy cleanup
    this.listeners = {};

    // Bind methods once for consistent reference
    this.listeners.onRoundEnded = this.onRoundEnded.bind(this);
    this.listeners.onNewGame = this.onNewGame.bind(this);
    this.listeners.onChatCommand = this.onChatCommand.bind(this);
    this.listeners.onScrambleCommand = this.onScrambleCommand.bind(this);
    this.listeners.onChatMessage = this.onChatMessage.bind(this);
    // processScrambleRetries moved to SwapExecutor; no binding needed here

    this._gameInfoPollingInterval = null;
    this.gameModeCached = null;
    this.cachedAbbreviations = {};
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
    // Initialize database helper and load state
    try {
      const dbState = await this.db.initDB(this.log);
      if (dbState && !dbState.isStale) {
        this.winStreakTeam = dbState.winStreakTeam;
        this.winStreakCount = dbState.winStreakCount;
        this.lastSyncTimestamp = dbState.lastSyncTimestamp;
        this.lastScrambleTime = dbState.lastScrambleTime;
        this.logDebug(`[DB] Restored state: team=${this.winStreakTeam}, count=${this.winStreakCount}`);
      } else if (dbState) {
        this.logDebug('[DB] State stale; resetting.');
        this.lastScrambleTime = dbState.lastScrambleTime;
        await this.db.saveState(null, 0, this.log);
      }
    } catch (err) {
      this.logWarning(`[DB] mount/initDB failed: ${err.message}`);
    }
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
    return this.cachedAbbreviations[teamID] || `Team ${teamID}`;
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
      this.cachedAbbreviations = Object.assign({}, this.cachedAbbreviations, newAbbreviations);
      this.logDebug(`Updated cached abbreviations: ${JSON.stringify(this.cachedAbbreviations)}`);
    }

    const hasBothTeams = Object.keys(this.cachedAbbreviations).length === 2;

    // Stop polling once two teams are found in the cache.
    if (hasBothTeams) {
      this.logDebug(
        `Polling successful! Cached abbreviations: ${JSON.stringify(this.cachedAbbreviations)}`
      );
      this.stopPollingTeamAbbreviations();
    }
  }

  extractTeamAbbreviationsFromRoles() {
    this.logDebug('extractTeamAbbreviationsFromRoles: Starting extraction from player roles.');
    const abbreviations = {};
    for (const player of this.server.players) {
      const teamID = player.teamID;
      if (!teamID) {
        this.logDebug(
          `extractTeamAbbreviationsFromRoles: Skipping player ${player.name} with no teamID.`
        );
        continue;
      }

      if (abbreviations[teamID]) {
        this.logDebug(
          `extractTeamAbbreviationsFromRoles: Skipping player ${player.name}, abbreviation for Team ${teamID} already found.`
        );
        continue;
      }

      const role = player.roles?.[0] || player.role; // Check for player.role as fallback
      if (role) {
        // New regex to match abbreviations like "PLANMC" at the start of the string
        const match = role.match(/^([A-Z]{2,6})_/);
        if (match) {
          this.logDebug(
            `extractTeamAbbreviationsFromRoles: Found abbreviation ${match[1]} for Team ${teamID} from role ${role}.`
          );
          abbreviations[teamID] = match[1];
        } else {
          this.logDebug(
            `extractTeamAbbreviationsFromRoles: No abbreviation found in role ${role} for player ${player.name}.`
          );
        }
      } else {
        this.logDebug(
          `extractTeamAbbreviationsFromRoles: No role found for player ${player.name}.`
        );
      }
    }
    this.logDebug(
      `extractTeamAbbreviationsFromRoles: Finished extraction. Result: ${JSON.stringify(
        abbreviations
      )}`
    );
    return abbreviations;
  }

  // Database operations moved into tb-database.js (TBDatabase)

  // ╔═══════════════════════════════════════╗
  // ║         ROUND EVENT HANDLERS          ║
  // ╚═══════════════════════════════════════╝

  async onNewGame() {
    try {
      this.logDebug('[onNewGame] Event triggered');

      // Reset cached game and team info
      this.gameModeCached = null;
      this.cachedAbbreviations = {};
      this.startPollingGameInfo();
      this.startPollingTeamAbbreviations(); // Add this line

      this._scrambleInProgress = false;
      this._scramblePending = false;

      // ... (rest of the onNewGame function remains unchanged)
      // Squad servers swap sides between games, so winning team IDs flip.
      // This flip maintains streak continuity and prevents incorrect resets.
      try {
        const flippedTeam = this.winStreakTeam === 1 ? 2 : this.winStreakTeam === 2 ? 1 : null;
        const dbRes = await this.db.saveState(flippedTeam, this.winStreakCount, this.log);
        if (dbRes) {
          this.winStreakTeam = dbRes.winStreakTeam;
          this.winStreakCount = dbRes.winStreakCount;
          this.lastSyncTimestamp = dbRes.lastSyncTimestamp;
        }
      } catch (err) {
        this.logWarning(`[DB] onNewGame saveState failed: ${err.message}`);
      }
    } catch (err) {
      this.log.error(`[TeamBalancer] Error in onNewGame: ${err.message}`);
      // Fallback: Attempt to reset state to prevent cascading issues
      this.winStreakTeam = null;
      this.winStreakCount = 0;
      try {
        const dbRes = await this.db.saveState(null, 0, this.log);
        this.winStreakTeam = null;
        this.winStreakCount = 0;
        if (dbRes) this.lastSyncTimestamp = dbRes.lastSyncTimestamp;
      } catch (err) {
        this.logWarning(`[DB] onNewGame fallback saveState failed: ${err.message}`);
      }
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
      this.logDebug(
        `Streak info: nextStreakCount=${nextStreakCount}, maxStreakReached=${maxStreakReached}`
      );

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
      this.logDebug(
        `Final team names for broadcast: winnerName=${teamNames.winnerName}, loserName=${teamNames.loserName}`
      );

      if (!isDominant) {
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

      try {
        const dbRes = await this.db.saveState(winnerID, nextStreakCount, this.log);
        if (dbRes) {
          this.winStreakTeam = dbRes.winStreakTeam;
          this.winStreakCount = dbRes.winStreakCount;
          this.lastSyncTimestamp = dbRes.lastSyncTimestamp;
        }
        this.logDebug(`New win streak started: team ${this.winStreakTeam}, count ${this.winStreakCount}`);
      } catch (err) {
        this.logWarning(`[DB] saveState failed: ${err.message}`);
      }

      const scrambleComing = this.winStreakCount >= this.options.maxWinStreak;
      this.logDebug(
        `Scramble check: winStreakCount=${this.winStreakCount}, maxWinStreak=${this.options.maxWinStreak}, scrambleComing=${scrambleComing}`
      );

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

  async resetStreak(reason = 'unspecified') {
    this.logDebug(`Resetting streak: ${reason}`);
    try {
      const dbRes = await this.db.saveState(null, 0, this.log);
      this.winStreakTeam = null;
      this.winStreakCount = 0;
      if (dbRes) this.lastSyncTimestamp = dbRes.lastSyncTimestamp;
    } catch (err) {
      this.logWarning(`[DB] resetStreak saveState failed: ${err.message}`);
    }
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
        try {
          const res = await this.db.saveScrambleTime(scrambleTimestamp, this.log);
          if (res && res.lastScrambleTime) this.lastScrambleTime = res.lastScrambleTime;
        } catch (err) {
          this.logWarning(`[DB] saveScrambleTime failed: ${err.message}`);
        }
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
    if (this.swapExecutor) {
      await this.swapExecutor.waitForCompletion(timeoutMs, intervalMs);
    } else {
      this.logDebug('No swapExecutor present; nothing to wait for.');
    }
    this.logDebug('All player moves processed or timeout reached.');
  }

  // Swap execution delegated to SwapExecutor for clarity and modularity.
  async reliablePlayerMove(steamID, targetTeamID, isSimulated = false) {
    if (isSimulated) {
      this.logDebug?.(`[Dry Run] Would queue player move for ${steamID} to team ${targetTeamID}`);
      return;
    }

    if (!this.swapExecutor) {
      this.swapExecutor = new SwapExecutor(this.server, this.options, this.log, this.RconMessages);
    }

    return this.swapExecutor.queueMove(steamID, targetTeamID, isSimulated);
  }

  cleanupScrambleTracking() {
    if (this.swapExecutor) {
      this.swapExecutor.cleanup();
      this.swapExecutor = null;
    }
    this._scrambleInProgress = false;
  }
}