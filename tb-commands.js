// ╔═══════════════════════════════════════════════════════════════╗
// ║                PLAYER COMMAND & RESPONSE LOGIC                ║
// ╚═══════════════════════════════════════════════════════════════╝

import Logger from '../../core/logger.js';

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
      Logger.verbose('TeamBalancer', 2, logMessage);

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
      if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `General teambalancer info requested by ${playerName} (${steamID})`);

      const now = Date.now();
      const timeDifference = now - this.lastScrambleTime;
      let lastScrambleText;

      if (!this.lastScrambleTime) {
        lastScrambleText = 'Never';
      } else {
        const minutes = Math.floor(timeDifference / 60000);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
          lastScrambleText = `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else {
          lastScrambleText = `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
        }
      }
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
        `Version: ${this.constructor.version}`,
        `Status: ${statusText}`,
        `Dominance Streak: ${winStreakText}`,
        `Last Scramble: ${lastScrambleText}`,
        `Max Streak Threshold: ${this.options.maxWinStreak} dominant win(s)`
      ].join('\n');

      // Conditional logging based on debugLogs
      if (this.options.debugLogs) {
        Logger.verbose('TeamBalancer', 4, `[TeamBalancer] !teambalancer response sent to ${playerName} (${steamID}):\n${infoMsg}`);
      } else {
        Logger.verbose('TeamBalancer', 2, `[TeamBalancer] !teambalancer command received from ${playerName} and responded.`);
      }

      try {
        // This is what gets sent in-game via RCON warn
        await this.server.rcon.warn(steamID, infoMsg);
      } catch (err) {
        if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `Failed to send info message to ${steamID}: ${err.message || err}`);
      }
    };

    tb.onChatCommand = async function (command) {
      if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `Chat command received: !teambalancer ${command.message}`);

      // This line ensures commands are only processed from admin chat when devMode is false
      // The public-facing '!teambalancer' (no args) is handled by onChatMessage.
      if (!this.options.devMode && command.chat !== 'ChatAdmin') return;

      const message = command.message; // This is the part AFTER !teambalancer
      const steamID = command.steamID;
      const player = command.player; // Get the player object
      const adminName = player?.name || steamID; // Prioritize player name

      // If no subcommand is provided (i.e., just "!teambalancer"),
      // let onChatMessage handle the public status display.
      // This prevents an "Invalid command" response for the public status check.
      if (!message.trim()) {
        if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'No subcommand provided for !teambalancer (admin chat), letting onChatMessage handle public status.');
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
            Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Win streak tracking enabled by ${adminName}`);
            this.respond(player, 'Win streak tracking enabled.');
            try {
              await this.server.rcon.broadcast(
                `${this.RconMessages.prefix} ${this.RconMessages.system.trackingEnabled}`
              );
            } catch (err) {
              Logger.verbose('TeamBalancer', 1, `Failed to broadcast tracking enabled message: ${err.message}`);
            }
            break;
          }
          case 'off': {
            if (this.manuallyDisabled) {
              this.respond(player, 'Win streak tracking is already disabled.');
              return;
            }
            this.manuallyDisabled = true;
            Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Win streak tracking disabled by ${adminName}`);
            this.respond(player, 'Win streak tracking disabled.');
            await this.resetStreak('Manual disable');
            try {
              await this.server.rcon.broadcast(
                `${this.RconMessages.prefix} ${this.RconMessages.system.trackingDisabled}`
              );
            } catch (err) {
              Logger.verbose('TeamBalancer', 1, `Failed to broadcast tracking disabled message: ${err.message}`);
            }
            break;
          }
          case 'dryrun': {
            const arg = args[1]?.toLowerCase();
            if (arg === 'on') {
              this.options.dryRunMode = true;
              Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Dry run mode enabled by ${adminName}`);
              this.respond(player, 'Dry run mode enabled.');
            } else if (arg === 'off') {
              this.options.dryRunMode = false;
              Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Dry run mode disabled by ${adminName}`);
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
              Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Debug logging enabled by ${adminName}`);
              this.respond(player, 'Debug logging enabled.');
            } else if (arg === 'off') {
              this.options.debugLogs = false;
              Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Debug logging disabled by ${adminName}`);
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
              this.swapExecutor.pendingPlayerMoves.size > 0
                ? `${this.swapExecutor.pendingPlayerMoves.size} pending player moves`
                : 'No active scramble';

            // Format the last scramble timestamp
            const lastScrambleTimeFormatted = this.lastScrambleTime
              ? new Date(this.lastScrambleTime).toLocaleString()
              : 'Never';

            // Directly use the cached game mode and team names for administrative output
            const gameMode = this.gameModeCached || 'N/A';
            const team1Name = this.getTeamName(1);
            const team2Name = this.getTeamName(2);

            // Formatted response for !teambalancer status
            const statusMsg = [
              `--- TeamBalancer Status ---`,
              `Version: ${this.constructor.version}`,
              `Plugin Status: ${effectiveStatus}`,
              `Win Streak: ${
                this.winStreakTeam
                  ? `${this.getTeamName(this.winStreakTeam)} has ${this.winStreakCount} win(s)`
                  : 'N/A'
              }`,
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
              Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Scramble cancelled by ${adminName}`);
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
              this.respond(
                player,
                `[WARNING] Scramble already ${status}. Use "!teambalancer cancel" to cancel pending scrambles.`
              );
              return;
            }

            const arg = args[1]?.toLowerCase();
            const immediateExecution = arg === 'now';

            if (!this.options.dryRunMode) {
              // Live mode — broadcast to players
              const broadcastMsg = immediateExecution
                ? `${this.RconMessages.prefix} ${this.RconMessages.immediateManualScramble}`
                : `${this.RconMessages.prefix} ${this.formatMessage(
                    this.RconMessages.manualScrambleAnnouncement,
                    { delay: this.options.scrambleAnnouncementDelay }
                  )}`;

              try {
                await this.server.rcon.broadcast(broadcastMsg);
              } catch (err) {
                Logger.verbose('TeamBalancer', 1, `[TeamBalancer] Error broadcasting scramble message: ${err?.message || err}`);
              }
            }

            Logger.verbose('TeamBalancer', 2, `[TeamBalancer] ${adminName} initiated a manual scramble${immediateExecution ? ' (NOW)' : ''}.`);
            this.respond(
              player,
              immediateExecution
                ? this.options.dryRunMode
                  ? 'Initiating immediate dry run scramble...'
                  : 'Initiating immediate scramble...'
                : this.options.dryRunMode
                ? 'Initiating dry run scramble with countdown...'
                : 'Initiating manual scramble with countdown...'
            );

            const success = await this.initiateScramble(
              this.options.dryRunMode,
              immediateExecution,
              steamID,
              player
            );
            if (!success) {
              this.respond(
                player,
                'Failed to initiate scramble - another scramble may be in progress.'
              );
            }
            break;
          }
          case 'diag': {
            if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, 'Diagnostics command received.');

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
              this.swapExecutor.pendingPlayerMoves.size > 0
                ? `${this.swapExecutor.pendingPlayerMoves.size} pending player moves`
                : 'No active scramble';

            // Directly use the cached values for diagnostic output
            const gameMode = this.gameModeCached || 'N/A';
            const team1Name = this.getTeamName(1);
            const team2Name = this.getTeamName(2);

            // Formatted diagnostic message
            const diagMsg = [
              `--- TeamBalancer Diagnostics for ${adminName} ---`,
              '',
              '----- CORE STATUS -----',
              `Version: ${this.constructor.version}`,
              `Plugin Status: ${this.manuallyDisabled ? 'DISABLED (Manual override)' : 'ENABLED'}`,
              `Win Streak: ${
                this.winStreakTeam
                  ? `${this.getTeamName(this.winStreakTeam)} with ${this.winStreakCount} win(s)`
                  : 'N/A'
              }`,
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
              `Use Generic Team Names: ${
                this.options.useGenericTeamNamesInBroadcasts ? 'YES' : 'NO'
              }`,
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
        Logger.verbose('TeamBalancer', 1, `[TeamBalancer] Error processing chat command: ${err?.message || err}`);
        this.respond(player, `Error processing command: ${err.message}`);
      }
    };

    tb.onScrambleCommand = async function (command) {
      if (this.options.debugLogs) Logger.verbose('TeamBalancer', 4, `Scramble command received: !scramble ${command.message}`);
      // This line ensures commands are only processed from admin chat when devMode is false
      if (!this.options.devMode && command.chat !== 'ChatAdmin') return;

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
              Logger.verbose('TeamBalancer', 1, `[TeamBalancer] Error broadcasting immediate scramble message: ${err?.message || err}`);
            }
          }

          this.respond(
            player,
            this.options.dryRunMode
              ? 'Initiating immediate dry run scramble...'
              : 'Initiating immediate scramble...'
          );

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
            this.respond(
              player,
              `[WARNING] Scramble already ${status}. Use "!scramble cancel" to cancel pending scrambles.`
            );
            return;
          }

          if (!this.options.dryRunMode) {
            const broadcastMsg = `${this.RconMessages.prefix} ${this.formatMessage(
              this.RconMessages.manualScrambleAnnouncement,
              { delay: this.options.scrambleAnnouncementDelay }
            )}`;
            try {
              await this.server.rcon.broadcast(broadcastMsg);
            } catch (err) {
              Logger.verbose('TeamBalancer', 1, `[TeamBalancer] Error broadcasting scramble message: ${err?.message || err}`);
            }
          }

          this.respond(
            player,
            this.options.dryRunMode
              ? 'Initiating dry run scramble with countdown...'
              : 'Initiating manual scramble with countdown...'
          );

          const success = await this.initiateScramble(
            this.options.dryRunMode,
            false,
            steamID,
            player
          );
          if (!success) {
            this.respond(
              player,
              'Failed to initiate scramble - another scramble may be in progress.'
            );
          }
        }
      } catch (err) {
        Logger.verbose('TeamBalancer', 1, `[TeamBalancer] Error processing scramble command: ${err?.message || err}`);
        this.respond(player, `Error processing command: ${err.message}`);
      }
    };
  }
};
export default CommandHandlers;