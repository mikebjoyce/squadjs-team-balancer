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
      ? `${tb.getTeamName(tb.winStreakTeam)}: ${tb.winStreakCount} win(s)`
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
      .addField('Debug Logging', tb.options?.debugLogs ? 'ON' : 'OFF', true)
      .setTimestamp();

    return embed;
  },

  buildDiagEmbed(tb) {
    const players = tb.server.players;
    const t1Players = players.filter((p) => p.teamID === 1).length;
    const t2Players = players.filter((p) => p.teamID === 2).length;

    const embed = new Discord.MessageEmbed()
      .setColor('#3498db')
      .setTitle('🩺 TeamBalancer Diagnostics')
      .setTimestamp()
      .setDescription(`**Plugin Status:** ${tb.manuallyDisabled ? 'DISABLED (Manual)' : 'ENABLED'}`)
      .addField('Players', `Total: ${players.length}\nT1: ${t1Players}\nT2: ${t2Players}`, true)
      .addField(
        'Win Streak',
        tb.winStreakTeam
          ? `${tb.getTeamName(tb.winStreakTeam)} (${tb.winStreakCount} wins)`
          : 'None',
        true
      )
      .addField('Scramble', `Pending: ${tb._scramblePending ? 'Yes' : 'No'}\nIn Progress: ${tb._scrambleInProgress ? 'Yes' : 'No'}`, true);

    return embed;
  },

  async createScrambleDetailsMessage(swapPlan, isSimulated, teamBalancer) {
    const teamCounts = { '1': 0, '2': 0 };
    const teamLists = { '1': [], '2': [] };

    for (const move of swapPlan) {
      teamCounts[move.targetTeamID]++;
      teamLists[move.targetTeamID].push(move.steamID);
    }

    const embed = new Discord.MessageEmbed()
      .setColor(isSimulated ? '#9b59b6' : '#2ecc71')
      .setTitle(isSimulated ? '🧪 Dry Run Scramble Plan' : '🔀 Scramble Execution Plan')
      .setDescription(`**Total players affected:** ${swapPlan.length}`)
      .setTimestamp();
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