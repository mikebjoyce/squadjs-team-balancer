/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                      TEAM BALANCER PLUGIN                     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * ─── COMMAND LIST ───────────────────────────────────────────────
 *
 * Public Commands:
 * !teambalancer                  → View current win streak and status.
 *
 * Admin Commands:
 * !teambalancer status           → View win streak and plugin status.
 * !teambalancer diag             → Runs diagnostic with dry-run scrambles.
 * !teambalancer on               → Enable win streak tracking.
 * !teambalancer off              → Disable win streak tracking.
 * !teambalancer debug on|off     → Enable/disable debug logging.
 *
 * !scramble                      → Manually trigger scramble with countdown.
 * !scramble now                  → Immediate scramble (no countdown).
 * !scramble dry                  → Dry-run scramble (simulation only).
 * !scramble cancel               → Cancel pending scramble countdown.
 *
 * ─── CONFIGURATION OPTIONS ──────────────────────────────────────
 *
 * Core Settings:
 * database                       - The Sequelize connector for persistent data storage.
 * enableWinStreakTracking        - Enable/disable automatic win streak tracking.
 * maxWinStreak                   - Number of dominant wins to trigger a scramble.
 * enableSingleRoundScramble      - Enable scramble if a single round ticket margin is huge.
 * singleRoundScrambleThreshold   - Ticket margin to trigger single-round scramble.
 * minTicketsToCountAsDominantWin - Min ticket diff for a dominant win (Standard).
 * invasionAttackTeamThreshold    - Ticket diff for Attackers to be dominant (Invasion).
 * invasionDefenceTeamThreshold   - Ticket diff for Defenders to be dominant (Invasion).
 *
 * Scramble Execution:
 * scrambleAnnouncementDelay      - Seconds before scramble executes after announcement.
 * scramblePercentage             - % of players to move (0.0 - 1.0).
 * changeTeamRetryInterval        - Retry interval (ms) for player swaps.
 * maxScrambleCompletionTime      - Max time (ms) for all swaps to complete.
 * warnOnSwap                     - Warn players when swapped.
 *
 * Messaging & Display:
 * showWinStreakMessages          - Broadcast win streak messages.
 * useGenericTeamNamesInBroadcasts - Use "Team 1"/"Team 2" instead of faction names.
 *
 * Discord Integration:
 * discordClient                  - Discord connector for admin commands.
 * discordChannelID               - Channel ID for admin commands and logs.
 * discordAdminRoleID             - Role ID for admin permissions (empty = all in channel).
 * mirrorRconBroadcasts           - Mirror RCON broadcasts to Discord.
 * postScrambleDetails            - Post detailed swap plans to Discord.
 *
 * Debug & Dev:
 * debugLogs                      - Enable verbose console logging.
 * devMode                        - Enable dev mode.
 *
 * ─── CONFIGURATION EXAMPLE ──────────────────────────────────────
 
//1. Add connectors to the "connectors" object in config.json:
 
"connectors": {
  "sqlite": {
    "dialect": "sqlite",
    "storage": "squad-server.sqlite"
  },
  "discord": {
    "connector": "discord",
    "token": "YOUR_BOT_TOKEN"
  }
},

// 2. Add the plugin configuration to the "plugins" array in config.json:

{
  "plugin": "TeamBalancer",
  "enabled": true,
  "database": "sqlite",
  "enableWinStreakTracking": true,
  "maxWinStreak": 2,
  "enableSingleRoundScramble": false,
  "singleRoundScrambleThreshold": 250,
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
  "discordClient": "discord",
  "discordChannelID": "",
  "discordAdminRoleID": "",
  "mirrorRconBroadcasts": true,
  "postScrambleDetails": true,
  "devMode": false
}

 * ════════════════════════════════════════════════════════════════
 */


import BasePlugin from './base-plugin.js';
import Discord from 'discord.js';
import { DiscordHelpers } from '../utils/tb-discord-helpers.js';
import Scrambler from '../utils/tb-scrambler.js';
import SwapExecutor from '../utils/tb-swap-executor.js';
import CommandHandlers from '../utils/tb-commands.js';
import TBDatabase from '../utils/tb-database.js';
import Logger from '../../core/logger.js';

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
      database: {
        required: true,
        connector: 'sequelize',
        description: 'The Sequelize connector for persistent data storage.',
        default: 'sqlite'
      },
      enableWinStreakTracking: {
        default: true,
        type: 'boolean'
      },
      maxWinStreak: {
        default: 2,
        type: 'number'
      },      
      enableSingleRoundScramble: {
        default: false,
        type: 'boolean'
      },
      singleRoundScrambleThreshold: {
        default: 250,
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
      scramblePercentage: {
        default: 0.5,
        type: 'number'
      },
      changeTeamRetryInterval: {
        default: 200,
        type: 'number'
      },      
      maxScrambleCompletionTime: {
        default: 15000,
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
      useGenericTeamNamesInBroadcasts: {
        default: false,
        type: 'boolean'
      },      
      debugLogs: {
        default: false,
        type: 'boolean'
      },
      discordClient: {
        required: false,
        connector: 'discord',
        description: 'Discord connector for admin commands and event logging.',
        default: 'discord'
      },
      discordChannelID: {
        required: false,
        description: 'Discord channel ID for admin commands and event mirroring.',
        default: ''
      },
      discordAdminRoleID: {
        required: false,
        description: 'Discord role ID for admin permissions. Leave empty to allow all users in channel.',
        default: ''
      },
      mirrorRconBroadcasts: {
        default: true,
        type: 'boolean',
        description: 'Mirror RCON broadcasts to Discord channel.'
      },
      postScrambleDetails: {
        default: true,
        type: 'boolean',
        description: 'Post detailed scramble swap plans to Discord.'
      },      
      devMode: {
        default: false,
        type: 'boolean'
      }
    };
  }

  validateOptions() {
    if (this.options.scrambleAnnouncementDelay < 10) {
      Logger.verbose('TeamBalancer', 1, `scrambleAnnouncementDelay (${this.options.scrambleAnnouncementDelay}s) too low. Enforcing minimum 10 seconds.`);
      this.options.scrambleAnnouncementDelay = 10;
    }
    if (this.options.changeTeamRetryInterval < 200) {
      Logger.verbose('TeamBalancer', 1, `changeTeamRetryInterval (${this.options.changeTeamRetryInterval}ms) too low. Enforcing minimum 200ms.`);
      this.options.changeTeamRetryInterval = 200;
    }
    if (this.options.maxScrambleCompletionTime < 5000) {
      Logger.verbose('TeamBalancer', 1, `maxScrambleCompletionTime (${this.options.maxScrambleCompletionTime}ms) too low. Enforcing minimum 5000ms.`);
      this.options.maxScrambleCompletionTime = 5000;
    }
    if (this.options.scramblePercentage < 0.0 || this.options.scramblePercentage > 1.0) {
      Logger.verbose('TeamBalancer', 1, `scramblePercentage (${this.options.scramblePercentage}) is outside the valid range (0.0 to 1.0). Enforcing 0.5.`);
      this.options.scramblePercentage = 0.5;
    }
    if (this.options.singleRoundScrambleThreshold <= this.options.minTicketsToCountAsDominantWin) {
      const newThreshold = this.options.minTicketsToCountAsDominantWin + 50;
      Logger.verbose('TeamBalancer', 1, `singleRoundScrambleThreshold (${this.options.singleRoundScrambleThreshold}) must be greater than minTicketsToCountAsDominantWin (${this.options.minTicketsToCountAsDominantWin}). Enforcing ${newThreshold}.`);
      this.options.singleRoundScrambleThreshold = newThreshold;
    }
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    CommandHandlers.register(this);

    // Initialize executor immediately so commands (like status) can access pendingPlayerMoves without crashing
    this.swapExecutor = new SwapExecutor(this.server, this.options, this.RconMessages, this);
    this.sequelize = connectors.sqlite;
    this.TeamBalancerStateModel = null;
    this.stateRecord = null;
    this.db = new TBDatabase(this.server, this.options, connectors);
    this.winStreakTeam = null;
    this.winStreakCount = 0;
    this.lastSyncTimestamp = null;
    this.manuallyDisabled = false;

    this._isMounted = false;
    this._scramblePending = false;
    this._scrambleTimeout = null;
    this._scrambleCountdownTimeout = null;
    this._flippedAfterScramble = false;
    this.lastScrambleTime = null;

    this._scrambleInProgress = false;
    this.listeners = {};
    this.listeners.onRoundEnded = this.onRoundEnded.bind(this);
    this.listeners.onNewGame = this.onNewGame.bind(this);
    this.listeners.onChatCommand = this.onChatCommand.bind(this);
    this.listeners.onScrambleCommand = this.onScrambleCommand.bind(this);
    this.listeners.onChatMessage = this.onChatMessage.bind(this);
    this.listeners.onDiscordMessage = this.onDiscordMessage.bind(this);
    this.discordChannel = null;
    
    this._gameInfoPollingInterval = null;
    this.gameModeCached = null;
    this.cachedAbbreviations = {};
  }
  async mount() {
    if (this._isMounted) {
      Logger.verbose('TeamBalancer', 1, 'Plugin already mounted, skipping duplicate mount attempt.');
      return;
    }
    if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'Mounting plugin and adding listeners.');
    try {
      const dbState = await this.db.initDB();
      if (dbState && !dbState.isStale) {
        this.winStreakTeam = dbState.winStreakTeam;
        this.winStreakCount = dbState.winStreakCount;
        this.lastSyncTimestamp = dbState.lastSyncTimestamp;
        this.lastScrambleTime = dbState.lastScrambleTime;
        if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `[DB] Restored state: team=${this.winStreakTeam}, count=${this.winStreakCount}`);
      } else if (dbState) {
        if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, '[DB] State stale; resetting.');
        this.lastScrambleTime = dbState.lastScrambleTime;
        await this.db.saveState(null, 0);
      }
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] mount/initDB failed: ${err.message}`);
    }

    if (this.options.discordClient && this.options.discordChannelID) {
      try {
        this.discordChannel = await this.options.discordClient.channels.fetch(this.options.discordChannelID);
        Logger.verbose('TeamBalancer', 2, `Discord channel connected: ${this.discordChannel.name}`);
        this.options.discordClient.on('message', this.listeners.onDiscordMessage);
      } catch (err) {
        Logger.verbose('TeamBalancer', 1, `Failed to fetch Discord channel: ${err.message}`);
      }
    }

    this.server.removeListener('ROUND_ENDED', this.listeners.onRoundEnded);
    this.server.removeListener('NEW_GAME', this.listeners.onNewGame);
    this.server.removeListener('CHAT_COMMAND:teambalancer', this.listeners.onChatCommand);
    this.server.removeListener('CHAT_COMMAND:scramble', this.listeners.onScrambleCommand);
    this.server.removeListener('CHAT_MESSAGE', this.listeners.onChatMessage);

    if (this.options.debugLogs) {
      const listenerCounts = {
        ROUND_ENDED: this.server.listenerCount('ROUND_ENDED'),
        NEW_GAME: this.server.listenerCount('NEW_GAME'),
        'CHAT_COMMAND:teambalancer': this.server.listenerCount('CHAT_COMMAND:teambalancer'),
        'CHAT_COMMAND:scramble': this.server.listenerCount('CHAT_COMMAND:scramble'),
        CHAT_MESSAGE: this.server.listenerCount('CHAT_MESSAGE')
      };
      Logger.verbose('TeamBalancer', 4, `Listener counts before registration: ${JSON.stringify(listenerCounts)}`);
    }

    this.server.on('ROUND_ENDED', this.listeners.onRoundEnded);
    this.server.on('NEW_GAME', this.listeners.onNewGame);
    this.server.on('CHAT_COMMAND:teambalancer', this.listeners.onChatCommand);
    this.server.on('CHAT_COMMAND:scramble', this.listeners.onScrambleCommand);
    this.server.on('CHAT_MESSAGE', this.listeners.onChatMessage);

    this.startPollingGameInfo();
    this.startPollingTeamAbbreviations();
    this.validateOptions();
    this._isMounted = true;
  }

  async unmount() {
    if (!this._isMounted) {
      Logger.verbose('TeamBalancer', 1, 'Plugin not mounted, skipping unmount.');
      return;
    }
    if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'Unmounting plugin and removing listeners.');
    this.server.removeListener('ROUND_ENDED', this.listeners.onRoundEnded);
    this.server.removeListener('NEW_GAME', this.listeners.onNewGame);
    this.server.removeListener('CHAT_COMMAND:teambalancer', this.listeners.onChatCommand);
    this.server.removeListener('CHAT_COMMAND:scramble', this.listeners.onScrambleCommand);
    this.server.removeListener('CHAT_MESSAGE', this.listeners.onChatMessage);

    if (this.options.discordClient && this.listeners.onDiscordMessage) {
      this.options.discordClient.removeListener('message', this.listeners.onDiscordMessage);
    }

    if (this._scrambleTimeout) clearTimeout(this._scrambleTimeout);
    if (this._scrambleCountdownTimeout) clearTimeout(this._scrambleCountdownTimeout);
    this.cleanupScrambleTracking();
    this.stopPollingGameInfo();
    this.stopPollingTeamAbbreviations();
    this._scrambleInProgress = false;
    this._isMounted = false;
  }

  // ╔═══════════════════════════════════════╗
  // ║          POLLING MECHANISMS           ║
  // ╚═══════════════════════════════════════╝

  async startPollingGameInfo() {
    if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'Starting game info polling.');
    const pollGameInfo = async () => {
      try {
        const layer = await this.server.currentLayer;
        if (layer && layer.gamemode) {
          this.gameModeCached = layer.gamemode;
          if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `Game mode resolved and cached: ${this.gameModeCached}`);
          if (this.gameInfoPollInterval) {
            clearInterval(this.gameInfoPollInterval);
            this.gameInfoPollInterval = null;
            if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'Game info polling stopped.');
          }
        } else {
          if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'Game info not yet available. Retrying...');
        }
      } catch (err) {
        if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `Error during game info polling: ${err.message}`);
      }
    };
    await pollGameInfo();
    this.gameInfoPollInterval = setInterval(pollGameInfo, 10000); // Poll every 10 seconds.
  }

  stopPollingGameInfo() {
    if (this._gameInfoPollingInterval) {
      if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'Stopping game info polling.');
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
    if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'Starting team abbreviation polling.');
    this.stopPollingTeamAbbreviations();
    this._teamAbbreviationPollingInterval = setInterval(() => this.pollTeamAbbreviations(), 5000);
  }

  stopPollingTeamAbbreviations() {
    if (this._teamAbbreviationPollingInterval) {
      if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'Stopping team abbreviation polling.');
      clearInterval(this._teamAbbreviationPollingInterval);
      this._teamAbbreviationPollingInterval = null;
    }
  }

  pollTeamAbbreviations() {
    if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'Running periodic team abbreviation poll.');
    const newAbbreviations = this.extractTeamAbbreviationsFromRoles();

    if (Object.keys(newAbbreviations).length > 0) {
      this.cachedAbbreviations = Object.assign({}, this.cachedAbbreviations, newAbbreviations);
      if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `Updated cached abbreviations: ${JSON.stringify(this.cachedAbbreviations)}`);
    }

    const hasBothTeams = Object.keys(this.cachedAbbreviations).length === 2;

    if (hasBothTeams) {
      if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `Polling successful! Cached abbreviations: ${JSON.stringify(this.cachedAbbreviations)}`);
      this.stopPollingTeamAbbreviations();
    }
  }

  extractTeamAbbreviationsFromRoles() {
    if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'extractTeamAbbreviationsFromRoles: Starting extraction from player roles.');
    const abbreviations = {};
    for (const player of this.server.players) {
      const teamID = player.teamID;
      if (!teamID) {
        if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `extractTeamAbbreviationsFromRoles: Skipping player ${player.name} with no teamID.`);
        continue;
      }

      if (abbreviations[teamID]) {
        if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `extractTeamAbbreviationsFromRoles: Skipping player ${player.name}, abbreviation for Team ${teamID} already found.`);
        continue;
      }

      const role = player.roles?.[0] || player.role; // Check for player.role as fallback
      if (role) {        
        const match = role.match(/^([A-Z]{2,6})_/);
        if (match) {
          if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `extractTeamAbbreviationsFromRoles: Found abbreviation ${match[1]} for Team ${teamID} from role ${role}.`);
          abbreviations[teamID] = match[1];
        } else {
          if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `extractTeamAbbreviationsFromRoles: No abbreviation found in role ${role} for player ${player.name}.`);
        }
      } else {
        if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `extractTeamAbbreviationsFromRoles: No role found for player ${player.name}.`);
      }
    }
    Logger.verbose('TeamBalancer', 4, `extractTeamAbbreviationsFromRoles: Finished extraction. Result: ${JSON.stringify(abbreviations)}`);
    return abbreviations;
  }

  
  // ╔═══════════════════════════════════════╗
  // ║          COMMAND HANDLERS             ║
  // ╚═══════════════════════════════════════╝

  async onDiscordMessage(message) {
    if (message.author.bot) return;
    if (message.channel.id !== this.options.discordChannelID) return;

    const content = message.content.trim();
    if (!content.startsWith('!teambalancer') && !content.startsWith('!scramble')) return;

    if (!this.checkDiscordAdminPermission(message.member)) {
      await message.reply('❌ You do not have permission to use this command.');
      return;
    }

    if (content.startsWith('!teambalancer')) {
      await this.handleDiscordTeamBalancerCommand(message);
    } else if (content.startsWith('!scramble')) {
      await this.handleDiscordScrambleCommand(message);
    }
  }

  checkDiscordAdminPermission(member) {
    if (!this.options.discordAdminRoleID) return true;
    return member.roles.cache.has(this.options.discordAdminRoleID);
  }

  async handleDiscordTeamBalancerCommand(message) {
    const args = message.content.replace(/^!teambalancer\s*/i, '').trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'status':
        await DiscordHelpers.sendDiscordMessage(message.channel, DiscordHelpers.buildStatusEmbed(this));
        break;
      case 'diag':
        await DiscordHelpers.sendDiscordMessage(message.channel, DiscordHelpers.buildDiagEmbed(this));
        break;
      case 'on':
      case 'off':
        await this.discordCommandToggle(message, subcommand);
        break;
      case 'debug':
        await this.discordCommandDebug(message, args[1]);
        break;
      default:
        await message.reply('Invalid command. Use: `status`, `diag`, `on`, `off`, `debug on|off`');
    }
  }

  async handleDiscordScrambleCommand(message) {
    const args = message.content.replace(/^!scramble\s*/i, '').trim().toLowerCase().split(/\s+/).filter(a => a);
    const hasNow = args.includes('now');
    const hasDry = args.includes('dry');
    const isCancel = args.includes('cancel');

    if (isCancel) {
      const cancelled = await this.cancelPendingScramble(null, null, false);
      if (cancelled) await message.reply('✅ Pending scramble cancelled.');
      else if (this._scrambleInProgress) await message.reply('⚠️ Cannot cancel scramble - it is already executing.');
      else await message.reply('⚠️ No pending scramble to cancel.');
    } else {
      if (this._scramblePending || this._scrambleInProgress) {
        const status = this._scrambleInProgress ? 'executing' : 'pending';
        await message.reply(`⚠️ Scramble already ${status}. Use \`!scramble cancel\` to cancel.`);
        return;
      }
      const actionDesc = hasDry ? 'dry run scramble (immediate)' : hasNow ? 'immediate scramble' : 'scramble with countdown';
      await message.reply(`🔄 Initiating ${actionDesc}...`);
      const success = await this.initiateScramble(hasDry, hasDry || hasNow, null, null);
      if (!success) await message.reply('❌ Failed to initiate scramble.');
    }
  }

  async discordCommandToggle(message, state) {
    if (state === 'on') {
      if (!this.manuallyDisabled) return message.reply('✅ Win streak tracking is already enabled.');
      this.manuallyDisabled = false;
      await message.reply('✅ Win streak tracking enabled.');
      await this.server.rcon.broadcast(`${this.RconMessages.prefix} ${this.RconMessages.system.trackingEnabled}`);
      await this.mirrorRconToDiscord(this.RconMessages.system.trackingEnabled, 'info');
    } else {
      if (this.manuallyDisabled) return message.reply('✅ Win streak tracking is already disabled.');
      this.manuallyDisabled = true;
      await message.reply('✅ Win streak tracking disabled.');
      await this.resetStreak('Manual disable via Discord');
      await this.server.rcon.broadcast(`${this.RconMessages.prefix} ${this.RconMessages.system.trackingDisabled}`);
      await this.mirrorRconToDiscord(this.RconMessages.system.trackingDisabled, 'info');
    }
  }

  async discordCommandDebug(message, arg) {
    if (arg === 'on') {
      this.options.debugLogs = true;
      await message.reply('✅ Debug logging enabled.');
    } else if (arg === 'off') {
      this.options.debugLogs = false;
      await message.reply('✅ Debug logging disabled.');
    } else {
      await message.reply('Usage: !teambalancer debug on|off');
    }
  }

  // ╔═══════════════════════════════════════╗
  // ║         ROUND EVENT HANDLERS          ║
  // ╚═══════════════════════════════════════╝

  async onNewGame() {
    try {
      Logger.verbose('TeamBalancer', 4, '[onNewGame] Event triggered');
      
      this.gameModeCached = null;
      this.cachedAbbreviations = {};
      this.startPollingGameInfo();
      this.startPollingTeamAbbreviations();

      this._scrambleInProgress = false;
      this._scramblePending = false;      
      try {
        const flippedTeam = this.winStreakTeam === 1 ? 2 : this.winStreakTeam === 2 ? 1 : null;
        const dbRes = await this.db.saveState(flippedTeam, this.winStreakCount);
        if (dbRes) {
          this.winStreakTeam = dbRes.winStreakTeam;
          this.winStreakCount = dbRes.winStreakCount;
          this.lastSyncTimestamp = dbRes.lastSyncTimestamp;
        }
      } catch (err) {
        Logger.verbose('TeamBalancer', 1, `[DB] onNewGame saveState failed: ${err.message}`);
      }
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[TeamBalancer] Error in onNewGame: ${err.message}`);
      this.winStreakTeam = null;
      this.winStreakCount = 0;
      try {
        const dbRes = await this.db.saveState(null, 0);
        this.winStreakTeam = null;
        this.winStreakCount = 0;
        if (dbRes) this.lastSyncTimestamp = dbRes.lastSyncTimestamp;
      } catch (err) {
        Logger.verbose('TeamBalancer', 1, `[DB] onNewGame fallback saveState failed: ${err.message}`);
      }
      this._scrambleInProgress = false;
      this._scramblePending = false;
      this.cleanupScrambleTracking();
    }
  }

  async onRoundEnded(data) {
    try {
      Logger.verbose('TeamBalancer', 4, `Round ended event received: ${JSON.stringify(data)}`);

      if (!this.options.enableWinStreakTracking || this.manuallyDisabled) {
        Logger.verbose('TeamBalancer', 4, 'Win streak tracking disabled, skipping round evaluation.');
        return;
      }

      this.stopPollingGameInfo();
      this.stopPollingTeamAbbreviations();

      const winnerID = parseInt(data?.winner?.team);
      const winnerTickets = parseInt(data?.winner?.tickets);
      const loserTickets = parseInt(data?.loser?.tickets);
      const margin = winnerTickets - loserTickets;

      if (isNaN(winnerID) || isNaN(winnerTickets) || isNaN(loserTickets)) {
        Logger.verbose('TeamBalancer', 1, 'Could not parse round end data, skipping evaluation.');
        return;
      }

      Logger.verbose('TeamBalancer', 4, `Parsed winnerID=${winnerID}, winnerTickets=${winnerTickets}, loserTickets=${loserTickets}, margin=${margin}`);

      const isInvasion = this.gameModeCached?.toLowerCase().includes('invasion') ?? false;

      if (this.options.enableSingleRoundScramble && !isInvasion && margin >= this.options.singleRoundScrambleThreshold) {
        Logger.verbose('TeamBalancer', 2, `[SingleRoundScramble] Triggered! Margin: ${margin} >= Threshold: ${this.options.singleRoundScrambleThreshold}`);
        const message = `${this.RconMessages.prefix} ${this.formatMessage(this.RconMessages.singleRoundScramble, {
          margin,
          delay: this.options.scrambleAnnouncementDelay
        })}`;
        try {
          await this.server.rcon.broadcast(message);
        } catch (broadcastErr) {
          Logger.verbose('TeamBalancer', 1, `Failed to broadcast single-round scramble message: ${broadcastErr.message}`);
        }
        await this.mirrorRconToDiscord(message, 'warning');
        this.initiateScramble(false, false);
        return;
      }

      const dominantThreshold = this.options.minTicketsToCountAsDominantWin ?? 175;
      const stompThreshold = Math.floor(dominantThreshold * 1.5);
      const closeGameMargin = Math.floor(dominantThreshold * 0.34);
      const moderateWinThreshold = Math.floor((dominantThreshold + closeGameMargin) / 2);

      Logger.verbose('TeamBalancer', 4, `Thresholds computed: {
    gameMode: ${this.gameModeCached},
    isInvasion: ${isInvasion},
    dominantThreshold: ${dominantThreshold},
    stompThreshold: ${stompThreshold},
    closeGameMargin: ${closeGameMargin},
    moderateWinThreshold: ${moderateWinThreshold}
}`);

      const invasionAttackThreshold = this.options.invasionAttackTeamThreshold ?? 300;
      const invasionDefenceThreshold = this.options.invasionDefenceTeamThreshold ?? 650;

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
      Logger.verbose('TeamBalancer', 4, `Dominance state: isDominant=${isDominant}, isStomp=${isStomp}`);

      const nextStreakCount = this.winStreakTeam === winnerID ? this.winStreakCount + 1 : 1;
      const maxStreakReached = nextStreakCount >= this.options.maxWinStreak;
      Logger.verbose('TeamBalancer', 4, `Streak info: nextStreakCount=${nextStreakCount}, maxStreakReached=${maxStreakReached}`);

      const winnerName =
        (this.options.useGenericTeamNamesInBroadcasts
          ? `Team ${winnerID}`
          : this.getTeamName(winnerID)) || `Team ${winnerID}`;
      const loserName =
        (this.options.useGenericTeamNamesInBroadcasts
          ? `Team ${3 - winnerID}`
          : this.getTeamName(3 - winnerID)) || `Team ${3 - winnerID}`;

      Logger.verbose('TeamBalancer', 4, `Team names for broadcast: winnerName=${winnerName}, loserName=${loserName}`);

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
      Logger.verbose('TeamBalancer', 4, `Final team names for broadcast: winnerName=${teamNames.winnerName}, loserName=${teamNames.loserName}`);

      if (!isDominant) {
        Logger.verbose('TeamBalancer', 4, 'Handling non-dominant win branch.');
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
            Logger.verbose('TeamBalancer', 4, `Using template for non-dominant win: ${template}`);

          const message = `${this.RconMessages.prefix} ${this.formatMessage(template, {
            team: teamNames.winnerName,
            loser: teamNames.loserName,
            margin
          })}`;
          Logger.verbose('TeamBalancer', 4, `Broadcasting non-dominant message: ${message}`);
          try {
            await this.server.rcon.broadcast(message);
          } catch (broadcastErr) {
            Logger.verbose('TeamBalancer', 1, `Failed to broadcast non-dominant message: ${broadcastErr.message}`);
          }
          await this.mirrorRconToDiscord(message, 'info');
        }
        return await this.resetStreak(`Non-dominant win by team ${winnerID}`);
      }

      Logger.verbose('TeamBalancer', 4, 'Dominant win detected under standard mode.');
      Logger.verbose('TeamBalancer', 4, `Current streak: winStreakTeam=${this.winStreakTeam}, winStreakCount=${this.winStreakCount}`);

      const streakBroken = this.winStreakTeam && this.winStreakTeam !== winnerID;
      if (streakBroken) {
        Logger.verbose('TeamBalancer', 4, `Streak broken. Previous streak team: ${this.winStreakTeam}`);
        await this.resetStreak('Streak broken by opposing team');
      }

      try {
        const dbRes = await this.db.saveState(winnerID, nextStreakCount);
        if (dbRes) {
          this.winStreakTeam = dbRes.winStreakTeam;
          this.winStreakCount = dbRes.winStreakCount;
          this.lastSyncTimestamp = dbRes.lastSyncTimestamp;
        }
        Logger.verbose('TeamBalancer', 4, `New win streak started: team ${this.winStreakTeam}, count ${this.winStreakCount}`);
      } catch (err) {
        Logger.verbose('TeamBalancer', 1, `[DB] saveState failed: ${err.message}`);
      }

      if (this.discordChannel && isDominant) {
        await DiscordHelpers.sendDiscordMessage(this.discordChannel, DiscordHelpers.buildWinStreakEmbed(teamNames.winnerName, this.winStreakCount, margin, true));
      }

      const scrambleComing = this.winStreakCount >= this.options.maxWinStreak;
      Logger.verbose('TeamBalancer', 4, `Scramble check: winStreakCount=${this.winStreakCount}, maxWinStreak=${this.options.maxWinStreak}, scrambleComing=${scrambleComing}`);

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
        Logger.verbose('TeamBalancer', 4, `Using template for dominant win: ${template}`);

        const message = `${this.RconMessages.prefix} ${this.formatMessage(template, {
          team: teamNames.winnerName,
          loser: teamNames.loserName,
          margin
        })}`;
        Logger.verbose('TeamBalancer', 4, `Broadcasting dominant win message: ${message}`);
        try {
          await this.server.rcon.broadcast(message);
        } catch (broadcastErr) {
          Logger.verbose('TeamBalancer', 1, `Failed to broadcast dominant win message: ${broadcastErr.message}`);
        }
        await this.mirrorRconToDiscord(message, 'info');
      }

      Logger.verbose('TeamBalancer', 4, `Evaluating scramble trigger: streakCount=${this.winStreakCount}, streakTeam=${this.winStreakTeam}, margin=${margin}`);
      Logger.verbose('TeamBalancer', 4, `_scramblePending=${this._scramblePending}, _scrambleInProgress=${this._scrambleInProgress}`);

      if (this._scramblePending || this._scrambleInProgress) return;

      if (this.winStreakCount >= this.options.maxWinStreak) {
        Logger.verbose('TeamBalancer', 4, `Scramble condition met. Preparing to broadcast announcement.`);
        const message = this.formatMessage(this.RconMessages.scrambleAnnouncement, {
          team: teamNames.winnerName,
          count: this.winStreakCount,
          margin,
          delay: this.options.scrambleAnnouncementDelay
        });
        Logger.verbose('TeamBalancer', 4, `Scramble announcement message: ${message}`);
        try {
          await this.server.rcon.broadcast(`${this.RconMessages.prefix} ${message}`);
        } catch (broadcastErr) {
          Logger.verbose('TeamBalancer', 1, `Failed to broadcast scramble announcement: ${broadcastErr.message}`);
        }
        await this.mirrorRconToDiscord(`${this.RconMessages.prefix} ${message}`, 'warning');
        if (this.discordChannel) {
          await DiscordHelpers.sendDiscordMessage(this.discordChannel, DiscordHelpers.buildScrambleTriggeredEmbed('Win streak threshold reached', teamNames.winnerName, this.winStreakCount, this.options.scrambleAnnouncementDelay));
        }
        this.initiateScramble(false, false);
      }
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[TeamBalancer] Error in onRoundEnded: ${err.message}`);      
      this.winStreakTeam = null;
      this.winStreakCount = 0;
      this._scrambleInProgress = false;
      this._scramblePending = false;
      this.cleanupScrambleTracking();
    }
  }

  async resetStreak(reason = 'unspecified') {
    Logger.verbose('TeamBalancer', 4, `Resetting streak: ${reason}`);
    try {
      const dbRes = await this.db.saveState(null, 0);
      this.winStreakTeam = null;
      this.winStreakCount = 0;
      if (dbRes) this.lastSyncTimestamp = dbRes.lastSyncTimestamp;
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[DB] resetStreak saveState failed: ${err.message}`);
    }
    this._scramblePending = false;
  }

  // ╔═══════════════════════════════════════╗
  // ║        SCRAMBLE EXECUTION FLOW        ║
  // ╚═══════════════════════════════════════╝

  async initiateScramble(isSimulated = false, immediate = false, steamID = null, player = null) {
    if (this._scramblePending || this._scrambleInProgress) {
      Logger.verbose('TeamBalancer', 4, 'Scramble initiation blocked: scramble already pending or in progress.');
      return false;
    }
    const adminName = player?.name || (steamID ? `admin ${steamID}` : 'system');
    
    if (isSimulated) {
      Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Simulating immediate scramble initiated by ${adminName}`);
      await this.executeScramble(true, steamID, player); // Always pass true for isSimulated
      return true;
    }
    
    if (!immediate) {      
      this._scramblePending = true;
      const delaySeconds = this.options.scrambleAnnouncementDelay;
      this._scrambleCountdownTimeout = setTimeout(async () => {
        Logger.verbose('TeamBalancer', 4, 'Scramble countdown finished, executing scramble.');
        await this.executeScramble(false, steamID, player); // Always pass false for isSimulated (live)
      }, delaySeconds * 1000);
      return true;
    } else {      
      Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Immediate live scramble initiated by ${adminName}`);
      await this.executeScramble(false, steamID, player); // Always pass false for isSimulated (live)
      return true;
    }
  }

  transformSquadJSData(squads, players) {
    Logger.verbose('TeamBalancer', 4, 'Transforming SquadJS data for scrambler...');
    
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

    Logger.verbose('TeamBalancer', 4, `Input validation: ${normalizedSquads.length} valid squads, ${normalizedPlayers.length} valid players`);
    
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

    Logger.verbose('TeamBalancer', 4, `Squad-player mapping created for ${squadPlayerMap.size} squads`);
    
    const transformedSquads = normalizedSquads.map((squad) => {
      const squadKey = String(squad.squadID);
      const playersInSquad = squadPlayerMap.get(squadKey) || [];

      const transformed = {
        id: squadKey,
        teamID: String(squad.teamID), // Ensure string format
        players: playersInSquad,
        locked: squad.locked === 'True' || squad.locked === true // Handle both string and boolean
      };

      Logger.verbose('TeamBalancer', 4, `Transformed squad ${squadKey}: ${playersInSquad.length} players, team ${transformed.teamID}, locked: ${transformed.locked}`);

      return transformed;
    });
    
    const transformedPlayers = normalizedPlayers.map((player) => ({
      steamID: player.steamID,
      teamID: String(player.teamID), // Ensure string format
      squadID: player.squadID ? String(player.squadID) : null
    }));

    Logger.verbose('TeamBalancer', 4, `Transformation complete: ${transformedSquads.length} squads, ${transformedPlayers.length} players`);
    
    if (transformedSquads.length > 0) {
      Logger.verbose('TeamBalancer', 4, `Sample transformed squad:`, JSON.stringify(transformedSquads[0], null, 2));
    }
    if (transformedPlayers.length > 0) {
      Logger.verbose('TeamBalancer', 4, `Sample transformed player:`, JSON.stringify(transformedPlayers[0], null, 2));
    }

    return {
      squads: transformedSquads,
      players: transformedPlayers
    };
  }

  async executeScramble(isSimulated = false, steamID = null, player = null) {
    if (this._scrambleInProgress) {
      Logger.verbose('TeamBalancer', 1, 'Scramble already in progress.');
      return false;
    }

    this._scrambleInProgress = true;    
    const adminName = player?.name || (steamID ? `admin ${steamID}` : 'system');
    Logger.verbose('TeamBalancer', 4, `Scramble started by ${adminName}`);

    try {
      let broadcastMessage;
      if (isSimulated) {
        broadcastMessage = `${this.RconMessages.prefix} ${this.RconMessages.executeDryRunMessage.trim()}`;
        Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Simulating scramble initiated by ${adminName}`);
      } else {
        broadcastMessage = `${this.RconMessages.prefix} ${this.RconMessages.executeScrambleMessage.trim()}`;
        Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Executing scramble initiated by ${adminName}`);
      }

      Logger.verbose('TeamBalancer', 4, `Broadcasting: "${broadcastMessage}"`);      
      if (!isSimulated) {
        try {
          await this.server.rcon.broadcast(broadcastMessage);
        } catch (broadcastErr) {          
          Logger.verbose('TeamBalancer', 1, `Failed to broadcast scramble execution message: ${broadcastErr.message}`);
        }
        await this.mirrorRconToDiscord(broadcastMessage, 'scramble');
      }

      const { squads: transformedSquads, players: transformedPlayers } = this.transformSquadJSData(
        this.server.squads,
        this.server.players
      );

      Logger.verbose('TeamBalancer', 4, `Calling scrambler with ${transformedSquads.length} squads and ${transformedPlayers.length} players`);

      const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
        squads: transformedSquads,
        players: transformedPlayers,
        winStreakTeam: this.winStreakTeam,
        scramblePercentage: this.options.scramblePercentage,
        debug: this.options.debugLogs
      });

      if (this.discordChannel && this.options.postScrambleDetails) {
        await DiscordHelpers.sendDiscordMessage(this.discordChannel, await DiscordHelpers.createScrambleDetailsMessage(swapPlan, isSimulated, this));
      }

      if (swapPlan && swapPlan.length > 0) {
        Logger.verbose('TeamBalancer', 2, `Dry run: Scrambler returned ${swapPlan.length} player moves.`);

        if (!isSimulated) {          
          for (const move of swapPlan) {            
            await this.reliablePlayerMove(move.steamID, move.targetTeamID, isSimulated);
          }          
          await this.waitForScrambleToFinish(this.options.maxScrambleCompletionTime);
        } else {
          Logger.verbose('TeamBalancer', 2, `Dry run: Would have queued ${swapPlan.length} player moves.`);
          for (const move of swapPlan) {
            Logger.verbose('TeamBalancer', 2, `  [Dry Run] Player ${move.steamID} to Team ${move.targetTeamID}`);
          }
        }
      } else {
        Logger.verbose('TeamBalancer', 2, 'Scrambler returned no player moves or an empty plan.');
      }

      const msg = `${this.RconMessages.prefix} ${this.RconMessages.scrambleCompleteMessage.trim()}`;
      if (!isSimulated) {
        Logger.verbose('TeamBalancer', 4, `Broadcasting: "${msg}"`);
        try {
          await this.server.rcon.broadcast(msg);
        } catch (broadcastErr) {
          Logger.verbose('TeamBalancer', 1, `Failed to broadcast scramble complete message: ${broadcastErr.message}`);
        }
        await this.mirrorRconToDiscord(msg, 'success');
        const scrambleTimestamp = Date.now();
        this.lastScrambleTime = scrambleTimestamp;
        try {
          const res = await this.db.saveScrambleTime(scrambleTimestamp);
          if (res && res.lastScrambleTime) this.lastScrambleTime = res.lastScrambleTime;
        } catch (err) {
          Logger.verbose('TeamBalancer', 1, `[DB] saveScrambleTime failed: ${err.message}`);
        }
        await this.resetStreak('Post-scramble cleanup');
      } else {
        Logger.verbose('TeamBalancer', 2, msg);
      }

      return true;
    } catch (error) {
    Logger.verbose('TeamBalancer', 1, `[TeamBalancer] Critical error during scramble execution: ${error?.message || error}`);      
      Logger.verbose('TeamBalancer', 4, `Squad data at error:`, JSON.stringify(this.server.squads, null, 2));
      Logger.verbose('TeamBalancer', 4, `Player data at error:`, JSON.stringify(this.server.players, null, 2));      
      this.cleanupScrambleTracking();
      await this.resetStreak('Scramble execution failed');
      return false;
    } finally {
      this._scrambleInProgress = false;
      Logger.verbose('TeamBalancer', 4, 'Scramble finished');
    }
  }

  async cancelPendingScramble(steamID, player = null, isAutomatic = false) {
    if (!this._scramblePending) {
      return false;
    }

    if (this._scrambleInProgress) {
      if (!isAutomatic) {
        const adminName = player?.name || steamID;
        Logger.verbose('TeamBalancer', 2, `[TeamBalancer] ${adminName} attempted to cancel scramble, but it's already executing`);
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

    Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Scramble countdown cancelled ${cancelReason}`);

      if (!isAutomatic) {
      const msg = `${this.RconMessages.prefix} Scramble cancelled by admin.`;
      Logger.verbose('TeamBalancer', 4, `Broadcasting: "${msg}"`);
      try {
        await this.server.rcon.broadcast(msg);
      } catch (err) {
        Logger.verbose('TeamBalancer', 1, `Failed to broadcast scramble cancellation message: ${err.message}`);
      }
      await this.mirrorRconToDiscord(msg, 'info');
    }

    return true;
  }

  async waitForScrambleToFinish(timeoutMs = 10000, intervalMs = 100) {
    if (this.swapExecutor) {
      await this.swapExecutor.waitForCompletion(timeoutMs, intervalMs);
    } else {
      Logger.verbose('TeamBalancer', 4, 'No swapExecutor present; nothing to wait for.');
    }
    Logger.verbose('TeamBalancer', 4, 'All player moves processed or timeout reached.');
  }
  
  async reliablePlayerMove(steamID, targetTeamID, isSimulated = false) {
    if (isSimulated) {
      Logger.verbose('TeamBalancer', 4, `[Dry Run] Would queue player move for ${steamID} to team ${targetTeamID}`);
      return;
    }

    return this.swapExecutor.queueMove(steamID, targetTeamID, isSimulated);
  }

  cleanupScrambleTracking() {
    if (this.swapExecutor) {
      this.swapExecutor.cleanup();
    }
    this._scrambleInProgress = false;
  }

  async mirrorRconToDiscord(message, type = 'info') {
    if (!this.discordChannel || !this.options.mirrorRconBroadcasts) return;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      Logger.verbose('TeamBalancer', 1, `[Discord] Attempted to mirror empty/invalid message: ${message}`);
      return;
    }

    const colors = {
      info: '#3498db',
      success: '#2ecc71',
      warning: '#f39c12',
      error: '#e74c3c',
      scramble: '#9b59b6'
    };

    try {
      const embed = new Discord.MessageEmbed()
        .setColor(colors[type] || colors.info)
        .setDescription(`📢 **Server Broadcast**\n${message}`)
        .setTimestamp();
      await DiscordHelpers.sendDiscordMessage(this.discordChannel, { embeds: [embed] });
    } catch (err) {
      Logger.verbose('TeamBalancer', 1, `[Discord] Mirror failed: ${err.message}`);
    }
  }
}