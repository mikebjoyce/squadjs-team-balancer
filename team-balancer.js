import BasePlugin from './base-plugin.js';

export default class TeamBalancer extends BasePlugin {
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
   * - Handles RAAS, AAS, and Invasion with separate logic per mode.
   * - Supports real-time diagnostics and dry-run simulation via chat.
   * - Sends warning messages to swapped players (optional).
   * - Logs all actions with verbose debug output (configurable).
   * - Reliable swap system with 10-second retry mechanism.
   * - Rich Discord integration with embeds and notifications.
   *
   * SCRAMBLE STRATEGY:
   * - Uses randomized backtracking to select balanced swap sets.
   * - Applies swap actions through RCON using SquadJS interfaces.
   * - Tracks and retries failed swaps over 10-second period.
   * - Fills or trims teams after swap to achieve 50-player parity.
   * - Breaks squads only if necessary to enforce hard team caps.
   * - Fully supports lobbies with only unassigned players.
   *
   * DISCORD INTEGRATION:
   * - Win streak progression notifications with rich embeds.
   * - Scramble countdown and completion announcements.
   * - Admin command confirmations and status reports.
   * - Separate admin channel support for command responses.
   * - Automatic fallback when Discord is unavailable.
   * - Color-coded embeds with team info and timestamps.
   *
   * INSTALLATION:
   * Add this to your `config.json` plugins array:
   *
   * {
   *   "plugin": "TeamBalancer",
   *   "enabled": true,
   *   "options": {
   *     "enableWinStreakTracking": true,
   *     "maxWinStreak": 2,
   *     "minTicketsToCountAsDominantWin": 150,
   *     "invasionAttackTeamThreshold": 300,
   *     "invasionDefenceTeamThreshold": 650,
   *     "scrambleAnnouncementDelay": 12,
   *     "showWinStreakMessages": true,
   *     "warnOnSwap": true,
   *     "dryRunMode": true,
   *     "debugLogs": false,
   *     "scrambleRetryInterval": 1000,
   *     "scrambleCompletionTimeout": 10000,
   *     "discordEnabled": true,
   *     "discordChannelID": "your-channel-id-here",
   *     "discordAdminChannelID": "optional-admin-channel-id",
   *     "discordEmbedColor": 5814783,
   *     "discordScrambleColor": 16776960,
   *     "discordWinStreakColor": 16711680,
   *     "discordIncludeServerName": true
   *   }
   * }
   *
   * ADMIN COMMANDS:
   *   !teambalancer on|off           → Enable/disable win streak tracking system
   *   !teambalancer status           → View win streak and plugin status
   *   !teambalancer dryrun on|off    → Enable/disable dry-run (manual only)
   *   !teambalancer diag             → Runs diagnostic with 3 dryrun scrambles
   *   !teambalancer scramble         → Manually trigger scramble with countdown
   *   !teambalancer cancel           → Cancel pending scramble countdown
   *   !scramble                      → Shorthand for manual scramble with countdown
   *   !scramble now                  → Immediate scramble (no countdown)
   *   !scramble cancel               → Cancel pending scramble countdown
   *
   * CHAT COMMANDS:
   *   !teambalancer                  → Shows current winstreak, last scramble, and plugin status
   *
   * CONFIGURATION OPTIONS:
   *   Core Settings:
   *   enableWinStreakTracking        → Enable automatic scrambling logic
   *   maxWinStreak                   → Wins needed to trigger scramble
   *   minTicketsToCountAsDominantWin → Required ticket diff (non-Invasion)
   *   invasionAttackTeamThreshold    → Threshold for attackers (Invasion)
   *   invasionDefenceTeamThreshold   → Threshold for defenders (Invasion)
   *   scrambleAnnouncementDelay      → Delay (sec) before scramble executes
   *   dryRunMode                     → Manual scramble simulation toggle
   *   showWinStreakMessages          → Broadcast win streak status
   *   warnOnSwap                     → Notify players who are team-swapped
   *   debugLogs                      → Print verbose internal debug output
   *   scrambleRetryInterval          → Milliseconds between swap retry attempts (default: 1000)
   *   scrambleCompletionTimeout      → Total time to keep retrying swaps in ms (default: 10000)
   *
   *   Discord Settings:
   *   discordEnabled                 → Enable Discord notifications (default: false)
   *   discordChannelID               → Primary Discord channel ID for notifications
   *   discordAdminChannelID          → Optional separate channel for admin responses
   *   discordEmbedColor              → Default embed color (decimal format, default: 5814783)
   *   discordScrambleColor           → Color for scramble-related embeds (default: 16776960)
   *   discordWinStreakColor          → Color for win streak embeds (default: 16711680)
   *   discordIncludeServerName       → Include server name in embed footers (default: true)
   *
   * DISCORD NOTIFICATIONS:
   *   🔥 Win Streak Progress         → Sent when teams reach significant win streaks
   *   🚨 Scramble Triggers           → Automatic scramble announcements with countdown
   *   ⚖️ Manual Scrambles            → Admin-initiated scramble confirmations
   *   ✅ Scramble Completion         → Success notifications with team balance info
   *   ❌ Scramble Cancellations      → Admin cancellation confirmations
   *   📊 Status Reports              → Rich embed responses to admin status commands
   *
   * DEV MODE:
   *   Set devMode = true to enable command testing in all chat (not admin-only).
   *
   * AUTHOR:
   *   Slacker (Discord: real_slacker)
   *
   * ════════════════════════════════════════════════════════════════
   */

  /**
   * ============================================
   *                  SETUP & INIT
   * ============================================
   *
   * This section defines plugin metadata, default options,
   * lifecycle hooks, and constructor logic for TeamBalancer.
   * It handles event bindings, state setup, and config validation.
   *
   * CONTENTS:
   *  - Plugin description and SquadJS registration metadata
   *  - Option schema and default values
   *  - Validation logic for critical thresholds
   *  - Constructor: initializes state and registers command handlers
   *  - mount() / unmount(): attach and detach event listeners
   */
  static get description() {
    return 'Tracks dominant wins by team ID and scrambles teams if one team wins too many rounds.';
  }

  static get defaultEnabled() {
    return true;
  }

  static get optionsSpecification() {
    return {
      // Core TeamBalancer Options
      enableWinStreakTracking: {
        default: true,
        type: 'boolean'
      },
      maxWinStreak: {
        default: 2,
        type: 'number'
      },
      minTicketsToCountAsDominantWin: {
        default: 150,
        type: 'number'
      },
      invasionAttackTeamThreshold: {
        default: 300,
        type: 'number'
      },
      invasionDefenceTeamThreshold: {
        default: 650,
        type: 'number'
      },
      scrambleAnnouncementDelay: {
        default: 12,
        type: 'number'
      },
      showWinStreakMessages: {
        default: true,
        type: 'boolean'
      },
      warnOnSwap: {
        default: true,
        type: 'boolean'
      },
      debugLogs: {
        default: false,
        type: 'boolean'
      },
      dryRunMode: {
        default: true,
        type: 'boolean'
      },
      scrambleRetryInterval: {
        default: 1000,
        type: 'number'
      },
      scrambleCompletionTimeout: {
        default: 10000,
        type: 'number'
      },

      // Discord Integration Options
      discordEnabled: {
        default: false,
        type: 'boolean'
      },
      discordChannelID: {
        default: '',
        type: 'string'
      },
      discordAdminChannelID: {
        default: '',
        type: 'string'
      },
      discordEmbedColor: {
        default: 5814783, // Blue
        type: 'number'
      },
      discordScrambleColor: {
        default: 16776960, // Yellow
        type: 'number'
      },
      discordWinStreakColor: {
        default: 16711680, // Red
        type: 'number'
      },
      discordIncludeServerName: {
        default: true,
        type: 'boolean'
      },
      discordClient: {
        required: true,
        connector: 'discord',
        default: 'discord',
        description: 'The Discord connector name to use.'
      }
    };
  }

  validateOptions() {
    if (this.options.scrambleAnnouncementDelay < 10) {
      this.logWarning(
        ` scrambleAnnouncementDelay (${this.options.scrambleAnnouncementDelay}s) too low. Enforcing minimum 10 seconds.`
      );
      this.options.scrambleAnnouncementDelay = 10;
    }

    if (this.options.scrambleRetryInterval < 500) {
      this.logWarning(
        ` scrambleRetryInterval (${this.options.scrambleRetryInterval}ms) too low. Enforcing minimum 500ms.`
      );
      this.options.scrambleRetryInterval = 500;
    }

    if (this.options.scrambleCompletionTimeout < 5000) {
      this.logWarning(
        ` scrambleCompletionTimeout (${this.options.scrambleCompletionTimeout}ms) too low. Enforcing minimum 5000ms.`
      );
      this.options.scrambleCompletionTimeout = 5000;
    }
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);
    this.devMode = false; // <-- DEV MODE TOGGLE
    CommandHandlers.register(this);
    this.server.discordClient = connectors.discord;
    DiscordIntegration.register(this);
    this.winStreakTeam = null;
    this.winStreakCount = 0;
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

    this.onRoundEnded = this.onRoundEnded.bind(this);
    this.onNewGame = this.onNewGame.bind(this);
    this._cachedLayer = null;
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
    this.logDebug('Mounting plugin.');
    this.server.on('ROUND_ENDED', this.onRoundEnded.bind(this));
    this.server.on('NEW_GAME', this.onNewGame.bind(this));
    this.server.on('CHAT_COMMAND:teambalancer', this.onChatCommand.bind(this));
    this.server.on('CHAT_COMMAND:scramble', this.onScrambleCommand.bind(this));
    this.server.on('CHAT_MESSAGE', this.onChatMessage.bind(this));
    this.validateOptions();
  }

  async unmount() {
    this.logDebug('Unmounting plugin.');
    this.server.removeListener('ROUND_ENDED', this.onRoundEnded);
    this.server.removeListener('NEW_GAME', this.onNewGame);
    this.server.removeListener('CHAT_COMMAND:teambalancer', this.onChatCommand);
    this.server.removeListener('CHAT_COMMAND:scramble', this.onScrambleCommand);
    this.server.removeListener('CHAT_MESSAGE', this.onChatMessage);

    if (this._scrambleTimeout) clearTimeout(this._scrambleTimeout);
    if (this._scrambleCountdownTimeout) clearTimeout(this._scrambleCountdownTimeout);
    this.cleanupScrambleTracking();
    this._scrambleInProgress = false;
  }

  // ╔═══════════════════════════════════════╗
  // ║         ROUND EVENT HANDLERS          ║
  // ╚═══════════════════════════════════════╝

  async onNewGame() {
    this.logDebug('[onNewGame] Event triggered');
    this.gameModeCached = this.server.gameMode;
    this.logDebug(`Game mode is ${this.gameModeCached}`);

    // Clear cached team names initially
    this.cachedTeam1Name = null;
    this.cachedTeam2Name = null;

    // Try to get layer info with retry logic
    await this.loadLayerInfoWithRetry();

    this.gameModeCached = this.server.gameMode;

    if (!this.gameModeCached) {
      this.logWarning('Cached game mode is undefined or null at NEW_GAME event.');
    } else if (this.gameModeCached.toLowerCase().includes('invasion')) {
      this.logDebug(`Game mode is invasion (${this.gameModeCached})`);
    } else {
      this.logDebug(`Game mode is ${this.gameModeCached}`);
    }

    this._scrambleInProgress = false;
    this._scramblePending = false;

    // >>>> NOTE: winStreakTeam flipping MUST be preserved <<<<
    // Squad servers swap sides between games, so winning team IDs flip.
    // This flip maintains streak continuity and prevents incorrect resets.
    // Removing this breaks streak tracking and scramble triggers.
    if (this.winStreakTeam === 1) {
      this.winStreakTeam = 2;
    } else if (this.winStreakTeam === 2) {
      this.winStreakTeam = 1;
    }
  }

  async onRoundEnded(data) {
    this.logDebug(`Round ended event received: ${JSON.stringify(data)}`);

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

    const nextStreakCount = this.winStreakTeam === winnerID ? this.winStreakCount + 1 : 1;
    const maxStreakReached = nextStreakCount >= this.options.maxWinStreak;

    let winnerName = (await this.getTeamName(winnerID)) || `Team ${winnerID}`;
    let loserName = (await this.getTeamName(3 - winnerID)) || `Team ${3 - winnerID}`;

    if (!/^The\s+/i.test(winnerName) && !winnerName.startsWith('Team ')) {
      winnerName = 'The ' + winnerName;
    }
    if (!/^The\s+/i.test(loserName) && !loserName.startsWith('Team ')) {
      loserName = 'The ' + loserName;
    }

    const teamNames = { winnerName, loserName };

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

        const message = `${this.RconMessages.prefix} ${this.formatMessage(template, {
          team: teamNames.winnerName,
          loser: teamNames.loserName,
          margin
        })}`;
        this.logDebug(`Broadcasting non-dominant message: ${message}`);
        await this.server.rcon.broadcast(message);
      }
      return this.resetStreak(`Non-dominant win by team ${winnerID}`);
    }

    this.logDebug('Dominant win detected under standard mode.');
    this.logDebug(
      `Current streak: winStreakTeam=${this.winStreakTeam}, winStreakCount=${this.winStreakCount}`
    );

    const streakBroken = this.winStreakTeam && this.winStreakTeam !== winnerID;
    if (streakBroken) {
      this.logDebug(`Streak broken. Previous streak team: ${this.winStreakTeam}`);
      this.resetStreak('Streak broken by opposing team');
    }

    this.winStreakTeam = winnerID;
    this.winStreakCount = nextStreakCount;
    this.logDebug(
      `New win streak started: team ${this.winStreakTeam}, count ${this.winStreakCount}`
    );

    const scrambleComing = this.winStreakCount >= this.options.maxWinStreak;

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

      const message = `${this.RconMessages.prefix} ${this.formatMessage(template, {
        team: teamNames.winnerName,
        loser: teamNames.loserName,
        margin
      })}`;
      this.logDebug(`Broadcasting dominant win message: ${message}`);
      await this.server.rcon.broadcast(message);
    }

    this.logDebug(
      `Evaluating scramble trigger: streakCount=${this.winStreakCount}, streakTeam=${this.winStreakTeam}, margin=${margin}`
    );
    this.logDebug(
      `_scramblePending=${this._scramblePending}, _scrambleInProgress=${this._scrambleInProgress}`
    );

    if (this._scramblePending || this._scrambleInProgress) return;

    if (this.winStreakCount >= this.options.maxWinStreak) {
      const message = this.formatMessage(this.RconMessages.scrambleAnnouncement, {
        team: teamNames.winnerName,
        count: this.winStreakCount,
        margin,
        delay: this.options.scrambleAnnouncementDelay
      });
      await this.server.rcon.broadcast(`${this.RconMessages.prefix} ${message}`);
      this.initiateScramble(false, false);
    }
  }

  resetStreak(reason = 'unspecified') {
    this.logDebug(`Resetting streak: ${reason}`);
    this.winStreakTeam = null;
    this.winStreakCount = 0;
    this._scramblePending = false;
  }

  async getTeamName(teamID) {
    if (teamID === 1 && this.cachedTeam1Name) return this.cachedTeam1Name;
    if (teamID === 2 && this.cachedTeam2Name) return this.cachedTeam2Name;

    try {
      const layer = await this.server.currentLayer;
      if (layer?.teams?.[teamID - 1]?.name) {
        const name = layer.teams[teamID - 1].name;
        if (teamID === 1) this.cachedTeam1Name = name;
        if (teamID === 2) this.cachedTeam2Name = name;
        return name;
      }
      if (layer?.teams?.[teamID - 1]?.faction) {
        const faction = layer.teams[teamID - 1].faction;
        if (teamID === 1) this.cachedTeam1Name = faction;
        if (teamID === 2) this.cachedTeam2Name = faction;
        return faction;
      }
    } catch (err) {
      this.logDebug(`Error getting team name for team ${teamID}: ${err.message}`);
    }

    return `Team ${teamID}`;
  }

  async loadLayerInfoWithRetry(maxRetries = 5, delayMs = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logDebug(`Attempting to load layer info (attempt ${attempt}/${maxRetries})`);

        const layer = await this.server.currentLayer;

        if (!layer) {
          this.logDebug(`Layer is still null on attempt ${attempt}, retrying in ${delayMs}ms...`);
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          } else {
            this.logWarning('[TeamBalancer] Layer remained null after all retry attempts');
            return;
          }
        }

        // Successfully got layer info
        this.logDebug(
          `[TeamBalancer] Layer loaded: ${layer.layer || layer.name} (${
            layer.map?.name || 'Unknown map'
          })`
        );
        this.logDebug(`[TeamBalancer] Layer teams: ${JSON.stringify(layer.teams, null, 2)}`);

        const team1 = layer?.teams?.[0];
        const team2 = layer?.teams?.[1];

        this.cachedTeam1Name = team1?.name || null;
        this.cachedTeam2Name = team2?.name || null;

        if (!this.cachedTeam1Name || !this.cachedTeam2Name) {
          this.logWarning(
            `[TeamBalancer] One or both team names are null. T1: ${this.cachedTeam1Name}, T2: ${this.cachedTeam2Name}`
          );

          // Fallback: try to get team names from faction info
          if (team1?.faction && team2?.faction) {
            this.cachedTeam1Name = team1.faction;
            this.cachedTeam2Name = team2.faction;
            this.logDebug(
              `[TeamBalancer] Using faction names as fallback: T1=${this.cachedTeam1Name}, T2=${this.cachedTeam2Name}`
            );
          }
        } else {
          this.logDebug(
            `[TeamBalancer] Cached team names: 1=${this.cachedTeam1Name}, 2=${this.cachedTeam2Name}`
          );
        }

        return; // Success, exit retry loop
      } catch (err) {
        this.logWarning(
          `[TeamBalancer] Error fetching team names on attempt ${attempt}:`,
          err.message
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          this.logWarning('[TeamBalancer] Failed to load layer info after all retry attempts');
        }
      }
    }
  }

  // ╔═══════════════════════════════════════╗
  // ║        SCRAMBLE EXECUTION FLOW        ║
  // ╚═══════════════════════════════════════╝

  async initiateScramble(isSimulated = false, immediate = false, steamID = null, player = null) {
    if (this._scramblePending || this._scrambleInProgress) {
      this.logDebug('Scramble initiation blocked: scramble already pending or in progress.');
      return false;
    }

    if (!immediate && !isSimulated) {
      const delaySeconds = this.options.scrambleAnnouncementDelay;
      this._scramblePending = true;

      const adminName = player?.name || (steamID ? `admin ${steamID}` : 'system');
      console.log(`[TeamBalancer] Manual scramble countdown started by ${adminName}`);

      this._scrambleCountdownTimeout = setTimeout(async () => {
        this.logDebug('Manual scramble countdown finished, executing scramble.');
        await this.executeScramble(isSimulated);
      }, delaySeconds * 1000);

      return true;
    }

    await this.executeScramble(isSimulated, steamID, player);
    return true;
  }

  async executeScramble(isSimulated = false, steamID = null, player = null) {
    if (this._scrambleInProgress) {
      this.logWarning('Scramble already in progress.');
      return false;
    }

    this._scrambleInProgress = true;
    const adminName = player?.name || (steamID ? `admin ${steamID}` : 'system');
    this.logDebug(`Scramble started by ${adminName}`);

    try {
      if (!isSimulated) {
        const msg = `${
          this.RconMessages.prefix
        } ${this.RconMessages.executeScrambleMessage.trim()}`;
        this.logDebug(`Broadcasting: "${msg}"`);
        await this.server.rcon.broadcast(msg);
        console.log(`[TeamBalancer] Executing scramble initiated by ${adminName}`);
      } else {
        this.logDebug(`Executing dry run scramble initiated by ${adminName}`);
      }

      await Scrambler.scrambleTeamsPreservingSquads({
        squads: this.server.squads,
        players: this.server.players,
        winStreakTeam: this.winStreakTeam,
        log: (...args) => console.log(...args),
        switchTeam: async (steamID, newTeamID) => {
          await this.reliablePlayerMove(steamID, newTeamID, isSimulated);
        }
      });

      const msg = `${this.RconMessages.prefix} ${this.RconMessages.scrambleCompleteMessage.trim()}`;
      if (!isSimulated) {
        this.logDebug(`Broadcasting: "${msg}"`);
        await this.server.rcon.broadcast(msg);
        this.lastScrambleTime = Date.now();
        this.resetStreak('Post-scramble cleanup');
      } else {
        this.logDebug(msg);
      }

      return true;
    } catch (error) {
      console.log(`[TeamBalancer] Error during scramble execution:`, error);
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

    const adminName = player?.name || steamID;
    const cancelReason = isAutomatic ? 'automatically' : `by admin ${adminName}`;

    console.log(`[TeamBalancer] Scramble countdown cancelled ${cancelReason}`);

    if (!isAutomatic) {
      const msg = `Scramble cancelled by admin.`;
      this.logDebug(`Broadcasting: "${msg}"`);
      await this.server.rcon.broadcast(msg);
    }

    return true;
  }

  async waitForScrambleToFinish(timeoutMs = 10000, intervalMs = 100) {
    const start = Date.now();

    while (this._scrambleInProgress) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timeout waiting for scramble to finish.');
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
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
      await this.processScrambleRetries();
    }, this.options.scrambleRetryInterval);

    setTimeout(() => {
      this.completeScrambleSession();
    }, this.options.scrambleCompletionTimeout);
  }

  async processScrambleRetries() {
    const now = Date.now();
    const playersToRemove = [];

    for (const [steamID, moveData] of this.pendingPlayerMoves.entries()) {
      if (now - moveData.startTime > this.options.scrambleCompletionTimeout) {
        this.logWarning(
          `Player move timeout exceeded for ${steamID} after ${this.options.scrambleCompletionTimeout}ms, giving up`
        );
        this.logDebug(
          `Player ${steamID} move history: ${moveData.attempts} attempts, target team ${moveData.targetTeamID}`
        );
        this.activeScrambleSession.failedMoves++;
        playersToRemove.push(steamID);
        continue;
      }

      const player = this.server.players.find((p) => p.steamID === steamID);
      if (!player) {
        this.logDebug(
          `Player ${steamID} no longer on server, removing from move queue (was targeting team ${moveData.targetTeamID})`
        );
        playersToRemove.push(steamID);
        continue;
      }

      if (player.teamID === moveData.targetTeamID) {
        this.logDebug(
          `✓ Player ${steamID} (${player.name}) successfully moved to team ${moveData.targetTeamID} after ${moveData.attempts} attempts`
        );
        this.activeScrambleSession.completedMoves++;
        playersToRemove.push(steamID);

        if (this.options.warnOnSwap) {
          try {
            await this.server.rcon.warn(
              steamID,
              `You have been team-swapped as part of a balance adjustment.`
            );
          } catch (err) {
            this.logDebug(`Failed to send move warning to ${steamID} (${player.name}):`, err);
          }
        }
        continue;
      }

      moveData.attempts++;
      this.logDebug(
        `Attempting move for ${steamID} (${player.name}) from team ${player.teamID} to team ${moveData.targetTeamID} (attempt ${moveData.attempts}/5)`
      );

      try {
        await this.server.rcon.switchTeam(steamID, moveData.targetTeamID);
        this.logDebug(
          `RCON switchTeam command sent for ${steamID} (${player.name}) to team ${moveData.targetTeamID}`
        );
      } catch (err) {
        this.logWarning(
          `✗ Move attempt ${moveData.attempts}/5 failed for player ${steamID} (${player.name}) to team ${moveData.targetTeamID}:`,
          err.message || err
        );

        if (moveData.attempts >= 5) {
          this.logWarning(
            `✗ FINAL FAILURE: Player ${steamID} (${player.name}) could not be moved to team ${moveData.targetTeamID} after 5 attempts`
          );
          this.logDebug(
            `Failed player details: Currently on team ${player.teamID}, squad ${player.squadID}, role ${player.role}`
          );
          this.activeScrambleSession.failedMoves++;
          playersToRemove.push(steamID);
        }
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
    const completionReason =
      this.pendingPlayerMoves.size === 0 ? 'all moves completed' : 'timeout reached';

    console.log(
      `[TeamBalancer] Scramble session completed (${completionReason}) in ${duration}ms: ` +
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

/**
 * ============================================
 *         PLAYER COMMAND & RESPONSE LOGIC
 * ============================================
 */

const CommandHandlers = {
  register(tb) {
    tb.respond = function (steamID, msg) {
      console.log(`[TeamBalancer][Response to ${steamID}] ${msg}`);
      // Future: replace with RCON, Discord, etc.
      // await this.server.rcon.warn(steamID, msg); etc
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
        operationalSuperiority: '{team} outmaneuvered {loser} | ({margin} tickets)',

        invasionAttackWin: '{team} overran the defenders | ({margin} tickets)',
        invasionDefendWin: '{team} held firm | ({margin} tickets)'
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
      immediateManualScramble: 'Manual team balance triggered by admin | Scrambling teams...',
      executeScrambleMessage: ' Scrambling...',
      scrambleCompleteMessage: ' Balance has been restored.',

      system: {
        trackingEnabled: 'Team Balancer has been enabled.',
        trackingDisabled: 'Team Balancer has been disabled.'
      }
    };

    tb.onChatMessage = async function (info) {
      const message = info.message?.trim();
      if (!message || !message.startsWith('!teambalancer')) return;
      if (message !== '!teambalancer') return;

      const steamID = info.steamID;
      const playerName = info.player?.name || 'Unknown';

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
          ? `Team ${this.winStreakTeam} has ${this.winStreakCount} dominant win(s)`
          : 'No current win streak';

      const infoMsg = [
        '[TeamBalancer Info]',
        `Status: ${statusText}`,
        `Current streak: ${winStreakText}`,
        `Last scramble: ${lastScrambleText}`,
        `Max streak before scramble: ${this.options.maxWinStreak} wins`
      ].join('\n');

      console.log(
        `[TeamBalancer] Info response sent to ${playerName}: ${infoMsg.replace(/\n/g, ' | ')}`
      );

      try {
        await this.server.rcon.warn(steamID, infoMsg);
      } catch (err) {
        this.logDebug(`Failed to send info message to ${steamID}:`, err);
      }
    };

    tb.onChatCommand = async function (command) {
      if (!this.devMode && command.chat !== 'ChatAdmin') return;
      this.logDebug('[TeamBalancer] onChatCommand args:', command);
      const message = command.message;
      const steamID = command.steamID;
      const player = command.player;
      if (typeof message !== 'string' || !message.trim()) {
        console.log('[TeamBalancer] No valid message found, ignoring command.');
        this.respond(
          steamID,
          'Usage: !teambalancer [on|off | dryrun on|off | status | scramble | cancel | diag]'
        );
        return;
      }

      const args = message.trim().split(/\s+/);
      const subcommand = args[0]?.toLowerCase();

      try {
        switch (subcommand) {
          case 'on': {
            if (!this.manuallyDisabled) {
              this.respond(steamID, 'Win streak tracking is already enabled.');
              return;
            }

            this.manuallyDisabled = false;
            console.log(`[TeamBalancer] Win streak tracking enabled by ${player?.name || steamID}`);
            this.respond(steamID, 'Win streak tracking enabled.');

            await this.server.rcon.broadcast(
              `${this.RconMessages.prefix} ${this.RconMessages.system.trackingEnabled}`
            );
            break;
          }

          case 'off': {
            if (this.manuallyDisabled) {
              this.respond(steamID, 'Win streak tracking is already disabled.');
              return;
            }

            this.manuallyDisabled = true;
            console.log(
              `[TeamBalancer] Win streak tracking disabled by ${player?.name || steamID}`
            );
            this.respond(steamID, 'Win streak tracking disabled.');

            this.resetStreak('Manual disable');

            await this.server.rcon.broadcast(
              `${this.RconMessages.prefix} ${this.RconMessages.system.trackingDisabled}`
            );
            break;
          }

          case 'dryrun': {
            const arg = args[1]?.toLowerCase();
            if (arg === 'on') {
              this.options.dryRunMode = true;
              console.log(`[TeamBalancer] Dry run mode enabled by ${player?.name || steamID}`);
              this.respond(steamID, 'Dry run mode enabled.');
            } else if (arg === 'off') {
              this.options.dryRunMode = false;
              console.log(`[TeamBalancer] Dry run mode disabled by ${player?.name || steamID}`);
              this.respond(steamID, 'Dry run mode disabled.');
            } else {
              this.respond(steamID, 'Usage: !teambalancer dryrun on|off');
            }
            break;
          }

          case 'status': {
            const effectiveStatus = this.manuallyDisabled
              ? 'DISABLED (manual)'
              : this.options.enableWinStreakTracking
              ? 'ENABLED'
              : 'DISABLED (config)';

            const lastScrambleText = this.lastScrambleTime
              ? new Date(this.lastScrambleTime).toLocaleString()
              : 'Never';

            const scrambleInfo =
              this.pendingPlayerMoves.size > 0
                ? `${this.pendingPlayerMoves.size} pending player moves`
                : 'No active scramble';

            const statusMsg = [
              '[TeamBalancer Status]',
              `Win streak tracking: ${effectiveStatus}`,
              `Dry run mode: ${this.options.dryRunMode ? 'ON (manual only)' : 'OFF'}`,
              `Win streak: Team ${this.winStreakTeam ?? 'N/A'} with ${this.winStreakCount} win(s)`,
              `Scramble pending: ${this._scramblePending}`,
              `Scramble in progress: ${this._scrambleInProgress}`,
              `Last scramble: ${lastScrambleText}`,
              `Scramble system: ${scrambleInfo}`
            ].join('\n');

            console.log(`[TeamBalancer] Status requested by ${player?.name || steamID}`);
            this.respond(steamID, statusMsg);
            break;
          }

          case 'cancel': {
            const cancelled = await this.cancelPendingScramble(steamID, player, false);
            if (cancelled) {
              console.log(`[TeamBalancer] Scramble cancelled by ${player?.name || steamID}`);
              this.respond(steamID, 'Pending scramble cancelled.');
            } else if (this._scrambleInProgress) {
              this.respond(steamID, 'Cannot cancel scramble - it is already executing.');
            } else {
              this.respond(steamID, 'No pending scramble to cancel.');
            }
            break;
          }

          case 'scramble': {
            if (this._scramblePending || this._scrambleInProgress) {
              const status = this._scrambleInProgress ? 'executing' : 'pending';
              this.respond(
                steamID,
                `[WARNING] Scramble already ${status}. Use "!teambalancer cancel" to cancel pending scrambles.`
              );
              return;
            }

            console.log(
              `[TeamBalancer] ${player?.name || steamID} initiated a manual scramble with countdown`
            );

            this.respond(steamID, 'Initiating manual scramble with countdown...');

            const msg = this.formatMessage(this.RconMessages.manualScrambleAnnouncement, {
              delay: this.options.scrambleAnnouncementDelay
            });
            this.logDebug(`Broadcasting: "${msg}"`);
            await this.server.rcon.broadcast(msg);

            const success = await this.initiateScramble(
              this.options.dryRunMode,
              false,
              steamID,
              player
            );
            if (!success) {
              this.respond(
                steamID,
                'Failed to initiate scramble - another scramble may be in progress.'
              );
            }
            break;
          }

          case 'diag': {
            const t1Players = this.server.players.filter((p) => p.teamID === '1');
            const t2Players = this.server.players.filter((p) => p.teamID === '2');
            const unassignedPlayers = this.server.players.filter((p) => p.squadID === null);

            const t1Squads = this.server.squads.filter((s) => s.teamID === '1');
            const t2Squads = this.server.squads.filter((s) => s.teamID === '2');

            const scrambleInfo =
              this.pendingPlayerMoves.size > 0
                ? `${this.pendingPlayerMoves.size} pending player moves`
                : 'No active scramble';

            const diagMsg = [
              '[TeamBalancer Diagnostics]',
              `Dry run mode: ${this.options.dryRunMode ? 'ON' : 'OFF'}`,
              `Win streak: Team ${this.winStreakTeam ?? 'N/A'} with ${this.winStreakCount} win(s)`,
              `Scramble pending: ${this._scramblePending}`,
              `Scramble in progress: ${this._scrambleInProgress}`,
              `Players: Total = ${this.server.players.length}, Team1 = ${t1Players.length}, Team2 = ${t2Players.length}, Unassigned = ${unassignedPlayers.length}`,
              `Squads: Total = ${this.server.squads.length}, Team1 = ${t1Squads.length}, Team2 = ${t2Squads.length}`,
              `Scramble system: ${scrambleInfo}`,
              `Scramble config: Check interval = ${this.options.scrambleRetryInterval}ms, Completion timeout = ${this.options.scrambleCompletionTimeout}ms`
            ].join('\n');

            console.log(`[TeamBalancer] Diagnostics requested by ${player?.name || steamID}`);
            console.log(diagMsg);
            this.respond(steamID, 'Diagnostics sent to server console.');

            const runs = 3;
            console.log(
              `[TeamBalancer Diagnostics] Running ${runs} dry-run simulations on current server state:`
            );

            for (let i = 0; i < runs; i++) {
              console.log(`[Dry Run ${i + 1}]`);

              if (this._scramblePending || this._scrambleInProgress) {
                const status = this._scrambleInProgress ? 'executing' : 'pending';
                console.warn(`[Dry Run ${i + 1}] Skipped: scramble already ${status}`);
                this.respond(
                  steamID,
                  `[Dry Run ${
                    i + 1
                  }] Skipped: scramble already ${status}. Use "!scramble cancel" if needed.`
                );
                break;
              }

              try {
                await this.initiateScramble(true, true, steamID, player);
                await this.waitForScrambleToFinish();
              } catch (err) {
                console.warn(`[Dry Run ${i + 1}] Error during scramble: ${err.message}`);
              }
            }

            break;
          }

          default:
            this.respond(
              steamID,
              'Usage: !teambalancer [on|off | dryrun on|off | status | scramble | cancel | diag]'
            );
            break;
        }
      } catch (error) {
        console.log(
          `[TeamBalancer] Error handling command from ${player?.name || steamID}:`,
          error
        );
        this.respond(steamID, 'An error occurred processing your command.');
      }
    };

    tb.onScrambleCommand = async function (input) {
      const chat = input.chat;
      const steamID = input.steamID;
      const player = input.player;
      const message = input.message;

      if (!this.devMode && chat !== 'ChatAdmin') return;

      const tokens = (message || '').trim().split(/\s+/);
      const subcommand = tokens[0]?.toLowerCase();

      try {
        switch (subcommand) {
          case 'now': {
            if (this._scramblePending || this._scrambleInProgress) {
              const status = this._scrambleInProgress ? 'executing' : 'pending';
              this.respond(
                steamID,
                `[WARNING] Scramble already ${status}. Use "!scramble cancel" to cancel pending scrambles.`
              );
              return;
            }

            console.log(`[TeamBalancer] ${player?.name || steamID} initiated immediate scramble`);

            if (!this.options.dryRunMode) {
              const msg = this.RconMessages.immediateManualScramble;
              this.logDebug(`Broadcasting: "${msg}"`);
              await this.server.rcon.broadcast(`${this.RconMessages.prefix} ${msg}`);
            }

            this.respond(steamID, 'Initiating immediate scramble...');
            const success = await this.initiateScramble(
              this.options.dryRunMode,
              true,
              steamID,
              player
            );
            if (!success) {
              this.respond(
                steamID,
                'Failed to initiate scramble - another scramble may be in progress.'
              );
            }
            break;
          }

          case 'cancel': {
            const cancelled = await this.cancelPendingScramble(steamID, player, false);
            if (cancelled) {
              console.log(`[TeamBalancer] Scramble cancelled by ${player?.name || steamID}`);
              this.respond(steamID, 'Pending scramble cancelled.');
            } else if (this._scrambleInProgress) {
              this.respond(steamID, 'Cannot cancel scramble - it is already executing.');
            } else {
              this.respond(steamID, 'No pending scramble to cancel.');
            }
            break;
          }

          default: {
            if (this._scramblePending || this._scrambleInProgress) {
              const status = this._scrambleInProgress ? 'executing' : 'pending';
              this.respond(
                steamID,
                `[WARNING] Scramble already ${status}. Use "!scramble cancel" to cancel pending scrambles.`
              );
              return;
            }

            console.log(
              `[TeamBalancer] ${player?.name || steamID} initiated scramble with countdown`
            );

            this.respond(steamID, 'Initiating scramble with countdown...');
            const success = await this.initiateScramble(
              this.options.dryRunMode,
              false,
              steamID,
              player
            );
            if (!success) {
              this.respond(
                steamID,
                'Failed to initiate scramble - another scramble may be in progress.'
              );
            }
            break;
          }
        }
      } catch (error) {
        console.log(
          `[TeamBalancer] Error handling scramble command from ${player?.name || steamID}:`,
          error
        );
        this.respond(steamID, 'An error occurred processing your scramble command.');
      }
    };
  }
};

/**
 * ============================================
 *         SQUAD-PRESERVING TEAM SCRAMBLE
 * ============================================
 *
 * OVERVIEW:
 * Balances two teams in a Squad game by swapping whole squads (or unassigned players)
 * while preserving squad cohesion and respecting team size caps. Handles edge cases like
 * uneven teams, excess players, and lack of valid squads with fallbacks.
 *
 * GOALS:
 *  - Maintain balanced team sizes, capped at maxTeamSize (default: 50).
 *  - Preserve full squad integrity; no partial squad movement.
 *  - Support unassigned players via pseudo-squad handling.
 *  - Resolve persistent win-streaks by introducing team variety.
 *  - Provide clear, verbose debug logging for offline simulations.
 *
 * MAJOR PHASES:
 * --------------------------------------------
 * 1. DATA PREP:
 *    - Clone input to avoid side effects.
 *    - Convert unassigned players into pseudo-squads of size 1.
 *    - Split squads into team-based candidate pools.
 *
 * 2. SWAP TARGET CALCULATION:
 *    - Determine player imbalance using winStreakTeam context.
 *    - Compute how many players should be swapped to achieve parity.
 *
 * 3. BACKTRACKED SQUAD SELECTION:
 *    - Randomize candidate pools and run multiple swap attempts.
 *    - Select squad sets that approach the calculated swap target.
 *    - Score swaps based on player imbalance and overshoot.
 *    - Short-circuit once an acceptable swap score is found.
 *
 * 4. MUTUAL SWAP EXECUTION:
 *    - Swap selected squads between teams.
 *    - Apply player team changes using RCON callback.
 *    - Preserve team ID sets for post-swap analysis.
 *
 * 5. EMERGENCY TRIM / BREAK PHASE:
 *    - If a team exceeds the hard cap after swaps:
 *        → Attempt to trim excess by breaking unlocked squads.
 *        → If needed, fall back to breaking locked squads.
 *        → Final safety check ensures cap enforcement or logs critical failure.
 *
 * NOTES:
 *  - Unassigned-only matches are fully supported via pseudo-squads.
 *  - If no squads are found, the algorithm still runs using solo pseudo-squads.
 *  - All state changes are done via injected callbacks (log, switchTeam).
 *  - The logic avoids repeating squad selections between attempts.
 *  - Dry-run mode supported externally by swapping `switchTeam` function.
 *
 * USAGE:
 *  Call Scrambler.scrambleTeamsPreservingSquads({...}) with the following parameters:
 *
 *  - squads: Array of squad objects, each with:
 *      {
 *        id: string,            // Unique squad identifier
 *        teamID: '1' | '2',     // Owning team (as string)
 *        players: string[],     // Array of steamIDs
 *        locked?: boolean       // Optional: true if the squad is locked
 *      }
 *
 *  - players: Array of player objects, each with:
 *      {
 *        steamID: string,       // Unique Steam ID of the player
 *        teamID: '1' | '2',     // Current team assignment
 *        squadID: string|null   // Squad the player belongs to, or null if unassigned
 *      }
 *
 *  - winStreakTeam: number (1 or 2)
 *      Indicates the currently dominant team. Used to bias the balance logic
 *      toward restoring fairness by favoring the losing team in fill/trim logic.
 *
 *  - log: function(string): void
 *      A logging callback to receive all debug and progress output. This is invoked
 *      at every significant step (scoring, swapping, trimming, emergency breaking).
 *      To suppress output, pass `() => {}`. To enable structured logging, pass your
 *      own wrapper that formats or redirects messages (e.g. to a file or console).
 *
 *  - switchTeam: async function(steamID: string, newTeamID: '1' | '2')
 *      A callback used to enact team changes. Called once per player whose team
 *      assignment changes. The function must return a Promise and should handle
 *      any errors internally (e.g., failed RCON command).
 *
 *  Notes:
 *    - Input arrays are cloned internally; the algorithm does not mutate external state.
 *    - All team size caps and squad constraints are enforced during the process.
 *    - Function returns `void`; results are visible via logging and side-effects.
 */

export const Scrambler = {
  async scrambleTeamsPreservingSquads({
    squads,
    players,
    winStreakTeam,
    log = () => {},
    switchTeam = async () => {}
  }) {
    const maxTeamSize = 50;
    log(`========== Starting Team Scramble (Max cap = ${maxTeamSize}) ==========`);

    if (![1, 2].includes(winStreakTeam)) {
      winStreakTeam = Math.random() < 0.5 ? 1 : 2;
      log(`No win streak team set. Randomly selecting Team ${winStreakTeam} as starting side.`);
    }

    const clonedPlayers = players.map((p) => ({ ...p }));
    const clonedSquads = squads.map((s) => ({ ...s, players: [...s.players] }));

    const normalizeTeamID = (id) => String(id);

    const team1Size = clonedPlayers.filter((p) => normalizeTeamID(p.teamID) === '1').length;
    const team2Size = clonedPlayers.filter((p) => normalizeTeamID(p.teamID) === '2').length;

    const losingTeamSize = winStreakTeam === 1 ? team2Size : team1Size;
    const winningTeamSize = winStreakTeam === 1 ? team1Size : team2Size;
    const diff = winningTeamSize - losingTeamSize;

    const swapTarget = Math.floor((losingTeamSize + diff) / 2); // move enough to bring parity

    const allSquads = clonedSquads.filter((s) => s.players?.length > 0);
    const unassigned = clonedPlayers.filter((p) => p.squadID === null);
    const totalPlayers = clonedPlayers.length;

    log(`Total players: ${totalPlayers}, Swap target per side: ${swapTarget}`);

    const unassignedPseudoSquads = unassigned.map((p) => ({
      id: `Unassigned - ${p.steamID}`,
      teamID: p.teamID,
      players: [p.steamID]
    }));

    const filterCandidates = (teamID) =>
      allSquads
        .filter((s) => s.teamID === teamID && s.players.length >= 4)
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

    const selectSquadsLimited = (arr, limit) => {
      const selected = [];
      let count = 0;
      for (const squad of arr) {
        const size = squad.players.length;
        if (count + size > limit) continue;
        selected.push(squad);
        count += size;
      }
      return selected;
    };

    const scoreSwap = (a, b) => {
      const sum = (squads) => squads.reduce((n, s) => n + s.players.length, 0);
      const sa = sum(a);
      const sb = sum(b);
      const imbalance = Math.abs(sa - sb);
      const penalty = Math.max(0, sa - swapTarget) + Math.max(0, sb - swapTarget);
      return imbalance + penalty * 10;
    };

    const MAX_ATTEMPTS = 25;
    const ACCEPTABLE_SCORE = 2;
    let bestScore = Infinity;
    let bestT1 = null;
    let bestT2 = null;

    log(
      `Starting swap attempts (max ${MAX_ATTEMPTS}) with acceptable score <= ${ACCEPTABLE_SCORE}`
    );

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      shuffle(t1Candidates);
      shuffle(t2Candidates);

      const selT1 = selectSquadsLimited(t1Candidates, swapTarget);
      const selT2 = selectSquadsLimited(t2Candidates, swapTarget);
      const sa = selT1.reduce((n, s) => n + s.players.length, 0);
      const sb = selT2.reduce((n, s) => n + s.players.length, 0);
      const score = scoreSwap(selT1, selT2);

      log(
        `Attempt ${i + 1}: Score = ${score}, Team1 squads = ${
          selT1.length
        } (players = ${sa}), Team2 squads = ${selT2.length} (players = ${sb})`
      );
      log(`Team1 selected squads IDs: ${selT1.map((s) => s.id).join(', ')}`);
      log(`Team2 selected squads IDs: ${selT2.map((s) => s.id).join(', ')}`);

      if (score < bestScore) {
        bestScore = score;
        bestT1 = selT1;
        bestT2 = selT2;
        log(`New best score found: ${bestScore} at attempt ${i + 1}`);
        if (bestScore <= ACCEPTABLE_SCORE) {
          log(`Acceptable solution reached. Ending attempts early.`);
          break;
        }
      }
    }

    if (!bestT1 || !bestT2) {
      log('No valid swap solution found within attempt limit.');
      return;
    }

    const team1IDs = new Set(clonedPlayers.filter((p) => p.teamID === '1').map((p) => p.steamID));
    const team2IDs = new Set(clonedPlayers.filter((p) => p.teamID === '2').map((p) => p.steamID));
    const swappedSquadIDs = new Set();

    const moveSquads = async (group, toTeam, fromSet, toSet) => {
      log(`Swapping ${group.length} squads to Team ${toTeam}:`);
      for (const squad of group) {
        log(`Swapping squad ${squad.id} (${squad.players.length} players) → Team ${toTeam}`);
        swappedSquadIDs.add(squad.id);
        for (const pid of squad.players) {
          const oldTeam = fromSet.has(pid) ? (toTeam === 2 ? '1' : '2') : 'Unassigned';
          fromSet.delete(pid);
          toSet.add(pid);
          await switchTeam(pid, String(toTeam));
          log(`Player ${pid}: Team ${oldTeam} → Team ${toTeam}`);
        }
      }
    };

    log('=== MUTUAL SWAP PHASE ===');
    await moveSquads(bestT1, 2, team1IDs, team2IDs);
    await moveSquads(bestT2, 1, team2IDs, team1IDs);

    const finalT1Count = team1IDs.size;
    const finalT2Count = team2IDs.size;

    if (finalT1Count > maxTeamSize || finalT2Count > maxTeamSize) {
      log(`=== EMERGENCY SQUAD BREAKING PHASE ===`);

      const oversizedTeam = finalT1Count > maxTeamSize ? 1 : 2;
      const oversizedCount = oversizedTeam === 1 ? finalT1Count : finalT2Count;
      const targetTeam = oversizedTeam === 1 ? 2 : 1;
      const targetCount = oversizedTeam === 1 ? finalT2Count : finalT1Count;
      let playersToMove = oversizedCount - maxTeamSize;

      log(`Team ${oversizedTeam} has ${playersToMove} excess players. Attempting squad breaking.`);

      playersToMove = Math.min(playersToMove, maxTeamSize - targetCount);

      log(`Breaking unlocked squads to move ${playersToMove} excess players...`);

      const unlockedSquads = allSquads
        .filter(
          (s) =>
            s.teamID === String(oversizedTeam) &&
            !swappedSquadIDs.has(s.id) &&
            !s.locked &&
            s.players.length > 1
        )
        .sort((a, b) => b.players.length - a.players.length);

      log(`Found ${unlockedSquads.length} unlocked squads to break`);

      for (const squad of unlockedSquads) {
        if (playersToMove <= 0) break;
        log(`Breaking unlocked squad ${squad.id} (${squad.players.length} players)`);

        const playersInSquad = [...squad.players];
        shuffle(playersInSquad);

        let movedFromSquad = 0;
        for (const playerID of playersInSquad) {
          if (playersToMove <= 0) break;
          if (oversizedTeam === 1) {
            team1IDs.delete(playerID);
            team2IDs.add(playerID);
          } else {
            team2IDs.delete(playerID);
            team1IDs.add(playerID);
          }
          await switchTeam(playerID, String(targetTeam));
          log(
            `Moved player ${playerID} from unlocked squad ${squad.id}: Team ${oversizedTeam} → Team ${targetTeam}`
          );
          playersToMove--;
          movedFromSquad++;
        }

        if (movedFromSquad > 0) {
          log(`Broke ${movedFromSquad} players from unlocked squad ${squad.id}`);
        }
      }

      if (playersToMove > 0) {
        log(
          `Fallback 3: Still ${playersToMove} over cap. Breaking locked squads as last resort...`
        );

        const lockedSquads = allSquads
          .filter(
            (s) =>
              s.teamID === String(oversizedTeam) &&
              !swappedSquadIDs.has(s.id) &&
              s.locked &&
              s.players.length > 1
          )
          .sort((a, b) => b.players.length - a.players.length);

        if (lockedSquads.length > 0) {
          log(
            `[EMERGENCY] Breaking ${lockedSquads.length} locked squads to enforce ${maxTeamSize}-player cap`
          );

          for (const squad of lockedSquads) {
            if (playersToMove <= 0) break;
            log(`[EMERGENCY] Breaking locked squad ${squad.id} (${squad.players.length} players)`);

            const playersInSquad = [...squad.players];
            shuffle(playersInSquad);

            let movedFromSquad = 0;
            for (const playerID of playersInSquad) {
              if (playersToMove <= 0) break;
              if (oversizedTeam === 1) {
                team1IDs.delete(playerID);
                team2IDs.add(playerID);
              } else {
                team2IDs.delete(playerID);
                team1IDs.add(playerID);
              }
              await switchTeam(playerID, String(targetTeam));
              log(
                `[EMERGENCY] Moved player ${playerID} from locked squad ${squad.id}: Team ${oversizedTeam} → Team ${targetTeam}`
              );
              playersToMove--;
              movedFromSquad++;
            }

            if (movedFromSquad > 0) {
              log(`[EMERGENCY] Broke ${movedFromSquad} players from locked squad ${squad.id}`);
            }
          }
        }
      }

      if (playersToMove > 0) {
        log(
          `[CRITICAL] Unable to enforce ${maxTeamSize}-player cap. ${playersToMove} players still over limit.`
        );
      } else {
        log(`Successfully enforced ${maxTeamSize}-player cap through emergency measures`);
      }
    }

    const finalT1 = team1IDs.size;
    const finalT2 = team2IDs.size;

    log(`Final team sizes after swap: Team1 = ${finalT1}, Team2 = ${finalT2}`);
  }
};

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                DISCORD COMMUNICATION MODULE                   ║
 * ║                                                               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * OVERVIEW:
 * Handles all Discord integration for the TeamBalancer plugin, including
 * win streak notifications, scramble countdowns, and admin command responses.
 * Designed to coexist cleanly with RCON messaging without overlap or conflicts.
 *
 * FEATURES:
 * - Win streak progression announcements with dynamic embed colors
 * - Scramble countdown and completion alerts
 * - Admin command confirmations and plugin status reports
 * - Game-aware formatting (teams, tickets, margins, game mode)
 * - Configurable color scheme and Discord channel routing
 * - Automatic fallback when Discord is unavailable or misconfigured
 *
 * INSTALLATION REQUIREMENTS:
 * 1. Create a bot at https://discord.com/developers
 * 2. Enable MESSAGE CONTENT intent and invite it to your server
 * 3. Set the DISCORD_BOT_TOKEN environment variable before launching SquadJS
 * 4. Ensure your target channels are visible and writable by the bot
 *
 * INTEGRATION INSTRUCTIONS:
 * 1. Register the module in your plugin constructor:
 *      DiscordIntegration.register(this);
 *
 * 2. Add the following options to your plugin config:
 *      "discordEnabled": true,
 *      "discordChannelID": "PUBLIC_CHANNEL_ID",
 *      "discordAdminChannelID": "ADMIN_CHANNEL_ID",
 *      "discordEmbedColor": "#888888",
 *      "discordScrambleColor": "#E67E22",
 *      "discordWinStreakColor": "#3498DB",
 *      "discordIncludeServerName": true
 *
 * CONFIGURATION OPTIONS (in optionsSpecification):
 * - discordEnabled              → Enable/disable Discord notifications
 * - discordChannelID           → Channel for general notifications
 * - discordAdminChannelID      → Channel for admin command responses
 * - discordEmbedColor          → Default embed color (hex or decimal)
 * - discordScrambleColor       → Color for scramble-related embeds
 * - discordWinStreakColor      → Color for win streak embeds
 * - discordIncludeServerName   → Include server name in all embeds
 *
 * AUTHOR:
 *   Slacker (Discord: real_slacker)
 *
 * ════════════════════════════════════════════════════════════════
 */

export const DiscordIntegration = {
  register(teamBalancer) {
    // Store reference to the main plugin
    teamBalancer.discord = this;
    this.tb = teamBalancer;
    this.enabled = false;

    // Initialize Discord options with defaults
    this.initializeDiscordOptions();

    // Bind Discord-specific methods to the TeamBalancer instance
    this.bindDiscordMethods();

    // Override existing methods to include Discord notifications
    this.enhanceExistingMethods();

    teamBalancer.logDebug('[Discord] Integration module registered successfully');
  },

  initializeDiscordOptions() {
    const tb = this.tb;

    // Add default Discord options if not present
    const discordDefaults = {
      discordEnabled: { default: false, type: 'boolean' },
      discordChannelID: { default: '', type: 'string' },
      discordAdminChannelID: { default: '', type: 'string' },
      discordEmbedColor: { default: 5814783, type: 'number' }, // Blue
      discordScrambleColor: { default: 16776960, type: 'number' }, // Yellow
      discordWinStreakColor: { default: 16711680, type: 'number' }, // Red
      discordIncludeServerName: { default: true, type: 'boolean' }
    };

    // Merge with existing options specification
    Object.assign(tb.constructor.optionsSpecification, discordDefaults);

    // Set enabled state
    this.enabled = tb.options.discordEnabled && tb.options.discordChannelID;

    if (this.enabled) {
      tb.logDebug(`[Discord] Enabled - Channel: ${tb.options.discordChannelID}`);
    } else {
      tb.logDebug('[Discord] Disabled - missing configuration or explicitly disabled');
    }
  },

  bindDiscordMethods() {
    const tb = this.tb;

    // Bind Discord communication methods
    tb.sendDiscordMessage = this.sendDiscordMessage.bind(this);
    tb.sendDiscordAdminMessage = this.sendDiscordAdminMessage.bind(this);
    tb.createWinStreakEmbed = this.createWinStreakEmbed.bind(this);
    tb.createScrambleEmbed = this.createScrambleEmbed.bind(this);
    tb.createStatusEmbed = this.createStatusEmbed.bind(this);
  },

  enhanceExistingMethods() {
    const tb = this.tb;

    // Store original methods
    const originalOnRoundEnd = tb.onRoundEnded.bind(tb);
    const originalExecuteScramble = tb.executeScramble.bind(tb);
    const originalCancelPendingScramble = tb.cancelPendingScramble.bind(tb);

    // Enhanced round end with Discord notifications
    tb.onRoundEnded = async function (data) {
      // Call original logic first
      await originalOnRoundEnd(data);

      // Add Discord notification
      if (tb.discord.enabled) {
        await tb.discord.handleRoundEndDiscord(data);
      }
    };

    // Enhanced scramble execution with Discord updates
    tb.executeScramble = async function (isSimulated = false, steamID = null, player = null) {
      const result = await originalExecuteScramble(isSimulated, steamID, player);

      // Add Discord notification for successful scrambles
      if (tb.discord.enabled && result && !isSimulated) {
        await tb.discord.handleScrambleCompleteDiscord(steamID, player);
      }

      return result;
    };

    // Enhanced scramble cancellation with Discord updates
    tb.cancelPendingScramble = async function (steamID, player = null, isAutomatic = false) {
      const result = await originalCancelPendingScramble(steamID, player, isAutomatic);

      // Add Discord notification for manual cancellations
      if (tb.discord.enabled && result && !isAutomatic) {
        await tb.discord.handleScrambleCancelDiscord(steamID, player);
      }

      return result;
    };
  },

  async sendDiscordMessage(embed, channelOverride = null) {
    if (!this.enabled) return false;

    const tb = this.tb;
    const channelID = channelOverride || tb.options.discordChannelID;

    if (!channelID) {
      tb.logDebug('[Discord] No channel ID specified, skipping message');
      return false;
    }

    try {
      // Add server name to embed footer if enabled
      if (tb.options.discordIncludeServerName && tb.server?.serverName) {
        embed.footer = embed.footer || {};
        embed.footer.text = embed.footer.text
          ? `${embed.footer.text} • ${tb.server.serverName}`
          : tb.server.serverName;
      }

      if (!tb.server?.discordClient) {
        tb.logWarning('[Discord] No Discord client available on server object. Message not sent.');
        return false;
      }

      const channel = await tb.server.discordClient.channels.fetch(channelID);
      if (!channel) {
        tb.logWarning(`[Discord] Failed to fetch channel with ID ${channelID}.`);
        return false;
      }

      await channel.send({ embeds: [embed] });
      return true;
    } catch (error) {
      tb.logWarning(`[Discord] Failed to send message to channel ${channelID}: ${error.message}`);
      return false;
    }
  },

  async sendDiscordAdminMessage(embed, steamID = null) {
    const tb = this.tb;
    const adminChannelID = tb.options.discordAdminChannelID || tb.options.discordChannelID;

    // Add admin context to embed
    if (steamID) {
      const player = tb.server.players.find((p) => p.steamID === steamID);
      if (player) {
        embed.footer = embed.footer || {};
        embed.footer.text = embed.footer.text
          ? `${embed.footer.text} • Requested by ${player.name}`
          : `Requested by ${player.name}`;
      }
    }

    return await this.sendDiscordMessage(embed, adminChannelID);
  },

  createWinStreakEmbed(
    winnerName,
    loserName,
    winnerTickets,
    loserTickets,
    streakCount,
    isInvasion = false
  ) {
    const tb = this.tb;
    const margin = winnerTickets - loserTickets;

    let title, description, color;

    if (streakCount >= tb.options.maxWinStreak) {
      title = '🚨 Scramble Triggered!';
      description = `${winnerName} has reached **${streakCount} dominant wins** and triggered a team scramble!`;
      color = tb.options.discordScrambleColor;
    } else {
      title = `🔥 Win Streak: ${streakCount}`;
      description = `${winnerName} continues their dominance over ${loserName}`;
      color = tb.options.discordWinStreakColor;
    }

    const fields = [
      {
        name: '🏆 Winner',
        value: `**${winnerName}**\n${winnerTickets} tickets remaining`,
        inline: true
      },
      {
        name: '💀 Defeated',
        value: `**${loserName}**\n${loserTickets} tickets remaining`,
        inline: true
      },
      {
        name: '📊 Margin',
        value: `**${margin}** tickets\n${isInvasion ? '(Invasion Mode)' : '(Standard Mode)'}`,
        inline: true
      }
    ];

    if (streakCount >= tb.options.maxWinStreak) {
      fields.push({
        name: '⏱️ Scramble Countdown',
        value: `**${tb.options.scrambleAnnouncementDelay} seconds**`,
        inline: false
      });
    }

    return {
      title,
      description,
      color,
      fields,
      timestamp: new Date().toISOString()
    };
  },

  createScrambleEmbed(type, adminName = null, isComplete = false) {
    const tb = this.tb;
    let title, description, color;

    if (isComplete) {
      title = '✅ Teams Scrambled';
      description = 'Team balance has been restored. Good luck in the next round!';
      color = tb.options.discordEmbedColor;
    } else {
      switch (type) {
        case 'automatic':
          title = '⚖️ Auto-Scramble Initiated';
          description = `Win streak limit reached. Scrambling teams in **${tb.options.scrambleAnnouncementDelay} seconds**...`;
          break;
        case 'manual':
          title = '🎮 Manual Scramble Initiated';
          description = `Admin **${adminName}** triggered a team scramble. Starting in **${tb.options.scrambleAnnouncementDelay} seconds**...`;
          break;
        case 'immediate':
          title = '⚡ Immediate Scramble';
          description = `Admin **${adminName}** triggered an immediate team scramble.`;
          break;
        case 'cancelled':
          title = '❌ Scramble Cancelled';
          description = `Admin **${adminName}** cancelled the pending scramble.`;
          break;
        default:
          title = '⚖️ Team Scramble';
          description = 'Team scramble in progress...';
      }
      color = tb.options.discordScrambleColor;
    }

    const embed = {
      title,
      description,
      color,
      timestamp: new Date().toISOString()
    };

    if (!isComplete && type !== 'cancelled' && type !== 'immediate') {
      embed.fields = [
        {
          name: '⏱️ Countdown',
          value: `**${tb.options.scrambleAnnouncementDelay}** seconds`,
          inline: true
        }
      ];
    }

    return embed;
  },

  createStatusEmbed(steamID = null) {
    const tb = this.tb;

    const effectiveStatus = tb.manuallyDisabled
      ? 'DISABLED (manual)'
      : tb.options.enableWinStreakTracking
      ? 'ENABLED'
      : 'DISABLED (config)';

    const lastScrambleText = tb.lastScrambleTime
      ? `<t:${Math.floor(tb.lastScrambleTime / 1000)}:R>`
      : 'Never';

    const winStreakText =
      tb.winStreakCount > 0
        ? `Team ${tb.winStreakTeam} has **${tb.winStreakCount}** dominant win(s)`
        : 'No current win streak';

    const scrambleStatus = tb._scrambleInProgress
      ? '🔄 Scramble in progress'
      : tb._scramblePending
      ? '⏳ Scramble pending'
      : '✅ Ready';

    const embed = {
      title: '📊 TeamBalancer Status',
      color: tb.options.discordEmbedColor,
      fields: [
        {
          name: '🎯 Tracking Status',
          value: `**${effectiveStatus}**`,
          inline: true
        },
        {
          name: '🔥 Current Streak',
          value: winStreakText,
          inline: true
        },
        {
          name: '⚖️ Scramble Status',
          value: scrambleStatus,
          inline: true
        },
        {
          name: '🕒 Last Scramble',
          value: lastScrambleText,
          inline: true
        },
        {
          name: '⚙️ Settings',
          value: `Max streak: **${tb.options.maxWinStreak}**\nDry run: **${
            tb.options.dryRunMode ? 'ON' : 'OFF'
          }**`,
          inline: true
        },
        {
          name: '👥 Players',
          value: `Team 1: **${
            tb.server.players.filter((p) => p.teamID === '1').length
          }**\nTeam 2: **${tb.server.players.filter((p) => p.teamID === '2').length}**`,
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    };

    return embed;
  },

  async handleRoundEndDiscord(data) {
    const tb = this.tb;

    // Only send Discord notifications for significant events
    if (tb.winStreakCount < 1) return; // Skip non-streak rounds

    try {
      const winnerID = parseInt(data?.winner?.team);
      const winnerTickets = parseInt(data?.winner?.tickets);
      const loserTickets = parseInt(data?.loser?.tickets);

      const winnerName = (await tb.getTeamName(winnerID)) || `Team ${winnerID}`;
      const loserName = (await tb.getTeamName(3 - winnerID)) || `Team ${3 - winnerID}`;

      const isInvasion = tb.gameModeCached?.toLowerCase().includes('invasion') ?? false;

      const embed = tb.createWinStreakEmbed(
        winnerName,
        loserName,
        winnerTickets,
        loserTickets,
        tb.winStreakCount,
        isInvasion
      );

      await tb.sendDiscordMessage(embed);
      tb.logDebug(`[Discord] Win streak notification sent (streak: ${tb.winStreakCount})`);
    } catch (error) {
      tb.logWarning('[Discord] Error sending round end notification:', error.message);
    }
  },

  async handleScrambleCompleteDiscord(steamID = null, player = null) {
    const tb = this.tb;

    try {
      const adminName = player?.name || (steamID ? `Admin ${steamID}` : 'System');
      const embed = tb.createScrambleEmbed('complete', adminName, true);

      await tb.sendDiscordMessage(embed);
      tb.logDebug('[Discord] Scramble completion notification sent');
    } catch (error) {
      tb.logWarning('[Discord] Error sending scramble completion notification:', error.message);
    }
  },

  async handleScrambleCancelDiscord(steamID = null, player = null) {
    const tb = this.tb;

    try {
      const adminName = player?.name || (steamID ? `Admin ${steamID}` : 'System');
      const embed = tb.createScrambleEmbed('cancelled', adminName);

      await tb.sendDiscordMessage(embed);
      tb.logDebug('[Discord] Scramble cancellation notification sent');
    } catch (error) {
      tb.logWarning('[Discord] Error sending scramble cancellation notification:', error.message);
    }
  }
};
