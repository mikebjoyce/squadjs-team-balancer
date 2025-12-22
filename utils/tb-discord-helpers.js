/**
 * Helper functions for Discord integration.
 *
 * COMPATIBILITY NOTE:
 * This module is written using Discord.js v13+ syntax (e.g., { embeds: [...] }).
 * However, it includes runtime compatibility checks to support Discord.js v12
 * by converting payloads to { embed: ... } when necessary.
 */
import Discord from 'discord.js';
import Logger from '../../core/logger.js';

export const DiscordHelpers = {
  buildStatusEmbed(tb) {
    // Defensive checks
    const effectiveStatus = tb.manuallyDisabled
      ? 'DISABLED (manual)'
      : tb.options?.enableWinStreakTracking
      ? 'ENABLED'
      : 'DISABLED (config)';

    const winStreakText = tb.winStreakTeam
      ? `${tb.getTeamName(tb.winStreakTeam)} (Team ${tb.winStreakTeam}): ${tb.winStreakCount} win(s)`
      : 'No active streak';

    const scrambleInfo =
      tb.swapExecutor?.pendingPlayerMoves?.size > 0
        ? `${tb.swapExecutor.pendingPlayerMoves.size} pending moves`
        : 'No active scramble';

    const lastScrambleText = tb.lastScrambleTime
      ? new Date(tb.lastScrambleTime).toLocaleString()
      : 'Never';

    const embed = new Discord.MessageEmbed()
      .setColor('#3498db')
      .setTitle('📊 TeamBalancer Status')
      .setDescription('Current plugin state and configuration')
      .addField('Version', tb.constructor.version || 'Unknown', true)
      .addField('Plugin Status', effectiveStatus, true)
      .addField('Win Streak', winStreakText, false)
      .addField('Scramble State', scrambleInfo, true)
      .addField('Last Scramble', lastScrambleText, true)
      .addField('Scramble Pending', tb._scramblePending ? 'Yes' : 'No', true)
      .addField('Scramble In Progress', tb._scrambleInProgress ? 'Yes' : 'No', true)
      .setTimestamp();

    return embed;
  },

  buildDiagEmbed(tb) {
    const players = tb.server.players;
    const squads = tb.server.squads;
    const t1Players = players.filter((p) => p.teamID === 1);
    const t2Players = players.filter((p) => p.teamID === 2);
    const t1UnassignedPlayers = t1Players.filter((p) => p.squadID === null);
    const t2UnassignedPlayers = t2Players.filter((p) => p.squadID === null);
    const t1Squads = squads.filter((s) => s.teamID === 1);
    const t2Squads = squads.filter((s) => s.teamID === 2);

    const scrambleInfo = tb.swapExecutor?.pendingPlayerMoves?.size > 0
      ? `${tb.swapExecutor.pendingPlayerMoves.size} pending moves`
      : 'None';

    const embed = new Discord.MessageEmbed()
      .setColor('#3498db')
      .setTitle('🩺 TeamBalancer Diagnostics')
      .setTimestamp()
      .setDescription(`**Plugin Status:** ${tb.manuallyDisabled ? 'DISABLED (Manual)' : 'ENABLED'}`)
      .addField('Version', tb.constructor.version || 'Unknown', true)
      .addField('Win Streak', 
        tb.winStreakTeam 
          ? `${tb.getTeamName(tb.winStreakTeam)}: ${tb.winStreakCount} win(s)` 
          : 'None', 
        true)
      .addField('Max Threshold', `${tb.options?.maxWinStreak || 2} wins`, true)
      .addField('Scramble Pending', tb._scramblePending ? 'Yes' : 'No', true)
      .addField('Scramble Active', tb._scrambleInProgress ? 'Yes' : 'No', true)
      .addField('Pending Moves', scrambleInfo, true)
      .addField('Game Mode', tb.gameModeCached || 'N/A', true)
      .addField('Team Names', `${tb.getTeamName(1)} | ${tb.getTeamName(2)}`, true)
      .addField('\u200B', '\u200B', true)
      .addField('Total Players', `${players.length}`, true)
      .addField('Team 1 | Team 2', `${t1Players.length} | ${t2Players.length}`, true)
      .addField('Unassigned', `T1: ${t1UnassignedPlayers.length} | T2: ${t2UnassignedPlayers.length}`, true)
      .addField('Total Squads', `${squads.length}`, true)
      .addField('Squad Split', `T1: ${t1Squads.length} | T2: ${t2Squads.length}`, true)
      .addField('\u200B', '\u200B', true)
      .addField('Dominant Win Threshold (RAAS/AAS)', `${tb.options?.minTicketsToCountAsDominantWin || 150} tickets`, true)
      .addField('Single Round Scramble (RAAS/AAS)', 
        tb.options?.enableSingleRoundScramble 
          ? `ON (> ${tb.options?.singleRoundScrambleThreshold} tix)` 
          : 'OFF', 
        true)
      .addField('Invasion Thresholds', `Atk: ${tb.options?.invasionAttackTeamThreshold} | Def: ${tb.options?.invasionDefenceTeamThreshold}`, true)
      .addField('Scramble %', `${(tb.options?.scramblePercentage || 0.5) * 100}%`, true)
      .addField('Scramble Delay', `${tb.options?.scrambleAnnouncementDelay}s`, true)
      .addField('Max Scramble Time', `${tb.options?.maxScrambleCompletionTime}ms`, true)
      .addField('Discord Options', `Mirror: ${tb.options?.mirrorRconBroadcasts ? 'Yes' : 'No'} | Details: ${tb.options?.postScrambleDetails ? 'Yes' : 'No'}`, true)
      .addField('Console Debug Logs', tb.options?.debugLogs ? 'ON' : 'OFF', true);

    return embed;
  },

  async createScrambleDetailsMessage(swapPlan, isSimulated, teamBalancer) {
    const teamCounts = { '1': 0, '2': 0 };
    const teamLists = { '1': [], '2': [] };
    
    const players = teamBalancer.server.players;
    const squads = teamBalancer.server.squads;
    const currentT1 = players.filter(p => p.teamID == 1).length;
    const currentT2 = players.filter(p => p.teamID == 2).length;
    
    const affectedSquads = new Map();
    let unassignedCount = 0;

    for (const move of swapPlan) {
      teamCounts[move.targetTeamID]++;
      teamLists[move.targetTeamID].push(move.steamID);
      
      const player = players.find(p => p.steamID === move.steamID);
      if (player) {
        if (player.squadID) {
          if (!affectedSquads.has(player.squadID)) {
            const squad = squads.find(s => s.squadID === player.squadID);
            affectedSquads.set(player.squadID, {
              name: squad ? squad.squadName : `Squad ${player.squadID}`,
              targetTeam: move.targetTeamID,
              count: 0
            });
          }
          affectedSquads.get(player.squadID).count++;
        } else {
          unassignedCount++;
        }
      }
    }
    
    const movesToT1 = teamCounts['1'];
    const movesToT2 = teamCounts['2'];
    const projT1 = currentT1 + movesToT1 - movesToT2;
    const projT2 = currentT2 + movesToT2 - movesToT1;

    const embed = new Discord.MessageEmbed()
      .setColor(isSimulated ? '#9b59b6' : '#2ecc71')
      .setTitle(isSimulated ? '🧪 Dry Run Scramble Plan' : '🔀 Scramble Execution Plan')
      .setDescription(`**Total players affected:** ${swapPlan.length}`)
      .addField('Balance Projection', 
        `**Team 1:** ${currentT1} ➔ ${projT1}\n**Team 2:** ${currentT2} ➔ ${projT2}`, 
        false
      )
      .setTimestamp();

    if (affectedSquads.size > 0) {
      const squadLines = [];
      affectedSquads.forEach((info) => {
        const arrow = info.targetTeam === '1' ? 'T2->T1' : 'T1->T2';
        squadLines.push(`**${info.name}** (${arrow}, ${info.count})`);
      });
      
      const squadText = squadLines.length > 15 
        ? squadLines.slice(0, 15).join('\n') + `\n...and ${squadLines.length - 15} more`
        : squadLines.join('\n');
        
      embed.addField('Squads Moving', squadText, false);
    }
    
    if (unassignedCount > 0) {
      embed.addField('Unassigned Players', `${unassignedCount} players moving`, false);
    }

    if (teamLists['1'].length > 0) {
      const team1Name = teamBalancer.getTeamName(1);
      const playerNames = await DiscordHelpers.resolveSteamIDsToNames(teamLists['1'], teamBalancer);
      embed.addField(`→ Moving to ${team1Name} (${teamCounts['1']} players)`, DiscordHelpers.formatPlayerList(playerNames), false);
    }

    if (teamLists['2'].length > 0) {
      const team2Name = teamBalancer.getTeamName(2);
      const playerNames = await DiscordHelpers.resolveSteamIDsToNames(teamLists['2'], teamBalancer);
      embed.addField(`→ Moving to ${team2Name} (${teamCounts['2']} players)`, DiscordHelpers.formatPlayerList(playerNames), false);
    }

    if (swapPlan.length === 0) {
      embed.setFooter('The simulation resulted in no player moves. This is expected behavior on low-population servers.');
    }

    return embed;
  },

  async resolveSteamIDsToNames(steamIDs, teamBalancer) {
    return steamIDs.map(steamID => {
      const player = teamBalancer.server.players.find(p => p.steamID === steamID);
      return player ? player.name : `Unknown (${steamID.slice(0, 8)}...)`;
    });
  },

  formatPlayerList(names) {
    if (names.length === 0) return 'None';
    if (names.length > 20) {
      return names.slice(0, 20).join('\n') + `\n... and ${names.length - 20} more`;
    }
    return names.join('\n');
  },

  buildWinStreakEmbed(teamName, streakCount, margin, isDominant) {
    const embed = new Discord.MessageEmbed()
      .setColor(isDominant ? '#f39c12' : '#3498db')
      .setTitle(isDominant ? '⚠️ Dominant Win Streak' : '📊 Win Recorded')
      .addField('Team', teamName, true)
      .addField('Streak', `${streakCount} win(s)`, true)
      .addField('Margin', `${margin} tickets`, true)
      .setTimestamp();

    if (isDominant) {
      embed.setDescription('⚠️ This team is dominating. Scramble may be triggered soon.');
    }

    return embed;
  },

  buildScrambleTriggeredEmbed(reason, teamName, count, delay) {
    const embed = new Discord.MessageEmbed()
      .setColor('#f39c12')
      .setTitle('🚨 Scramble Triggered')
      .setDescription(`**Reason:** ${reason}`)
      .addField('Dominant Team', teamName || 'N/A', true)
      .addField('Win Streak', count ? `${count} wins` : 'N/A', true)
      .addField('Countdown', `${delay} seconds`, true)
      .setTimestamp();

    return embed;
  },

  buildScrambleCompletedEmbed(totalMoves, successMoves, failedMoves, duration) {
    const successRate = totalMoves > 0 ? Math.round((successMoves / totalMoves) * 100) : 100;

    const embed = new Discord.MessageEmbed()
      .setColor(failedMoves > 0 ? '#f39c12' : '#2ecc71')
      .setTitle('✅ Scramble Completed')
      .addField('Total Moves', `${totalMoves}`, true)
      .addField('Successful', `${successMoves}`, true)
      .addField('Failed', `${failedMoves}`, true)
      .addField('Success Rate', `${successRate}%`, true)
      .addField('Duration', `${duration}ms`, true)
      .setTimestamp();

    if (failedMoves > 0) {
      embed.setDescription('⚠️ Some players could not be moved. Check logs for details.');
    }

    return embed;
  },

  async sendDiscordMessage(channel, content, suppressErrors = true) {
    if (!channel) {
      Logger.verbose('TeamBalancer', 1, 'Discord send failed: No channel available');
      return false;
    }

    if (!content) {
      Logger.verbose('TeamBalancer', 1, 'Discord send failed: Content was empty.');
      return false;
    }

    // Fix for Discord.js v12 compatibility: Convert { embeds: [embed] } to { embed: embed }
    if (Discord.version && Discord.version.startsWith('12') && content.embeds && Array.isArray(content.embeds) && content.embeds.length > 0) {
      content.embed = content.embeds[0];
      delete content.embeds;
    }

    try {
      await channel.send(content);
      return true;
    } catch (err) {
      const errMsg = `Discord send failed: ${err.message}`;
      if (!suppressErrors) throw new Error(errMsg);
      Logger.verbose('TeamBalancer', 1, errMsg);
      return false;
    }
  }
};