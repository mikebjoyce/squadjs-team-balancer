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

    const maxStreak = tb.options?.maxWinStreak || 2;
    const winStreakText = tb.winStreakTeam
      ? `${tb.getTeamName(tb.winStreakTeam)}: ${tb.winStreakCount} / ${maxStreak} wins`
      : `None (Threshold: ${maxStreak} wins)`;

    let lastScrambleText = 'Never';
    if (tb.lastScrambleTime) {
      const unixTime = Math.floor(tb.lastScrambleTime / 1000);
      // Discord timestamp: f = short date time, R = relative time
      lastScrambleText = `<t:${unixTime}:f> (<t:${unixTime}:R>)`;
    }

    const players = tb.server.players;
    const t1Count = players.filter((p) => p.teamID === 1).length;
    const t2Count = players.filter((p) => p.teamID === 2).length;

    const embed = {
      color: 0x3498db,
      title: '📊 TeamBalancer Status',
      fields: [
        { name: 'Version', value: tb.constructor.version || 'Unknown', inline: true },
        { name: 'Plugin Status', value: effectiveStatus, inline: true },
        { name: 'Win Streak', value: winStreakText, inline: false },
        { name: 'Last Scramble', value: lastScrambleText, inline: false },
        { name: 'Player Count', value: `Total: ${players.length} | T1: ${t1Count} | T2: ${t2Count}`, inline: false }
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
          const uniqueKey = `${player.teamID}-${player.squadID}`;
          if (!affectedSquads.has(uniqueKey)) {
            const squad = squads.find(s => s.squadID === player.squadID && s.teamID == player.teamID);
            affectedSquads.set(uniqueKey, {
              name: squad ? squad.squadName : `Squad ${player.squadID}`,
              targetTeam: move.targetTeamID,
              count: 0
            });
          }
          affectedSquads.get(uniqueKey).count++;
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

    // --- SQUADS SECTION ---
    const squadsT1 = [];
    const squadsT2 = [];
    affectedSquads.forEach((info) => {
      const text = `**${info.name}** (${info.count})`;
      if (info.targetTeam === '1') squadsT1.push(text);
      else squadsT2.push(text);
    });

    const formatSquadList = (list) => {
      if (list.length === 0) return 'None';
      // Limit to 20 squads per column to keep it readable
      if (list.length > 20) return list.slice(0, 20).join('\n') + `\n...and ${list.length - 20} more`;
      return list.join('\n');
    };

    if (squadsT1.length > 0 || squadsT2.length > 0) {
      embed.fields.push(
        { name: `🛡️ Squads ➡️ ${teamBalancer.getTeamName(1)}`, value: formatSquadList(squadsT1), inline: true },
        { name: `🛡️ Squads ➡️ ${teamBalancer.getTeamName(2)}`, value: formatSquadList(squadsT2), inline: true }
      );
    }

    if (unassignedCount > 0) {
      embed.fields.push({ name: 'Unassigned Players', value: `${unassignedCount} players moving`, inline: false });
    }

    // --- PLAYERS SECTION ---
    const namesT1 = await DiscordHelpers.resolveSteamIDsToNames(teamLists['1'], teamBalancer);
    const namesT2 = await DiscordHelpers.resolveSteamIDsToNames(teamLists['2'], teamBalancer);

    if (namesT1.length > 0 || namesT2.length > 0) {
      embed.fields.push(
        { name: `👤 Players ➡️ ${teamBalancer.getTeamName(1)} (${teamLists['1'].length})`, value: DiscordHelpers.formatPlayerList(namesT1), inline: false },
        { name: `👤 Players ➡️ ${teamBalancer.getTeamName(2)} (${teamLists['2'].length})`, value: DiscordHelpers.formatPlayerList(namesT2), inline: false }
      );
    }

    if (swapPlan.length === 0) {
      const action = isSimulated ? 'simulation' : 'scramble calculation';
      embed.footer = { text: `The ${action} resulted in no player moves. This is expected behavior on low-population servers.` };
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
    return `\`\`\`\n${names.join(', ')}\n\`\`\``;
  },

  buildWinStreakEmbed(teamName, teamID, streakCount, maxStreak, margin, isDominant) {
    const embed = {
      color: isDominant ? 0xf39c12 : 0x3498db,
      title: isDominant ? '🔥 Dominant Win Streak' : '📊 Win Recorded',
      fields: [
        { name: 'Winning Team', value: `${teamName} (Team ${teamID})`, inline: true },
        { name: 'Streak Progress', value: `**${streakCount}** / ${maxStreak} wins`, inline: true },
        { name: 'Ticket Margin', value: `+${margin}`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    if (isDominant) {
      const remaining = maxStreak - streakCount;
      if (remaining <= 0) {
        embed.description = '🚨 **Scramble Threshold Reached**\nTeams will be scrambled shortly to restore balance.';
      } else {
        embed.description = `**Dominance Detected**\nIf this team wins dominantly **${remaining}** more time(s), a scramble will be triggered.`;
      }
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
      // Compatibility fix for Discord.js v12 which throws "Cannot send an empty message"
      // when receiving { embeds: [...] } instead of { embed: ... }
      if (err.message === 'Cannot send an empty message' && content.embeds && Array.isArray(content.embeds) && content.embeds.length > 0) {
        try {
          const legacyContent = { ...content, embed: content.embeds[0] };
          delete legacyContent.embeds;
          await channel.send(legacyContent);
          return true;
        } catch (legacyErr) {
          Logger.verbose('TeamBalancer', 1, `Discord send failed (Legacy Fallback): ${legacyErr.message}`);
        }
      }

      const errMsg = `Discord send failed: ${err.message}`;
      if (!suppressErrors) throw new Error(errMsg);
      Logger.verbose('TeamBalancer', 1, errMsg);
      return false;
    }
  }
};