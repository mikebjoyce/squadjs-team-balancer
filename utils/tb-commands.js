/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                PLAYER COMMAND & RESPONSE LOGIC                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Part of the TeamBalancer Plugin
 */

import Logger from '../../core/logger.js';
import { DiscordHelpers } from './tb-discord-helpers.js';
import { TBDiagnostics } from './tb-diagnostics.js';

const CommandHandlers = {
  register(tb) {
    tb.respond = function (player, msg) {
      const playerName = player?.name || 'Unknown Player';
      const steamID = player?.steamID || 'Unknown SteamID';
      let logMessage = `[TeamBalancer][Response to ${playerName}`;
      logMessage += ` (${steamID})]\n${msg}`;
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
      singleRoundScramble:
        'Extreme ticket difference detected ({margin} tickets) | Scrambling in {delay}s...',
      manualScrambleAnnouncement:
        'Manual team balance triggered by admin | Scrambling in {delay}s...',
      immediateManualScramble: 'Manual team balance triggered by admin | Scrambling teams...',
      executeScrambleMessage: 'Executing scramble...',
      executeDryRunMessage: 'Dry Run: Simulating scramble...',
      scrambleCompleteMessage: ' Balance has been restored.',
      playerScrambledWarning: "You've been scrambled.", 

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

      Logger.verbose('TeamBalancer', 4, `General teambalancer info requested by ${playerName} (${steamID})`);

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

      Logger.verbose('TeamBalancer', 4, `[TeamBalancer] !teambalancer response sent to ${playerName} (${steamID}):\n${infoMsg}`);

      try {
        // This is what gets sent in-game via RCON warn
        await this.server.rcon.warn(steamID, infoMsg);
      } catch (err) {
        Logger.verbose('TeamBalancer', 1, `Failed to send info message to ${steamID}: ${err.message || err}`);
      }
    };

    tb.onChatCommand = async function (command) {
      Logger.verbose('TeamBalancer', 4, `Chat command received: !teambalancer ${command.message}`);

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
        Logger.verbose('TeamBalancer', 4, 'No subcommand provided for !teambalancer (admin chat), letting onChatMessage handle public status.');
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
            if (this.discordChannel) {
              const embed = {
                color: 0x3498db,
                title: '🎮 In-Game Command: !teambalancer on',
                description: `Executed by **${adminName}**`,
                fields: [{ name: 'Response', value: 'Win streak tracking enabled.', inline: false }],
                timestamp: new Date().toISOString()
              };
              await DiscordHelpers.sendDiscordMessage(this.discordChannel, { embeds: [embed] });
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
            try {
              await this.server.rcon.broadcast(
                `${this.RconMessages.prefix} ${this.RconMessages.system.trackingDisabled}`
              );
            } catch (err) {
              Logger.verbose('TeamBalancer', 1, `Failed to broadcast tracking disabled message: ${err.message}`);
            }
            if (this.discordChannel) {
              try {
                const embed = {
                  color: 0x3498db,
                  title: '🎮 In-Game Command: !teambalancer off',
                  description: `Executed by **${adminName}**`,
                  fields: [{ name: 'Response', value: 'Win streak tracking disabled.', inline: false }],
                  timestamp: new Date().toISOString()
                };
                await DiscordHelpers.sendDiscordMessage(this.discordChannel, { embeds: [embed] });
              } catch (discordErr) {
                Logger.verbose('TeamBalancer', 1, `Discord embed failed: ${discordErr.message}`);
              }
            }
            await this.resetStreak('Manual disable');
            break;
          }
          case 'status': {
            // Determine the effective plugin status
            const effectiveStatus = this.manuallyDisabled
              ? 'DISABLED (manual)'
              : this.options.enableWinStreakTracking
              ? 'ENABLED'
              : 'DISABLED (config)';

            // Win Streak with Threshold
            const maxStreak = this.options?.maxWinStreak || 2;
            const winStreakText = this.winStreakTeam
              ? `${this.getTeamName(this.winStreakTeam)}: ${this.winStreakCount} / ${maxStreak} wins`
              : `None (Threshold: ${maxStreak} wins)`;

            // Format the last scramble timestamp (Relative for in-game)
            let lastScrambleText = 'Never';
            if (this.lastScrambleTime) {
              const diff = Date.now() - this.lastScrambleTime;
              const mins = Math.floor(diff / 60000);
              const hours = Math.floor(mins / 60);
              if (hours > 0) {
                lastScrambleText = `${hours}h ${mins % 60}m ago`;
              } else {
                lastScrambleText = `${mins}m ago`;
              }
            }

            // Player Counts
            const players = this.server.players;
            const t1Count = players.filter((p) => p.teamID === 1).length;
            const t2Count = players.filter((p) => p.teamID === 2).length;

            // Layer
            const currentLayer = this.server.currentLayer?.name || 'Unknown';

            // Formatted response for !teambalancer status
            const statusMsg = [
              `--- TeamBalancer Status ---`,
              `Version: ${this.constructor.version}`,
              `Plugin Status: ${effectiveStatus}`,
              `Win Streak: ${winStreakText}`,
              `Last Scramble: ${lastScrambleText}`,
              `Players: ${players.length} (T1: ${t1Count} | T2: ${t2Count})`,
              `Layer: ${currentLayer}`,
              `---------------------------`
            ].join('\n');

            this.respond(player, statusMsg);
            if (this.discordChannel) {
              const embed = DiscordHelpers.buildStatusEmbed(this);
              embed.description = `Executed by **${adminName}**`;
              await DiscordHelpers.sendDiscordMessage(this.discordChannel, { embeds: [embed] });
            }
            break;
          }
          case 'diag': {
            Logger.verbose('TeamBalancer', 4, 'Diagnostics command received.');
            await this.server.rcon.warn(steamID, 'Running diagnostics... please wait.');

            const diagnostics = new TBDiagnostics(this);
            const results = await diagnostics.runAll();

            const dbResult = results.find((r) => r.name === 'Database');
            const scrambleResult = results.find((r) => r.name === 'Live Scramble Test');

            // Detailed stats calculation
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

            const layer = await this.server.currentLayer;
            const layerName = layer?.name || 'Unknown';
            const gameMode = this.gameModeCached || 'N/A';
            const team1Name = this.getTeamName(1);
            const team2Name = this.getTeamName(2);

            const diagMsg = [
              `--- [TeamBalancer Diag] ---`,
              `DB Connection: [${dbResult.message}]`,
              `Live Scramble Test: [${scrambleResult.message}]`,
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
              `Scramble Pending: ${this._scramblePending ? 'Yes' : 'No'}`,
              `Scramble In Progress: ${this._scrambleInProgress ? 'Yes' : 'No'}`,
              `Scramble System: ${scrambleInfo}`,
              '',
              '----- ROUND/LAYER INFO -----',
              `Layer: ${layerName}`,
              `Game Mode: ${gameMode}`,
              `Team 1 Name: ${team1Name}`,
              `Team 2 Name: ${team2Name}`,
              '',
              '----- PLAYER/SQUAD INFO -----',
              `Total Players: ${players.length}`,
              `Team 1: ${t1Players.length} (Unassigned: ${t1UnassignedPlayers.length})`,
              `Team 2: ${t2Players.length} (Unassigned: ${t2UnassignedPlayers.length})`,
              `Total Squads: ${squads.length}`,
              `Team 1 Squads: ${t1Squads.length}`,
              `Team 2 Squads: ${t2Squads.length}`,
              `------------------------------------------`
            ].join('\n');
            await this.server.rcon.warn(steamID, diagMsg);

            if (this.discordChannel) {
              const embed = DiscordHelpers.buildDiagEmbed(this, results);
              embed.description = `Executed by **${adminName}**\n${embed.description}`;
              await DiscordHelpers.sendDiscordMessage(this.discordChannel, { embeds: [embed] });
            }
            break;
          }
          default: {
            this.respond(
              player,
              'Invalid command. Usage: !teambalancer [status|diag|on|off|help] or !scramble [now|dry|cancel]'
            );
          }
        }
      } catch (err) {
        Logger.verbose('TeamBalancer', 1, `[TeamBalancer] Error processing chat command: ${err?.message || err}`);
        this.respond(player, `Error processing command: ${err.message}`);
      }
    };

    tb.onScrambleCommand = async function (command) {
      Logger.verbose('TeamBalancer', 4, `Scramble command received: !scramble ${command.message}`);
      // This line ensures commands are only processed from admin chat when devMode is false
      if (!this.options.devMode && command.chat !== 'ChatAdmin') return;

      let args = (command.message?.trim().toLowerCase().split(/\s+/) || []).filter(arg => arg);
      const isConfirm = args.includes('confirm');

      if (isConfirm) {
        if (!this.scrambleConfirmation) {
          this.respond(player, 'No pending scramble confirmation found.');
          return;
        }
        const timeoutMs = (this.options.scrambleConfirmationTimeout || 60) * 1000;
        if (Date.now() - this.scrambleConfirmation.timestamp > timeoutMs) {
          this.scrambleConfirmation = null;
          this.respond(player, 'Scramble confirmation expired.');
          return;
        }
        args = this.scrambleConfirmation.args;
        this.scrambleConfirmation = null;
      }

      const hasNow = args.includes('now');
      const hasDry = args.includes('dry');
      const isCancel = args.includes('cancel');

      const steamID = command.steamID;
      const player = command.player;
      const adminName = player?.name || steamID;

      try {
        // Handle cancel subcommand
        if (isCancel) {
          this.scrambleConfirmation = null;
          const cancelled = await this.cancelPendingScramble(steamID, player, false);
          if (cancelled) {
            Logger.verbose('TeamBalancer', 2, `[TeamBalancer] Scramble cancelled by ${adminName}`);
            this.respond(player, 'Pending scramble cancelled.');
          } else if (this._scrambleInProgress) {
            this.respond(player, 'Cannot cancel scramble - it is already executing.');
          } else {
            this.respond(player, 'No pending scramble to cancel.');
          }
          if (this.discordChannel) {
            const embed = {
              color: 0x3498db,
              title: '🎮 In-Game Command: !scramble cancel',
              description: `Executed by **${adminName}**`,
              fields: [{ name: 'Response', value: cancelled ? 'Pending scramble cancelled.' : 'No pending scramble to cancel.', inline: false }],
              timestamp: new Date().toISOString()
            };
            await DiscordHelpers.sendDiscordMessage(this.discordChannel, { embeds: [embed] });
          }
          return;
        }

        // Prevent duplicate scrambles
        if (this._scramblePending || this._scrambleInProgress) {
          const status = this._scrambleInProgress ? 'executing' : 'pending';
          this.respond(
            player,
            `[WARNING] Scramble already ${status}. Use "!scramble cancel" to cancel pending scrambles.`
          );
          return;
        }

        // Require confirmation for live scrambles
        if (this.options.requireScrambleConfirmation && !hasDry && !isConfirm) {
          this.scrambleConfirmation = { timestamp: Date.now(), args: args };
          const type = hasNow ? 'IMMEDIATE' : 'scheduled';
          const timeoutSec = this.options.scrambleConfirmationTimeout || 60;
          this.respond(player, `⚠️ Please confirm ${type} scramble by typing "!scramble confirm" within ${timeoutSec} seconds.`);
          return;
        }

        // Dry runs are ALWAYS immediate (no countdown for simulations)
        const immediate = hasDry || hasNow;
        const isSimulated = hasDry;

        // Broadcast only for LIVE scrambles (dry runs are silent to players)
        if (!isSimulated) {
          const broadcastMsg = immediate
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

        // Log action
        const actionDesc = isSimulated 
          ? `dry run scramble${immediate ? ' (immediate)' : ''}`
          : `live scramble${immediate ? ' (immediate)' : ''}`;
        Logger.verbose('TeamBalancer', 2, `[TeamBalancer] ${adminName} initiated ${actionDesc}`);

        // Respond to admin
        let responseMsg;
        if (isSimulated) {
          responseMsg = 'Initiating dry run scramble (immediate)...';
        } else {
          responseMsg = immediate 
            ? 'Initiating immediate scramble...'
            : 'Initiating scramble with countdown...';
        }
        if (this.discordChannel) {
          const embed = {
            color: 0x3498db,
            title: `🎮 In-Game Command: !scramble ${immediate ? 'now' : ''} ${isSimulated ? 'dry' : ''}`,
            description: `Executed by **${adminName}**`,
            fields: [{ name: 'Response', value: responseMsg, inline: false }],
            timestamp: new Date().toISOString()
          };
          await DiscordHelpers.sendDiscordMessage(this.discordChannel, { embeds: [embed] });
        }
        this.respond(player, responseMsg);

        // Execute
        const success = await this.initiateScramble(
          isSimulated,  // dry flag determines simulation
          immediate,    // dry runs force immediate execution
          steamID,
          player
        );

        if (!success) {
          this.respond(player, 'Failed to initiate scramble - another scramble may be in progress.');
        }
      } catch (err) {
        Logger.verbose('TeamBalancer', 1, `[TeamBalancer] Error processing scramble command: ${err?.message || err}`);
        this.respond(player, `Error processing command: ${err.message}`);
      }
    };
  }
};
export default CommandHandlers;