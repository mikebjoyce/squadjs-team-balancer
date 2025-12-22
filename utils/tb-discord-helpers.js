/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                  DISCORD MESSAGING UTILITY                    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Part of the TeamBalancer Plugin
 *
 * Helper functions for Discord integration.
 *
 * COMPATIBILITY NOTE:
 * This module uses raw JavaScript objects for embeds to ensure compatibility
 * across different Discord.js versions without importing the library directly.
 */
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

    const embed = {
      color: 0x3498db,
      title: '📊 TeamBalancer Status',
      description: 'Current plugin state and configuration',
      fields: [
        { name: 'Version', value: tb.constructor.version || 'Unknown', inline: true },
        { name: 'Plugin Status', value: effectiveStatus, inline: true },
        { name: 'Win Streak', value: winStreakText, inline: false },
        { name: 'Scramble State', value: scrambleInfo, inline: true },
        { name: 'Last Scramble', value: lastScrambleText, inline: true },
        { name: 'Scramble Pending', value: tb._scramblePending ? 'Yes' : 'No', inline: true },
        { name: 'Scramble In Progress', value: tb._scrambleInProgress ? 'Yes' : 'No', inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    return embed;
  },

  buildDiagEmbed(tb, diagnosticResults = null) {
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

    // Determine color based on diagnostics if present
    let color = 0x3498db;
    if (diagnosticResults) {
      color = diagnosticResults.every((r) => r.pass) ? 0x2ecc71 : 0xe74c3c;
    }

    const embed = {
      color: color,
      title: '🩺 TeamBalancer Diagnostics',
      description: `**Plugin Status:** ${tb.manuallyDisabled ? 'DISABLED (Manual)' : 'ENABLED'}`,
      fields: [],
      timestamp: new Date().toISOString()
    };

    if (diagnosticResults) {
      const dbRes = diagnosticResults.find((r) => r.name === 'Database');
      const scramRes = diagnosticResults.find((r) => r.name === 'Live Scramble Test');
      const diagText = `**DB:** [${dbRes?.message || 'N/A'}]\n**Scramble:** [${scramRes?.message || 'N/A'}]`;
      embed.fields.push({ name: '🔍 Self-Test Results', value: diagText, inline: false });
    }

    embed.fields.push(
      { name: 'Version', value: tb.constructor.version || 'Unknown', inline: true },
      { name: 'Win Streak', value: tb.winStreakTeam ? `${tb.getTeamName(tb.winStreakTeam)}: ${tb.winStreakCount} win(s)` : 'None', inline: true },
      { name: 'Max Threshold', value: `${tb.options?.maxWinStreak || 2} wins`, inline: true },
      { name: 'Scramble Pending', value: tb._scramblePending ? 'Yes' : 'No', inline: true },
      { name: 'Scramble Active', value: tb._scrambleInProgress ? 'Yes' : 'No', inline: true },
      { name: 'Pending Moves', value: scrambleInfo, inline: true },
      { name: 'Game Mode', value: tb.gameModeCached || 'N/A', inline: true },
      { name: 'Team Names', value: `${tb.getTeamName(1)} | ${tb.getTeamName(2)}`, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: 'Total Players', value: `${players.length}`, inline: true },
      { name: 'Team 1 | Team 2', value: `${t1Players.length} | ${t2Players.length}`, inline: true },
      { name: 'Unassigned', value: `T1: ${t1UnassignedPlayers.length} | T2: ${t2UnassignedPlayers.length}`, inline: true },
      { name: 'Total Squads', value: `${squads.length}`, inline: true },
      { name: 'Squad Split', value: `T1: ${t1Squads.length} | T2: ${t2Squads.length}`, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: 'Dominant Win Threshold (RAAS/AAS)', value: `${tb.options?.minTicketsToCountAsDominantWin || 150} tickets`, inline: true },
      { name: 'Single Round Scramble (RAAS/AAS)', value: tb.options?.enableSingleRoundScramble ? `ON (> ${tb.options?.singleRoundScrambleThreshold} tix)` : 'OFF', inline: true },
      { name: 'Invasion Thresholds', value: `Atk: ${tb.options?.invasionAttackTeamThreshold} | Def: ${tb.options?.invasionDefenceTeamThreshold}`, inline: true },
      { name: 'Scramble %', value: `${(tb.options?.scramblePercentage || 0.5) * 100}%`, inline: true },
      { name: 'Scramble Delay', value: `${tb.options?.scrambleAnnouncementDelay}s`, inline: true },
      { name: 'Max Scramble Time', value: `${tb.options?.maxScrambleCompletionTime}ms`, inline: true },
      { name: 'Discord Options', value: `Mirror: ${tb.options?.mirrorRconBroadcasts ? 'Yes' : 'No'} | Details: ${tb.options?.postScrambleDetails ? 'Yes' : 'No'}`, inline: true },
      { name: 'Console Debug Logs', value: tb.options?.debugLogs ? 'ON' : 'OFF', inline: true }
    );

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

    const embed = {
      color: isSimulated ? 0x9b59b6 : 0x2ecc71,
      title: isSimulated ? '🧪 Dry Run Scramble Plan' : '🔀 Scramble Execution Plan',
      description: `**Total players affected:** ${swapPlan.length}`,
      fields: [
        { name: 'Balance Projection', value: `**Team 1:** ${currentT1} ➔ ${projT1}\n**Team 2:** ${currentT2} ➔ ${projT2}`, inline: false }
      ],
      timestamp: new Date().toISOString()
    };

    if (affectedSquads.size > 0) {
      const squadLines = [];
      affectedSquads.forEach((info) => {
        const arrow = info.targetTeam === '1' ? 'T2->T1' : 'T1->T2';
        squadLines.push(`**${info.name}** (${arrow}, ${info.count})`);
      });
      
      const squadText = squadLines.length > 15 
        ? squadLines.slice(0, 15).join('\n') + `\n...and ${squadLines.length - 15} more`
        : squadLines.join('\n');
        
      embed.fields.push({ name: 'Squads Moving', value: squadText, inline: false });
    }
    
    if (unassignedCount > 0) {
      embed.fields.push({ name: 'Unassigned Players', value: `${unassignedCount} players moving`, inline: false });
    }

    if (teamLists['1'].length > 0) {
      const team1Name = teamBalancer.getTeamName(1);
      const playerNames = await DiscordHelpers.resolveSteamIDsToNames(teamLists['1'], teamBalancer);
      embed.fields.push({ name: `→ Moving to ${team1Name} (${teamCounts['1']} players)`, value: DiscordHelpers.formatPlayerList(playerNames), inline: false });
    }

    if (teamLists['2'].length > 0) {
      const team2Name = teamBalancer.getTeamName(2);
      const playerNames = await DiscordHelpers.resolveSteamIDsToNames(teamLists['2'], teamBalancer);
      embed.fields.push({ name: `→ Moving to ${team2Name} (${teamCounts['2']} players)`, value: DiscordHelpers.formatPlayerList(playerNames), inline: false });
    }

    if (swapPlan.length === 0) {
      embed.footer = { text: 'The simulation resulted in no player moves. This is expected behavior on low-population servers.' };
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
    const embed = {
      color: isDominant ? 0xf39c12 : 0x3498db,
      title: isDominant ? '⚠️ Dominant Win Streak' : '📊 Win Recorded',
      fields: [
        { name: 'Team', value: teamName, inline: true },
        { name: 'Streak', value: `${streakCount} win(s)`, inline: true },
        { name: 'Margin', value: `${margin} tickets`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    if (isDominant) {
      embed.description = '⚠️ This team is dominating. Scramble may be triggered soon.';
    }

    return embed;
  },

  buildScrambleTriggeredEmbed(reason, teamName, count, delay) {
    const embed = {
      color: 0xf39c12,
      title: '🚨 Scramble Triggered',
      description: `**Reason:** ${reason}`,
      fields: [
        { name: 'Dominant Team', value: teamName || 'N/A', inline: true },
        { name: 'Win Streak', value: count ? `${count} wins` : 'N/A', inline: true },
        { name: 'Countdown', value: `${delay} seconds`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    return embed;
  },

  buildScrambleCompletedEmbed(totalMoves, successMoves, failedMoves, duration) {
    const successRate = totalMoves > 0 ? Math.round((successMoves / totalMoves) * 100) : 100;

    const embed = {
      color: failedMoves > 0 ? 0xf39c12 : 0x2ecc71,
      title: '✅ Scramble Completed',
      fields: [
        { name: 'Total Moves', value: `${totalMoves}`, inline: true },
        { name: 'Successful', value: `${successMoves}`, inline: true },
        { name: 'Failed', value: `${failedMoves}`, inline: true },
        { name: 'Success Rate', value: `${successRate}%`, inline: true },
        { name: 'Duration', value: `${duration}ms`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    if (failedMoves > 0) {
      embed.description = '⚠️ Some players could not be moved. Check logs for details.';
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