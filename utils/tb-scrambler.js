/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║             SQUAD-PRESERVING TEAM SCRAMBLE ALGORITHM          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Part of the TeamBalancer Plugin
 *
 * This algorithm rebalances teams by swapping whole squads and unassigned players. 
 * It utilizes a Tiered Surgical Fallback system to ensure numerical parity 
 * while maximizing friend-group cohesion (keeping squads together).
 *
 * THE PROCESS INVOLVES:
 *
 * 1. Data Preparation: Normalizes player/squad snapshots. Unassigned 
 * players are treated as individual "pseudo-squads" for movement flexibility.
 *
 * 2. Target Calculation: Establishes movement targets based on the 
 * scramblePercentage and the current delta between Team 1 and Team 2.
 *
 * 3. Iterative Selection (Monte Carlo): Runs 121 attempts to find the 
 * optimal swap, scoring candidates on balance, churn, and cap penalties.
 *
 * 4. Surgical Squad Breaking (Attempts 31-119): If balance remains poor, 
 * the algorithm non-destructively selects ONE random unlocked squad per 
 * iteration to "shatter" into individuals. This allows for precision 
 * balancing without mass-breaking all groups.
 *
 * 5. Nuclear Option (Attempt 120): As a final resort, all squads (including 
 * locked) are decomposed to resolve extreme parity issues.
 *
 * 6. Scoring & Penalties: A lockedPenalty (500 pts) and cohesionPenalty 
 * (25 pts) ensure that breaking groups is mathematically the least 
 * preferred outcome compared to whole-squad swaps.
 *
 * 7. Cap Enforcement & Trimming: A final corrective phase ensures neither 
 * team exceeds limits (default 50). It intelligently trims overages by 
 * moving Unassigned -> Unlocked -> Locked players in that order.
 *
 * RELATION TO OTHER FILES:
 * This module acts as a pure logic provider. It accepts snapshots, calculates 
 * the optimal moves, and returns a 'swap plan'. It does not execute RCON 
 * commands; execution is handled by the SwapExecutor.
 */

import Logger from '../../core/logger.js';

export const Scrambler = {
  async scrambleTeamsPreservingSquads({
    squads,
    players,
    winStreakTeam,
    scramblePercentage = 0.5,
  }) {
    const totalPlayers = players.length;
    const maxTeamSize = Math.max(50, Math.ceil(totalPlayers / 2));

    Logger.verbose('TeamBalancer', 2, `========== Starting Team Scramble (Max cap = ${maxTeamSize}) ==========`);

    if (![1, 2].includes(winStreakTeam)) {
      winStreakTeam = Math.random() < 0.5 ? 1 : 2;
      Logger.verbose('TeamBalancer', 4, `No win streak team set. Randomly selecting Team ${winStreakTeam} as starting side.`);
    }

    const workingPlayers = players.map((p) => ({
      ...p,
      teamID: String(p.teamID)
    }));
    const workingSquads = squads.map((s) => ({
      ...s,
      teamID: String(s.teamID),
      players: [...s.players]
    }));

    const updatePlayerTeam = (steamID, newTeamID) => {
      const player = workingPlayers.find((p) => p.steamID === steamID);
      if (player) {
        player.teamID = String(newTeamID);
      }
    };

    const getCurrentTeamCounts = () => {
      const team1Players = workingPlayers.filter((p) => p.teamID === '1');
      const team2Players = workingPlayers.filter((p) => p.teamID === '2');

      const team1Count = team1Players.length;
      const team2Count = team2Players.length;
      const unassignedCount = workingPlayers.filter((p) => p.squadID === null).length;
      return { team1Count, team2Count, unassignedCount };
    };

    const initialCounts = getCurrentTeamCounts();
    Logger.verbose('TeamBalancer', 4, `Initial team sizes: Team1 = ${initialCounts.team1Count}, Team2 = ${initialCounts.team2Count}, Unassigned (no squad) = ${initialCounts.unassignedCount}`);

    const targetPlayersToMove = Math.round(totalPlayers * scramblePercentage);
    Logger.verbose('TeamBalancer', 4, `Target players to move (total): ${targetPlayersToMove} (${scramblePercentage * 100}%)`);

    const allSquads = workingSquads.filter((s) => s.players?.length > 0);
    const unassigned = workingPlayers.filter((p) => p.squadID === null);

    Logger.verbose('TeamBalancer', 4, `Total players: ${totalPlayers}, Max per team: ${maxTeamSize}, Scramble Percentage: ${scramblePercentage * 100}%`);
    const unassignedPseudoSquads = unassigned.map((p) => ({
      id: `Unassigned - ${p.steamID}`,
      teamID: p.teamID, // Their actual team (1 or 2)
      players: [p.steamID]
    }));
    const filterCandidates = (teamID) =>
      allSquads
        .filter((s) => s.teamID === teamID)
        .concat(unassignedPseudoSquads.filter((s) => s.teamID === teamID));

    let t1Candidates = filterCandidates('1');
    let t2Candidates = filterCandidates('2');

    Logger.verbose('TeamBalancer', 4, `Candidate squads filtered: Team1 = ${t1Candidates.length}, Team2 = ${t2Candidates.length}`);

    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };

    const selectTieredSquads = (candidates, maxPlayersToSelect, usedSquadIds) => {
      const selected = [];
      let currentCount = 0;
      
      const sortedCandidates = [...candidates].sort((a, b) => {
        if (a.players.length === 1 && b.players.length !== 1) return 1;
        if (a.players.length !== 1 && b.players.length === 1) return -1;
        return b.players.length - a.players.length;
      });

      for (const squad of sortedCandidates) {
        if (usedSquadIds.has(squad.id)) {
          continue;
        }

        const size = squad.players.length;
        if (currentCount + size <= maxPlayersToSelect) {
          selected.push(squad);
          usedSquadIds.add(squad.id);
          currentCount += size;
        } else {          
          if (currentCount < maxPlayersToSelect && currentCount + size - maxPlayersToSelect <= 3) {
            selected.push(squad);
            usedSquadIds.add(squad.id);
            currentCount += size;
          }
        }
      }
      return selected;
    };

    const scoreSwap = (
      selectedT1Squads,
      selectedT2Squads,
      initialT1Count,
      initialT2Count,
      maxTeamSize,
      targetPlayersToMoveOverall
    ) => {
      const sum = (squads) => squads.reduce((n, s) => n + s.players.length, 0);
      const playersMovedFromT1 = sum(selectedT1Squads);
      const playersMovedFromT2 = sum(selectedT2Squads);
      
      const actualPlayersMoved = playersMovedFromT1 + playersMovedFromT2;
      
      const hypotheticalNewT1 = initialT1Count - playersMovedFromT1 + playersMovedFromT2;
      const hypotheticalNewT2 = initialT2Count - playersMovedFromT2 + playersMovedFromT1;
      
      const churnScore = Math.abs(actualPlayersMoved - targetPlayersToMoveOverall);
      
      const balanceScore = Math.abs(hypotheticalNewT1 - hypotheticalNewT2);
      
      const penaltyT1Overcap = Math.max(0, hypotheticalNewT1 - maxTeamSize) * 10000; // Increased penalty
      const penaltyT2Overcap = Math.max(0, hypotheticalNewT2 - maxTeamSize) * 10000; // Increased penalty
      
      const totalPlayers = initialT1Count + initialT2Count;
      const idealTeamSize = totalPlayers / 2;
      let sizeDeviationPenalty = 0;
      if (hypotheticalNewT1 < idealTeamSize - 5 || hypotheticalNewT2 < idealTeamSize - 5) {
        sizeDeviationPenalty += 50; // Moderate penalty for significant underpopulation
      }

      const calcLockedPenalty = (squads) => {
        const brokenSquads = new Set();
        for (const s of squads) {
          if (s.wasLocked) brokenSquads.add(s.sourceSquadId || s.id);
        }
        return brokenSquads.size * 500;
      };
      const lockedPenalty = calcLockedPenalty(selectedT1Squads) + calcLockedPenalty(selectedT2Squads);
      
      const calcCohesionPenalty = (squads) => {
        let penalty = 0;
        for (const s of squads) {
          if (s.id.startsWith('Split-') && !s.wasLocked) {
            penalty += 25;
          }
        }
        return penalty;
      };
      const cohesionPenalty = calcCohesionPenalty(selectedT1Squads) + calcCohesionPenalty(selectedT2Squads);

      let combinedScore =
        churnScore * 2 + // Reduced weight (tie-breaker only)
        balanceScore * 50 + // Massive weight for numerical parity
        penaltyT1Overcap +
        penaltyT2Overcap + 
        sizeDeviationPenalty +
        lockedPenalty +
        cohesionPenalty;
      
      if (
        targetPlayersToMoveOverall > 10 &&
        actualPlayersMoved < targetPlayersToMoveOverall * 0.5
      ) {
        combinedScore += 100; // Significant penalty for not meeting at least half the churn target
      }

      return combinedScore;
    };

    const MAX_ATTEMPTS = 121; // Increased attempts to find a good solution
    let bestScore = Infinity;
    let bestT1SwapCandidates = null;
    let bestT2SwapCandidates = null;

    Logger.verbose('TeamBalancer', 4, `Starting swap attempts (max ${MAX_ATTEMPTS})`);

    const decomposeList = (list, targetId = null, breakAll = false) => {
      const result = [];
      for (const item of list) {
        const isTarget = breakAll || (targetId && item.id === targetId);
        if (isTarget && !item.id.startsWith('Unassigned') && !item.id.startsWith('Split')) {
          for (const pid of item.players) {
            result.push({
              id: `Split-${pid}`,
              teamID: item.teamID,
              players: [pid],
              wasLocked: item.locked,
              sourceSquadId: item.id
            });
          }
        } else {
          result.push(item);
        }
      }
      return result;
    };

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      let localT1 = [...t1Candidates];
      let localT2 = [...t2Candidates];

      // Surgical Squad Splitting (Attempts 31-119)
      if (i >= 30 && i < 120 && bestScore > 10) {
        const getEligible = (list) => list.filter(s => !s.locked && !s.id.startsWith('Unassigned') && !s.id.startsWith('Split'));
        const t1Eligible = getEligible(localT1);
        const t2Eligible = getEligible(localT2);
        const allEligible = [...t1Eligible, ...t2Eligible];

        if (allEligible.length > 0) {
          const victim = allEligible[Math.floor(Math.random() * allEligible.length)];
          if (victim.teamID === '1') localT1 = decomposeList(localT1, victim.id);
          else localT2 = decomposeList(localT2, victim.id);
        }
      }

      // Nuclear Option (Attempt 120)
      if (i === 120) {
        Logger.verbose('TeamBalancer', 2, 'Engaging Nuclear Option: Decomposing all squads for final attempt.');
        localT1 = decomposeList(localT1, null, true);
        localT2 = decomposeList(localT2, null, true);
      }

      const currentUsedSquadIds = new Set(); // Reset for each attempt
      
      shuffle(localT1);
      shuffle(localT2);
      
      const teamDiff = initialCounts.team1Count - initialCounts.team2Count;
      let targetMoveFromT1 = Math.round((targetPlayersToMove / 2) + (teamDiff / 4));
      let targetMoveFromT2 = Math.round((targetPlayersToMove / 2) - (teamDiff / 4));
      
      targetMoveFromT1 = Math.max(0, targetMoveFromT1 + Math.floor(Math.random() * 5) - 2); // +/- 2 players
      targetMoveFromT2 = Math.max(0, targetMoveFromT2 + Math.floor(Math.random() * 5) - 2); // +/- 2 players
      
      targetMoveFromT1 = Math.min(
        targetMoveFromT1,
        localT1.reduce((sum, s) => sum + s.players.length, 0)
      );
      targetMoveFromT2 = Math.min(
        targetMoveFromT2,
        localT2.reduce((sum, s) => sum + s.players.length, 0)
      );
      
      const selT1 = selectTieredSquads(localT1, targetMoveFromT1, currentUsedSquadIds);
      const selT2 = selectTieredSquads(localT2, targetMoveFromT2, currentUsedSquadIds);

      const currentScore = scoreSwap(
        selT1,
        selT2,
        initialCounts.team1Count,
        initialCounts.team2Count,
        maxTeamSize,
        targetPlayersToMove
      );

      Logger.verbose(
        'TeamBalancer',
        4,
        `Attempt ${i + 1}: Score = ${currentScore.toFixed(2)}, Move T1->T2 = ${selT1.reduce((n, s) => n + s.players.length, 0)}, Move T2->T1 = ${selT2.reduce((n, s) => n + s.players.length, 0)}, Hypo T1 = ${initialCounts.team1Count - selT1.reduce((n, s) => n + s.players.length, 0) + selT2.reduce((n, s) => n + s.players.length, 0)}, Hypo T2 = ${initialCounts.team2Count - selT2.reduce((n, s) => n + s.players.length, 0) + selT1.reduce((n, s) => n + s.players.length, 0)}`
      );
      Logger.verbose('TeamBalancer', 4, `Team1 selected squads IDs: ${selT1.map((s) => s.id).join(', ')}`);
      Logger.verbose('TeamBalancer', 4, `Team2 selected squads IDs: ${selT2.map((s) => s.id).join(', ')}`);

      const t1Ids = new Set(selT1.map((s) => s.id));
      const t2Ids = new Set(selT2.map((s) => s.id));
      const intersection = [...t1Ids].filter((id) => t2Ids.has(id));

      if (intersection.length > 0) {
        Logger.verbose('TeamBalancer', 2, `WARNING: Duplicate squad selection detected: ${intersection.join(', ')} - skipping attempt ${i + 1}`);
        continue;
      }

      if (currentScore < bestScore) {
        bestScore = currentScore;
        bestT1SwapCandidates = selT1;
        bestT2SwapCandidates = selT2;
        Logger.verbose('TeamBalancer', 4, `New best score found: ${bestScore.toFixed(2)} at attempt ${i + 1}`);
        if (bestScore <= 5) {          
          Logger.verbose('TeamBalancer', 4, `Very good score (${bestScore}) found. Breaking early from swap attempts.`);
          break;
        }
      }
    }

    if (!bestT1SwapCandidates || !bestT2SwapCandidates) {
      Logger.verbose('TeamBalancer', 2, 'No valid swap solution found within attempt limit.');
      return []; // Return empty array if no solution found
    }
    
    const finalT1Ids = new Set(bestT1SwapCandidates.map((s) => s.id));
    const finalT2Ids = new Set(bestT2SwapCandidates.map((s) => s.id));
    const finalIntersection = [...finalT1Ids].filter((id) => finalT2Ids.has(id));

    if (finalIntersection.length > 0) {
      Logger.verbose('TeamBalancer', 1, `CRITICAL ERROR: Final solution has duplicate squads: ${finalIntersection.join(', ')}`);
      Logger.verbose('TeamBalancer', 1, 'Aborting scramble to prevent team count corruption.');
      return []; // Return empty array if critical error
    }

    const preSwapCounts = getCurrentTeamCounts();
    Logger.verbose('TeamBalancer', 4, `Pre-swap team sizes: Team1 = ${preSwapCounts.team1Count}, Team2 = ${preSwapCounts.team2Count}`);
    const finalPlayerMovesMap = new Map();

    for (const squad of bestT1SwapCandidates) {
      for (const steamID of squad.players) {
        finalPlayerMovesMap.set(steamID, { steamID, targetTeamID: '2' });
        updatePlayerTeam(steamID, '2'); // Update internal working copy
      }
    }

    
    for (const squad of bestT2SwapCandidates) {
      for (const steamID of squad.players) {
        finalPlayerMovesMap.set(steamID, { steamID, targetTeamID: '1' });
        updatePlayerTeam(steamID, '1'); // Update internal working copy
      }
    }

    const postInitialSwapCounts = getCurrentTeamCounts();
    Logger.verbose('TeamBalancer', 4, `Post-initial-swap internal team sizes: Team1 = ${postInitialSwapCounts.team1Count}, Team2 = ${postInitialSwapCounts.team2Count}`);

    
    const getPlayersForTrimming = (
      teamID,
      currentWorkingPlayers,
      currentWorkingSquads,
      existingMovesMap
    ) => {
      const playersOnTeam = currentWorkingPlayers.filter((p) => p.teamID === String(teamID));

      
      const eligiblePlayers = playersOnTeam.filter((p) => !existingMovesMap.has(p.steamID));

      const unassignedPlayers = eligiblePlayers.filter((p) => p.squadID === null);

      const playersInSquads = eligiblePlayers.filter((p) => p.squadID !== null);

      
      const playersWithSquadStatus = playersInSquads.map((p) => {
        const squad = currentWorkingSquads.find((s) => s.id === p.squadID);
        return {
          ...p,
          isLocked: squad ? squad.locked : false // Default to not locked if squad not found (shouldn't happen)
        };
      });

      const unlockedSquadPlayers = playersWithSquadStatus.filter((p) => !p.isLocked);
      const lockedSquadPlayers = playersWithSquadStatus.filter((p) => p.isLocked);

      
      return [...unassignedPlayers, ...unlockedSquadPlayers, ...lockedSquadPlayers];
    };

    let team1Overcap = postInitialSwapCounts.team1Count - maxTeamSize;
    let team2Overcap = postInitialSwapCounts.team2Count - maxTeamSize;

    
    let madeProgress = true;
    while (madeProgress && (team1Overcap > 0 || team2Overcap > 0)) {
      madeProgress = false;

      
      if (team1Overcap > 0) {
        
        const playersToConsider = getPlayersForTrimming(
          '1',
          workingPlayers,
          workingSquads,
          finalPlayerMovesMap
        );
        for (const player of playersToConsider) {
          
          if (getCurrentTeamCounts().team1Count > getCurrentTeamCounts().team2Count + 1) {
            finalPlayerMovesMap.set(player.steamID, { steamID: player.steamID, targetTeamID: '2' });
            updatePlayerTeam(player.steamID, '2');
            Logger.verbose('TeamBalancer', 4, `Trimming: Player ${player.steamID} from Team 1 to Team 2 (overcap fix)`);
            madeProgress = true;
            break; // Move one player at a time and re-evaluate
          }
        }
      }

      
      const currentCountsAfterT1Trim = getCurrentTeamCounts();
      team1Overcap = currentCountsAfterT1Trim.team1Count - maxTeamSize;
      team2Overcap = currentCountsAfterT1Trim.team2Count - maxTeamSize;

      
      if (team2Overcap > 0) {
        
        const playersToConsider = getPlayersForTrimming(
          '2',
          workingPlayers,
          workingSquads,
          finalPlayerMovesMap
        );
        for (const player of playersToConsider) {
          
          if (getCurrentTeamCounts().team2Count > getCurrentTeamCounts().team1Count + 1) {
            finalPlayerMovesMap.set(player.steamID, { steamID: player.steamID, targetTeamID: '1' });
            updatePlayerTeam(player.steamID, '1');
            Logger.verbose('TeamBalancer', 4, `Trimming: Player ${player.steamID} from Team 2 to Team 1 (overcap fix)`);
            madeProgress = true;
            break; // Move one player at a time and re-evaluate
          }
        }
      }

      
      const currentCounts = getCurrentTeamCounts();
      team1Overcap = currentCounts.team1Count - maxTeamSize;
      team2Overcap = currentCounts.team2Count - maxTeamSize;
    }

    const finalInternalCounts = getCurrentTeamCounts();
    Logger.verbose('TeamBalancer', 4, `Final internal team sizes after all adjustments: Team1 = ${finalInternalCounts.team1Count}, Team2 = ${finalInternalCounts.team2Count}, Unassigned (no squad) = ${finalInternalCounts.unassignedCount}`);

    
    const finalTeam1Overcap = finalInternalCounts.team1Count - maxTeamSize;
    const finalTeam2Overcap = finalInternalCounts.team2Count - maxTeamSize;

    if (finalTeam1Overcap > 0 || finalTeam2Overcap > 0) {
      Logger.verbose('TeamBalancer', 2, `WARNING: Scramble plan results in teams still exceeding caps after all possible internal moves.`);
      Logger.verbose('TeamBalancer', 2, `Team1 still over by: ${finalTeam1Overcap}, Team2 still over by: ${finalTeam2Overcap}`);
      Logger.verbose('TeamBalancer', 2, `This may require manual intervention or a change in balancing strategy.`);
    }

    Logger.verbose('TeamBalancer', 2, `========== Scramble Plan Generated ==========`);
    Logger.verbose('TeamBalancer', 2, `Total player moves in plan: ${finalPlayerMovesMap.size}`);
    Logger.verbose('TeamBalancer', 2, `Final desired balance: Team1 = ${finalInternalCounts.team1Count}, Team2 = ${finalInternalCounts.team2Count}`);
    Logger.verbose('TeamBalancer', 2, `Unassigned players in plan: ${finalInternalCounts.unassignedCount}`);

    return Array.from(finalPlayerMovesMap.values()); // Return the plan to the TeamBalancer
  }
};

export default Scrambler;