/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                  DISCORD MESSAGING UTILITY                    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * ─── PURPOSE ─────────────────────────────────────────────────────
 *
 * Static embed builders and send helper for all TeamBalancer Discord
 * output. Handles status reports, diagnostic results, scramble plans,
 * win streak notifications, and error reporting.
 *
 * ─── EXPORTS ─────────────────────────────────────────────────────
 *
 * DiscordHelpers (named)
 *   Object. Key members:
 *     sendDiscordMessage(channel, content)        — Resilient send with 429 retry.
 *     buildStatusEmbed(tb)                        — Win streak and plugin state embed.
 *     buildDiagnosticsEmbed(results, tb)          — Diagnostic test results embed.
 *     createScrambleDetailsMessage(plan, isDry, tb) — Swap plan detail embed.
 *     buildScrambleCompletedEmbed(...)            — Post-execution summary embed.
 *     buildScrambleFailedEmbed(reason, time, tb)  — Failure notification embed.
 *     buildFatalErrorEmbed(err, context, tb)      — Critical error embed with stack.
 *     buildWinStreakEmbed(tb, message)            — Win streak broadcast embed.
 *
 * ─── DEPENDENCIES ────────────────────────────────────────────────
 *
 * Logger (../../core/logger.js)
 *   Verbose logging for send failures and rate-limit events.
 *
 * ─── NOTES ───────────────────────────────────────────────────────
 *
 * - Uses raw JS embed objects (not Discord.js MessageEmbed) to remain
 *   compatible across Discord.js v12 and v13+ without importing the library.
 * - sendDiscordMessage handles 429 rate limits with one automatic retry
 *   using the retryAfter value from the error or response header.
 * - All embed builders accept the TeamBalancer instance (tb) to read
 *   live server state and options. No internal state is stored.
 *
 * Author:
 * Discord: `real_slacker`
 *
 * ═══════════════════════════════════════════════════════════════
 */
import Logger from '../../core/logger.js';

export const DiscordHelpers = {
  buildStatusEmbed(tb) {
    // Defensive checks
    const effectiveStatus = !tb.ready
      ? 'INITIALIZING'
      : tb.manuallyDisabled
      ? 'DISABLED (manual)'
      : tb.options?.enableWinStreakTracking
      ? 'ENABLED'
      : 'DISABLED (config)';

    const maxStreak = tb.options?.maxWinStreak || 2;
    const winStreakText = tb.winStreakTeam
      ? `${tb.getTeamName(tb.winStreakTeam)}: ${tb.winStreakCount} / ${maxStreak} wins`
      : `None (Threshold: ${maxStreak} wins)`;

    const maxConsecutive = tb.options?.maxConsecutiveWinsWithoutThreshold || 0;
    const consecutiveText = tb.consecutiveWinsTeam
      ? `${tb.getTeamName(tb.consecutiveWinsTeam)}: ${tb.consecutiveWinsCount} / ${maxConsecutive > 0 ? maxConsecutive : 'Off'}`
      : `None (Threshold: ${maxConsecutive > 0 ? maxConsecutive : 'Off'})`;

    let lastScrambleText = 'Never';
    if (tb.lastScrambleTime) {
      const unixTime = Math.floor(tb.lastScrambleTime / 1000);
      // Discord timestamp: f = short date time, R = relative time
      lastScrambleText = `<t:${unixTime}:f> (<t:${unixTime}:R>)`;
    }

    const players = tb.server.players;
    const t1Count = players.filter((p) => p.teamID === 1).length;
    const t2Count = players.filter((p) => p.teamID === 2).length;

    const eloTrackerPlugin = tb.server.plugins?.find(p => p.constructor.name === 'EloTracker');
    const eloStatus = tb.options?.useEloForBalance ? (eloTrackerPlugin ? '✅ Active' : '❌ Unavailable') : '⏹️ Disabled';

    const embed = {
      color: 0x3498db,
      title: '📊 TeamBalancer Status',
      fields: [
        { name: 'Version', value: tb.constructor.version || 'Unknown', inline: true },
        { name: 'Plugin Status', value: effectiveStatus, inline: true },
        { name: 'Elo Integration', value: eloStatus, inline: true },
        { name: 'Dominant Streak', value: winStreakText, inline: true },
        { name: 'Consecutive Streak', value: consecutiveText, inline: true },
        { name: 'Last Scramble', value: lastScrambleText, inline: false },
        { name: 'Player Count', value: `Total: ${players.length} | T1: ${t1Count} | T2: ${t2Count}`, inline: false }
      ],
      timestamp: new Date().toISOString()
    };

    return embed;
  },

  buildDiagEmbeds(tb, diagnosticResults = null) {
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

    const eloTrackerPlugin = tb.server.plugins?.find(p => p.constructor.name === 'EloTracker');
    const eloStatus = tb.options?.useEloForBalance ? (eloTrackerPlugin ? '✅ Active' : '❌ Unavailable') : '⏹️ Disabled';

    // Determine color based on diagnostics if present
    let color = 0x3498db;
    if (diagnosticResults) {
      color = diagnosticResults.every((r) => r.pass) ? 0x2ecc71 : 0xe74c3c;
    }

    const embed1 = {
      color: color,
      title: '🩺 TeamBalancer Diagnostics - Live State',
      description: `**Plugin Status:** ${!tb.ready ? 'INITIALIZING' : tb.manuallyDisabled ? 'DISABLED (Manual)' : 'ENABLED'}`,
      fields: [
        { name: 'Version', value: tb.constructor.version || 'Unknown', inline: true },
        { name: 'Elo Integration', value: eloStatus, inline: true },
        { name: 'Game Mode', value: tb.gameModeCached || 'N/A', inline: true },
        { name: 'Win Streak', value: tb.winStreakTeam ? `${tb.getTeamName(tb.winStreakTeam)}: ${tb.winStreakCount} win(s)` : 'None', inline: true },
        { name: 'Consecutive', value: tb.consecutiveWinsTeam ? `${tb.getTeamName(tb.consecutiveWinsTeam)}: ${tb.consecutiveWinsCount}` : 'None', inline: true },
        { name: 'Team Names', value: `${tb.getTeamName(1)} | ${tb.getTeamName(2)}`, inline: true },
        { name: 'Scramble Pending', value: tb._scramblePending ? 'Yes' : 'No', inline: true },
        { name: 'Scramble Active', value: tb._scrambleInProgress ? 'Yes' : 'No', inline: true },
        { name: 'Pending Moves', value: scrambleInfo, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: 'Total Players', value: `${players.length}`, inline: true },
        { name: 'Team 1 | Team 2', value: `${t1Players.length} | ${t2Players.length}`, inline: true },
        { name: 'Unassigned', value: `T1: ${t1UnassignedPlayers.length} | T2: ${t2UnassignedPlayers.length}`, inline: true },
        { name: 'Total Squads', value: `${squads.length}`, inline: true },
        { name: 'Squad Split', value: `T1: ${t1Squads.length} | T2: ${t2Squads.length}`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    const embed2 = {
      color: color,
      title: '⚙️ TeamBalancer Diagnostics - Configuration',
      fields: [
        { name: 'Max Win Threshold', value: `${tb.options?.maxWinStreak || 2} wins`, inline: true },
        { name: 'Max Consec. Wins', value: `${tb.options?.maxConsecutiveWinsWithoutThreshold || 0}`, inline: true },
        { name: 'Dominant Threshold', value: `${tb.options?.minTicketsToCountAsDominantWin || 150} tickets`, inline: true },
        { name: 'Single Round Scramble', value: tb.options?.enableSingleRoundScramble ? `ON (> ${tb.options?.singleRoundScrambleThreshold} tix)` : 'OFF', inline: true },
        { name: 'Invasion Thresholds', value: `Atk: ${tb.options?.invasionAttackTeamThreshold} | Def: ${tb.options?.invasionDefenceTeamThreshold}`, inline: true },
        { name: 'Scramble %', value: `${(tb.options?.scramblePercentage || 0.5) * 100}%`, inline: true },
        { name: 'Scramble Delay', value: `${tb.options?.scrambleAnnouncementDelay}s`, inline: true },
        { name: 'Max Scramble Time', value: `${tb.options?.maxScrambleCompletionTime}ms`, inline: true },
        { name: 'Discord Options', value: `Mirror: ${tb.options?.mirrorRconBroadcasts ? 'Yes' : 'No'} | Details: ${tb.options?.postScrambleDetails ? 'Yes' : 'No'}`, inline: true },
      ],
      timestamp: new Date().toISOString()
    };

    const embeds = [embed1, embed2];

    if (diagnosticResults) {
      const resultsEmbeds = this.buildDiagnosticResultsEmbeds(diagnosticResults, color);
      embeds.push(...resultsEmbeds);
    }

    return embeds;
  },

  buildDiagnosticResultsEmbeds(diagnosticResults, color) {
    const embeds = [];
    const formatMessage = (msg) => (msg.length > 1000 ? msg.substring(0, 997) + '...' : msg);
    const maxFieldsPerEmbed = 25; // Discord limit
    const totalPages = Math.ceil(diagnosticResults.length / maxFieldsPerEmbed);

    let currentEmbed = null;

    for (let i = 0; i < diagnosticResults.length; i++) {
      if (i % maxFieldsPerEmbed === 0) {
        const pageNum = Math.floor(i / maxFieldsPerEmbed) + 1;
        const title = totalPages > 1 ? `🔍 Diagnostic Results (Part ${pageNum})` : `🔍 Diagnostic Results`;
        currentEmbed = {
          color: color,
          title: title,
          fields: [],
          timestamp: new Date().toISOString(),
        };
        embeds.push(currentEmbed);
      }
      currentEmbed.fields.push({ name: `**${diagnosticResults[i].name}:**`, value: formatMessage(diagnosticResults[i].message), inline: false });
    }

    return embeds;
  },

  async createScrambleDetailsMessage(swapPlan, isSimulated, teamBalancer, eloMap = null) {
    const players = teamBalancer.server.players;
    const squads = teamBalancer.server.squads;
    const currentT1 = players.filter(p => p.teamID == 1).length;
    const currentT2 = players.filter(p => p.teamID == 2).length;

    const f1 = teamBalancer.getTeamName(1);
    const f2 = teamBalancer.getTeamName(2);

    const moveData = {
      '1to2': { srcID: 1, tgtID: 2, srcFaction: f1, tgtFaction: f2, playersTotal: 0, squads: {} },
      '2to1': { srcID: 2, tgtID: 1, srcFaction: f2, tgtFaction: f1, playersTotal: 0, squads: {} }
    };

    for (const move of swapPlan) {
      const player = players.find(p => p.eosID === move.eosID);
      if (!player) continue;

      const srcID = String(player.teamID);
      const tgtID = String(move.targetTeamID);
      const dirKey = `${srcID}to${tgtID}`;

      if (moveData[dirKey]) {
        moveData[dirKey].playersTotal++;
        const sID = player.squadID || 'UNASSIGNED';
        if (!moveData[dirKey].squads[sID]) moveData[dirKey].squads[sID] = [];
        moveData[dirKey].squads[sID].push(move.eosID);
      }
    }

    const movesToT1 = moveData['2to1'].playersTotal;
    const movesToT2 = moveData['1to2'].playersTotal;
    const projT1 = currentT1 + movesToT1 - movesToT2;
    const projT2 = currentT2 + movesToT2 - movesToT1;

    let balanceProjectionValue = `**Population:** Team 1 (${f1}): ${currentT1} ➔ ${projT1} | Team 2 (${f2}): ${currentT2} ➔ ${projT2}`;

    if (eloMap) {
      let t1Mu = 0, t2Mu = 0, t1Regs = 0, t2Regs = 0;
      let t1Count = 0, t2Count = 0;
      
      let projT1Mu = 0, projT2Mu = 0, projT1Regs = 0, projT2Regs = 0;
      let projT1Count = 0, projT2Count = 0;

      for (const p of players) {
        const rating = eloMap.get(p.eosID);
        const mu = rating ? rating.mu : 25.0;
        const isReg = rating && (rating.roundsPlayed || 0) >= 10;

        // Baseline logic
        if (String(p.teamID) === '1') {
          t1Mu += mu; t1Count++;
          if (isReg) t1Regs++;
        } else if (String(p.teamID) === '2') {
          t2Mu += mu; t2Count++;
          if (isReg) t2Regs++;
        }

        // Projected logic (simulate the move)
        const plannedMove = swapPlan.find(m => m.eosID === p.eosID);
        const projectedTeam = plannedMove ? String(plannedMove.targetTeamID) : String(p.teamID);
        
        if (projectedTeam === '1') {
          projT1Mu += mu; projT1Count++;
          if (isReg) projT1Regs++;
        } else if (projectedTeam === '2') {
          projT2Mu += mu; projT2Count++;
          if (isReg) projT2Regs++;
        }
      }

      const avgT1 = t1Count > 0 ? (t1Mu / t1Count).toFixed(1) : '25.0';
      const avgT2 = t2Count > 0 ? (t2Mu / t2Count).toFixed(1) : '25.0';
      const pAvgT1 = projT1Count > 0 ? (projT1Mu / projT1Count).toFixed(1) : '25.0';
      const pAvgT2 = projT2Count > 0 ? (projT2Mu / projT2Count).toFixed(1) : '25.0';

      balanceProjectionValue += `\n**Average ELO:** Team 1: ${avgT1}μ ➔ ${pAvgT1}μ | Team 2: ${avgT2}μ ➔ ${pAvgT2}μ`;
      balanceProjectionValue += `\n**Regulars:** Team 1: ${t1Regs} ➔ ${projT1Regs} | Team 2: ${t2Regs} ➔ ${projT2Regs}`;
    }

    const embed = {
      color: isSimulated ? 0x9b59b6 : 0x2ecc71,
      title: isSimulated ? '🧪 Dry Run Scramble Plan' : '🔀 Scramble Execution Plan',
      description: `**Total players affected:** ${swapPlan.length}\n**Calculation Time:** ${swapPlan.calculationTime || 'N/A'}ms`,
      fields: [
        { 
          name: 'Balance Projection', 
          value: balanceProjectionValue, 
          inline: false 
        }
      ],
      timestamp: new Date().toISOString()
    };

    for (const dir of ['1to2', '2to1']) {
      const data = moveData[dir];
      if (data.playersTotal === 0) continue;

      let fieldValue = '';
      let partCount = 1;
      const squadEntries = Object.entries(data.squads);

      for (const [sID, playerIDs] of squadEntries) {
        const names = this.resolveEOSIDsToNames(playerIDs, teamBalancer, eloMap);
        const squadName = sID === 'UNASSIGNED' ? 'UNASSIGNED' : (squads.find(s => String(s.squadID) === String(sID) && String(s.teamID) === String(data.srcID))?.squadName || `Squad ${sID}`);
        
        let squadMuTotal = 0;
        let squadRegs = 0;
        if (eloMap) {
          for (const eosID of playerIDs) {
            const rating = eloMap.get(eosID);
            if (rating) {
              squadMuTotal += rating.mu;
              if ((rating.roundsPlayed || 0) >= 10) squadRegs++;
            } else {
              squadMuTotal += 25.0; // Default Mu
            }
          }
        }
        const squadAvgMu = playerIDs.length > 0 ? (squadMuTotal / playerIDs.length).toFixed(1) : '25.0';

        const header = eloMap 
          ? `[${squadName} - ${squadAvgMu}μ | ${squadRegs} Regs]` 
          : `[${squadName}]`;
          
        const line = `${header}\n${names.join(', ')}`;
        
        const codeBlockWrapLen = 13; // ```text\n ... \n```
        if (fieldValue && fieldValue.length + line.length + 2 + codeBlockWrapLen > 1024) {
          // Push current fieldValue as a field
          const fieldName = partCount === 1 
            ? `Team ${data.srcID} (${data.srcFaction}) ➔ Team ${data.tgtID} (${data.tgtFaction}) [${data.playersTotal} players]`
            : `Team ${data.srcID} (${data.srcFaction}) ➔ Team ${data.tgtID} (${data.tgtFaction}) (Cont.)`;
            
          embed.fields.push({
            name: fieldName,
            value: `\`\`\`text\n${fieldValue}\n\`\`\``,
            inline: false
          });
          
          fieldValue = line;
          partCount++;
        } else {
          fieldValue = fieldValue ? fieldValue + '\n\n' + line : line;
        }
      }

      if (fieldValue) {
        const fieldName = partCount === 1 
          ? `Team ${data.srcID} (${data.srcFaction}) ➔ Team ${data.tgtID} (${data.tgtFaction}) [${data.playersTotal} players]`
          : `Team ${data.srcID} (${data.srcFaction}) ➔ Team ${data.tgtID} (${data.tgtFaction}) (Cont.)`;
          
        embed.fields.push({
          name: fieldName,
          value: `\`\`\`text\n${fieldValue}\n\`\`\``,
          inline: false
        });
      }
    }

    if (swapPlan.length === 0) {
      const action = isSimulated ? 'simulation' : 'scramble calculation';
      embed.footer = { text: `The ${action} resulted in no player moves. This is expected behavior on low-population servers.` };
    }

    return embed;
  },

  resolveEOSIDsToNames(eosIDs, teamBalancer, eloMap) {
    return eosIDs.map(eosID => {
      const player = teamBalancer.server.players.find(p => p.eosID === eosID);
      let nameStr = player ? player.name : `Unknown (${eosID.slice(0, 8)}...)`;
      if (eloMap) {
        const rating = eloMap.get(eosID);
        if (rating) {
            const isReg = (rating.roundsPlayed || 0) >= 10;
            const regStar = isReg ? '★' : '';
            nameStr = `${nameStr} [${rating.mu.toFixed(1)}${regStar}]`;
        } else {
            nameStr = `${nameStr} [25.0]`;
        }
      }
      return nameStr;
    });
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

  buildScrambleCompletedEmbed(totalMoves, movedSuccessfully, failedToMove, disconnected, duration) {
    const successRate = totalMoves > 0 ? Math.round((movedSuccessfully / totalMoves) * 100) : 100;

    const embed = {
      color: failedToMove > 0 ? 0xf39c12 : 0x2ecc71,
      title: '✅ Scramble Completed',
      fields: [
        { name: 'Total Moves', value: `${totalMoves}`, inline: true },
        { name: 'Moved Successfully', value: `${movedSuccessfully}`, inline: true },
        { name: 'Disconnected', value: `${disconnected}`, inline: true },
        { name: 'Failed', value: `${failedToMove}`, inline: true },
        { name: 'Success Rate', value: `${successRate}%`, inline: true },
        { name: 'Duration', value: `${duration}ms`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    if (failedToMove > 0) {
      embed.description = '⚠️ Some players could not be moved. Check logs for details.';
    }

    return embed;
  },

  buildScrambleFailedEmbed(reason, duration, tb) {
    const players = tb?.server?.players || [];
    const t1Count = players.filter((p) => p.teamID == 1).length;
    const t2Count = players.filter((p) => p.teamID == 2).length;

    const embed = {
      color: 0xe74c3c,
      title: '❌ Scramble Failed',
      description: `**Reason:** ${reason}`,
      fields: [
        { name: 'Calculation Time', value: `${duration}ms`, inline: true },
        { name: 'Server State', value: `**Total:** ${players.length}\n**T1:** ${t1Count} | **T2:** ${t2Count}`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };
    return embed;
  },

  buildFatalErrorEmbed(error, context, tb) {
    const players = tb?.server?.players || [];
    const t1Count = players.filter((p) => p.teamID == 1).length;
    const t2Count = players.filter((p) => p.teamID == 2).length;

    const embed = {
      color: 0x992d22,
      title: '☠️ Fatal Plugin Error',
      description: `**Context:** ${context}\n**Error:** ${error?.message || error}`,
      fields: [
        { name: 'Server State', value: `**Total:** ${players.length}\n**T1:** ${t1Count} | **T2:** ${t2Count}`, inline: true },
        { name: 'Version', value: tb?.constructor?.version || 'Unknown', inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    if (error?.stack) {
      const stack = error.stack.length > 1000 ? error.stack.substring(0, 1000) + '...' : error.stack;
      embed.fields.push({ name: 'Stack Trace', value: `\`\`\`js\n${stack}\n\`\`\``, inline: false });
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

    // Standardize Input: Ensure 'embeds' array is used internally for objects
    let payload = content;
    if (typeof content === 'object' && content !== null) {
      payload = { ...content };
      if (payload.embed && !payload.embeds) {
        payload.embeds = [payload.embed];
        delete payload.embed;
      }
    }

    const executeSend = async (data, isRetry = false) => {
      try {
        await channel.send(data);
        return true;
      } catch (err) {
        // Rate Limit Handling (429)
        if (err.status === 429 && !isRetry) {
          let waitTime = 1000;
          if (err.retryAfter) waitTime = err.retryAfter;
          else if (err.headers && err.headers['retry-after']) waitTime = parseFloat(err.headers['retry-after']) * 1000;

          Logger.verbose('TeamBalancer', 1, `Discord 429 Rate Limit hit. Waiting ${waitTime}ms before retry.`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          return executeSend(data, true);
        }

        // Compatibility: Discord.js v12 Fallback
        if (err.message === 'Cannot send an empty message' && data.embeds && data.embeds.length > 0) {
          const legacyData = { ...data, embed: data.embeds[0] };
          delete legacyData.embeds;
          return executeSend(legacyData, isRetry);
        }

        throw err;
      }
    };

    try {
      await executeSend(payload);
      return true;
    } catch (err) {
      const errMsg = `Discord send failed: ${err.message}`;
      if (!suppressErrors) throw new Error(errMsg);
      Logger.verbose('TeamBalancer', 1, errMsg);
      return false;
    }
  }
};
