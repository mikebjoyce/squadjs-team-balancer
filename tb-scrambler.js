
/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║             SQUAD-PRESERVING TEAM SCRAMBLE ALGORITHM          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * This algorithm efficiently rebalances Squad teams by swapping whole squads
 * or unassigned players. It prioritizes maintaining squad cohesion and
 * respects team size limits (default 50 players). The goal is to introduce
 * a calculated amount of churn to prevent dominant win streaks and ensure fair matches.
 *
 * The process involves:
 * 1.  **Data Preparation:** Normalizing player and squad data, treating unassigned
 * players as individual "pseudo-squads."
 * 2.  **Target Calculation:** Determining the ideal number of players to move
 * based on the configured `scramblePercentage` and current team imbalance.
 * 3.  **Squad Selection:** Using a randomized, iterative approach to find the
 * best combination of squads to swap, scoring candidates based on balance
 * and churn targets.
 * 4.  **Swap Plan Generation:** Creating a detailed plan of player movements.
 * 5.  **Cap Enforcement:** A final adjustment phase to ensure no team exceeds
 * the maximum player limit, prioritizing unassigned or unlocked players for movement.
 */

import Logger from '../SquadJS-4.1.0/core/logger.js';

export const Scrambler = {
  async scrambleTeamsPreservingSquads({
    squads,
    players,
    winStreakTeam,
    scramblePercentage = 0.5,
    debug = false
  }) {
    const maxTeamSize = 50;
    const maxTotalPlayersAllowed = maxTeamSize * 2 + 2;

    if (debug) Logger.verbose('TeamBalancer', 2, `========== Starting Team Scramble (Max cap = ${maxTeamSize}, Total cap = ${maxTotalPlayersAllowed}) ==========`);

    const totalPlayers = players.length;
    if (totalPlayers > maxTotalPlayersAllowed) {
      Logger.verbose('TeamBalancer', 1, `CRITICAL: Server has ${totalPlayers} players, exceeding maximum allowed capacity of ${maxTotalPlayersAllowed}`);
      Logger.verbose('TeamBalancer', 1, `Cannot scramble with current player count. Consider removing excess players first.`);
      return []; // Return empty array as no swaps can be made
    }

    if (![1, 2].includes(winStreakTeam)) {
      winStreakTeam = Math.random() < 0.5 ? 1 : 2;
      if (debug) Logger.verbose('TeamBalancer', 4, `No win streak team set. Randomly selecting Team ${winStreakTeam} as starting side.`);
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
    if (debug) Logger.verbose('TeamBalancer', 4, `Initial team sizes: Team1 = ${initialCounts.team1Count}, Team2 = ${initialCounts.team2Count}, Unassigned (no squad) = ${initialCounts.unassignedCount}`);

    const targetPlayersToMove = Math.round(totalPlayers * scramblePercentage);
    if (debug) Logger.verbose('TeamBalancer', 4, `Target players to move (total): ${targetPlayersToMove} (${scramblePercentage * 100}%)`);

    const allSquads = workingSquads.filter((s) => s.players?.length > 0);
    const unassigned = workingPlayers.filter((p) => p.squadID === null);

    if (debug) Logger.verbose('TeamBalancer', 4, `Total players: ${totalPlayers}, Max per team: ${maxTeamSize}, Scramble Percentage: ${scramblePercentage * 100}%`);
    const unassignedPseudoSquads = unassigned.map((p) => ({
      id: `Unassigned - ${p.steamID}`,
      teamID: p.teamID, // Their actual team (1 or 2)
      players: [p.steamID]
    }));
    const filterCandidates = (teamID) =>
      allSquads
        .filter((s) => s.teamID === teamID)
        .concat(unassignedPseudoSquads.filter((s) => s.teamID === teamID));

    const t1Candidates = filterCandidates('1');
    const t2Candidates = filterCandidates('2');

    if (debug) Logger.verbose('TeamBalancer', 4, `Candidate squads filtered: Team1 = ${t1Candidates.length}, Team2 = ${t2Candidates.length}`);

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
      
      const penaltyT1Overcap = Math.max(0, hypotheticalNewT1 - maxTeamSize) * 1000; // High penalty
      const penaltyT2Overcap = Math.max(0, hypotheticalNewT2 - maxTeamSize) * 1000; // High penalty
      
      const totalPlayers = initialT1Count + initialT2Count;
      const idealTeamSize = totalPlayers / 2;
      let sizeDeviationPenalty = 0;
      if (hypotheticalNewT1 < idealTeamSize - 5 || hypotheticalNewT2 < idealTeamSize - 5) {
        sizeDeviationPenalty += 50; // Moderate penalty for significant underpopulation
      }
      
      let combinedScore =
        churnScore * 10 + // Increased weight for hitting the churn target
        balanceScore * 5 + // Higher weight for final balance
        penaltyT1Overcap +
        penaltyT2Overcap +
        sizeDeviationPenalty;
      
      if (
        targetPlayersToMoveOverall > 10 &&
        actualPlayersMoved < targetPlayersToMoveOverall * 0.5
      ) {
        combinedScore += 100; // Significant penalty for not meeting at least half the churn target
      }

      return combinedScore;
    };

    const MAX_ATTEMPTS = 100; // Increased attempts to find a good solution
    let bestScore = Infinity;
    let bestT1SwapCandidates = null;
    let bestT2SwapCandidates = null;

    if (debug) Logger.verbose('TeamBalancer', 4, `Starting swap attempts (max ${MAX_ATTEMPTS})`);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const currentUsedSquadIds = new Set(); // Reset for each attempt
      
      shuffle(t1Candidates);
      shuffle(t2Candidates);
      
      let targetMoveFromT1 = Math.round(targetPlayersToMove / 2);
      let targetMoveFromT2 = Math.round(targetPlayersToMove / 2);
      
      targetMoveFromT1 = Math.max(0, targetMoveFromT1 + Math.floor(Math.random() * 5) - 2); // +/- 2 players
      targetMoveFromT2 = Math.max(0, targetMoveFromT2 + Math.floor(Math.random() * 5) - 2); // +/- 2 players
      
      targetMoveFromT1 = Math.min(
        targetMoveFromT1,
        t1Candidates.reduce((sum, s) => sum + s.players.length, 0)
      );
      targetMoveFromT2 = Math.min(
        targetMoveFromT2,
        t2Candidates.reduce((sum, s) => sum + s.players.length, 0)
      );
      
      const selT1 = selectTieredSquads(t1Candidates, targetMoveFromT1, currentUsedSquadIds);
      const selT2 = selectTieredSquads(t2Candidates, targetMoveFromT2, currentUsedSquadIds);

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
      if (debug) Logger.verbose('TeamBalancer', 4, `Team1 selected squads IDs: ${selT1.map((s) => s.id).join(', ')}`);
      if (debug) Logger.verbose('TeamBalancer', 4, `Team2 selected squads IDs: ${selT2.map((s) => s.id).join(', ')}`);

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
        if (debug) Logger.verbose('TeamBalancer', 4, `New best score found: ${bestScore.toFixed(2)} at attempt ${i + 1}`);        
        if (bestScore <= 5) {          
          if (debug) Logger.verbose('TeamBalancer', 4, `Very good score (${bestScore}) found. Breaking early from swap attempts.`);
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
    if (debug) Logger.verbose('TeamBalancer', 4, `Pre-swap team sizes: Team1 = ${preSwapCounts.team1Count}, Team2 = ${preSwapCounts.team2Count}`);
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
    if (debug) Logger.verbose('TeamBalancer', 4, `Post-initial-swap internal team sizes: Team1 = ${postInitialSwapCounts.team1Count}, Team2 = ${postInitialSwapCounts.team2Count}`);

    
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
          
          if (getCurrentTeamCounts().team2Count < maxTeamSize) {
            finalPlayerMovesMap.set(player.steamID, { steamID: player.steamID, targetTeamID: '2' });
            updatePlayerTeam(player.steamID, '2');
            Logger.verbose('TeamBalancer', 3, `Trimming: Player ${player.steamID} from Team 1 to Team 2 (overcap fix)`);
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
          
          if (getCurrentTeamCounts().team1Count < maxTeamSize) {
            finalPlayerMovesMap.set(player.steamID, { steamID: player.steamID, targetTeamID: '1' });
            updatePlayerTeam(player.steamID, '1');
            Logger.verbose('TeamBalancer', 3, `Trimming: Player ${player.steamID} from Team 2 to Team 1 (overcap fix)`);
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
    if (debug) Logger.verbose('TeamBalancer', 4, `Final internal team sizes after all adjustments: Team1 = ${finalInternalCounts.team1Count}, Team2 = ${finalInternalCounts.team2Count}, Unassigned (no squad) = ${finalInternalCounts.unassignedCount}`);

    
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