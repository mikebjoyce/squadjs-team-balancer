/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║             SQUAD-PRESERVING TEAM SCRAMBLE ALGORITHM          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * This algorithm rebalances teams by swapping whole squads and unassigned 
 * players. It utilizes a Dynamic Tiered Escalation system to ensure numerical 
 * parity while protecting friend-group cohesion and team identity.
 *
 * THE PROCESS INVOLVES:
 *
 * 1. DATA PREPARATION: Normalizes snapshots. Unassigned players are 
 * treated as individual "pseudo-squads" for maximum movement flexibility.
 *
 * 2. TARGET CALCULATION: Establishes movement goals based on the 
 * scramblePercentage and current team population deltas.
 *
 * 3. EXHAUSTIVE OPTIMIZATION (200 ATTEMPTS):
 *    - Phase 1 (Pure Swaps): 0-50% of attempts focus on whole-squad moves.
 *    - Phase 2 (Surgical Unlocked): 50-100% of attempts allow shattering
 *    ONE random unlocked squad to solve precision balance issues.
 *    Locked squads are never split under any circumstances.
 *
 * 4. SCORING & PENALTIES:
 *    - balanceScore: Exponential penalty for team differentials > 2.
 *    - eloBalancePenalty (0-480 pts): Global mean TrueSkill diff, capped below locked squad protection.
 *    - veteranPenalty: Penalizes imbalanced regular player counts between teams.
 * 
 * 5. CAP ENFORCEMENT: A final corrective pass ensures no team exceeds 
 * server limits, trimming overages in the order: 
 * Unassigned -> Unlocked Players -> Locked Players.
 *
 * VALIDATION:
 * This algorithm is stress-tested via 'utils/scrambler-test-runner.js'. 
 * Baseline performance: ~1.5ms per exhaustive search at 100% success.
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
    eloMap = null
  }) {
    const startTime = Date.now();
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

    const playerEloMap = new Map();
    const playerRoundsMap = new Map();
    if (eloMap) {
      for (const [eosID, rating] of eloMap.entries()) {
        playerEloMap.set(eosID, rating.mu);
        playerRoundsMap.set(eosID, rating.roundsPlayed ?? 0);
      }
    }
    const defaultMu = 25.0; // fallback for unrated players
    const REGULAR_MIN_ROUNDS = 10;

    const workingSquads = squads.map((s) => ({
      ...s,
      teamID: String(s.teamID),
      players: [...s.players]
    }));

    const updatePlayerTeam = (eosID, newTeamID) => {
      const player = workingPlayers.find((p) => p.eosID === eosID);
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
      id: `Unassigned - ${p.eosID}`,
      teamID: p.teamID, // Their actual team (1 or 2)
      players: [p.eosID]
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
        
        const lenA = a.players.length + (Math.random() * 20 - 10);
        const lenB = b.players.length + (Math.random() * 20 - 10);
        return lenB - lenA;
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
      
      const diff = Math.abs(hypotheticalNewT1 - hypotheticalNewT2);
      // 0-1 diff = 0 penalty
      // 2 diff   = 40 penalty (Small enough that ELO/Vet improvements easily override it)
      // 3+ diff  = Exponential (3=400, 4=900, etc.)
      const balanceScore = diff <= 1 ? 0 : Math.pow(diff + 1, 2) * 100;
      
      const penaltyT1Overcap = Math.max(0, hypotheticalNewT1 - maxTeamSize) * 10000; // Increased penalty
      const penaltyT2Overcap = Math.max(0, hypotheticalNewT2 - maxTeamSize) * 10000; // Increased penalty
      
      const totalPlayers = initialT1Count + initialT2Count;
      const idealTeamSize = totalPlayers / 2;
      let sizeDeviationPenalty = 0;
      if (hypotheticalNewT1 < idealTeamSize - 5 || hypotheticalNewT2 < idealTeamSize - 5) {
        sizeDeviationPenalty += 50; // Moderate penalty for significant underpopulation
      }

      // --- ELO BALANCE PENALTY ---
      let eloBalancePenalty = 0;
      if (playerEloMap.size > 0) {
        const movingToT2 = new Set(selectedT1Squads.flatMap(s => s.players));
        const movingToT1 = new Set(selectedT2Squads.flatMap(s => s.players));

        const getElo = (id) => playerEloMap.get(id) ?? defaultMu;

        const t1Elos = workingPlayers
          .filter(p => p.teamID === '1' && !movingToT2.has(p.eosID))
          .map(p => getElo(p.eosID))
          .concat([...movingToT1].map(getElo));

        const t2Elos = workingPlayers
          .filter(p => p.teamID === '2' && !movingToT1.has(p.eosID))
          .map(p => getElo(p.eosID))
          .concat([...movingToT2].map(getElo));

        const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : defaultMu;
        const globalDiff = Math.abs(avg(t1Elos) - avg(t2Elos));
        eloBalancePenalty = Math.min(globalDiff * 50, 480);
      }

      // --- VETERAN PARITY PENALTY ---
      const countRegs = (teamID, movingOut, movingIn) => {
        const staying = workingPlayers
          .filter(p => p.teamID === teamID && !movingOut.has(p.eosID))
          .filter(p => (playerRoundsMap.get(p.eosID) ?? 0) >= REGULAR_MIN_ROUNDS).length;
        const arriving = [...movingIn]
          .filter(id => (playerRoundsMap.get(id) ?? 0) >= REGULAR_MIN_ROUNDS).length;
        return staying + arriving;
      };
      let veteranPenalty = 0;
      if (playerRoundsMap.size > 0) {
        const movingToT2 = new Set(selectedT1Squads.flatMap(s => s.players));
        const movingToT1 = new Set(selectedT2Squads.flatMap(s => s.players));
        const reg1 = countRegs('1', movingToT2, movingToT1);
        const reg2 = countRegs('2', movingToT1, movingToT2);
        const vet1 = hypotheticalNewT1 > 0 ? reg1 / hypotheticalNewT1 : 0;
        const vet2 = hypotheticalNewT2 > 0 ? reg2 / hypotheticalNewT2 : 0;
        veteranPenalty = Math.abs(vet1 - vet2) * 300;
      }

      let combinedScore =
        balanceScore + // Massive weight for numerical parity
        penaltyT1Overcap +
        penaltyT2Overcap + 
        sizeDeviationPenalty +
        eloBalancePenalty + 
        veteranPenalty;
      
      return combinedScore;
    };

    const MAX_ATTEMPTS = 500;
    const SURGICAL_START = Math.floor(MAX_ATTEMPTS * 0.5);    
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

      // Surgical Squad Splitting (unlocked squads only)
      if (i >= SURGICAL_START && bestScore > 10) {
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

      const currentUsedSquadIds = new Set(); // Reset for each attempt
      
      shuffle(localT1);
      shuffle(localT2);
      
      const teamDiff = initialCounts.team1Count - initialCounts.team2Count;
      
      // Randomize the base swap size from 0 up to targetPlayersToMove/2
      const maxBaseSwap = Math.floor(targetPlayersToMove / 2);
      const baseSwapSize = Math.floor(Math.random() * (maxBaseSwap + 1));
      
      let targetMoveFromT1 = Math.round(baseSwapSize + (teamDiff / 4));
      let targetMoveFromT2 = Math.round(baseSwapSize - (teamDiff / 4));
      
      targetMoveFromT1 = Math.max(0, targetMoveFromT1 + Math.floor(Math.random() * 3) - 1); // +/- 1 player
      targetMoveFromT2 = Math.max(0, targetMoveFromT2 + Math.floor(Math.random() * 3) - 1); // +/- 1 player
      
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
        `Attempt ${i + 1}: Score = ${currentScore.toFixed(2)}, Move T1->T2 = ${selT1.reduce((n, s) => n + s.players.length, 0)}, Move T2->T1 = ${selT2.reduce((n, s) => n + s.players.length, 0)}, Hypo T1 = ${initialCounts.team1Count - selT1.reduce((n, s) => n + s.players.length, 0) + selT2.reduce((n, s) => n + s.players.length, 0)}, Hypo T2 = ${initialCounts.team2Count - selT2.reduce((n, s) => n + s.players.length, 0) + selT1.reduce((n, s) => n + s.players.length, 0)} | Churn: ${selT1.reduce((n, s) => n + s.players.length, 0) + selT2.reduce((n, s) => n + s.players.length, 0)}/${targetPlayersToMove}`
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
      }
    }

    if (!bestT1SwapCandidates || !bestT2SwapCandidates) {
      Logger.verbose('TeamBalancer', 2, 'No valid swap solution found within attempt limit.');
      const res = [];
      res.calculationTime = Date.now() - startTime;
      return res; // Return empty array if no solution found
    }
    
    const finalT1Ids = new Set(bestT1SwapCandidates.map((s) => s.id));
    const finalT2Ids = new Set(bestT2SwapCandidates.map((s) => s.id));
    const finalIntersection = [...finalT1Ids].filter((id) => finalT2Ids.has(id));

    if (finalIntersection.length > 0) {
      Logger.verbose('TeamBalancer', 1, `CRITICAL ERROR: Final solution has duplicate squads: ${finalIntersection.join(', ')}`);
      Logger.verbose('TeamBalancer', 1, 'Aborting scramble to prevent team count corruption.');
      const res = [];
      res.calculationTime = Date.now() - startTime;
      return res; // Return empty array if critical error
    }

    const preSwapCounts = getCurrentTeamCounts();
    Logger.verbose('TeamBalancer', 4, `Pre-swap team sizes: Team1 = ${preSwapCounts.team1Count}, Team2 = ${preSwapCounts.team2Count}`);
    const finalPlayerMovesMap = new Map();

    for (const squad of bestT1SwapCandidates) {
      for (const eosID of squad.players) {
        finalPlayerMovesMap.set(eosID, { eosID, targetTeamID: '2' });
        updatePlayerTeam(eosID, '2'); // Update internal working copy
      }
    }

    
    for (const squad of bestT2SwapCandidates) {
      for (const eosID of squad.players) {
        finalPlayerMovesMap.set(eosID, { eosID, targetTeamID: '1' });
        updatePlayerTeam(eosID, '1'); // Update internal working copy
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

      
      const eligiblePlayers = playersOnTeam.filter((p) => !existingMovesMap.has(p.eosID));

      const unassignedPlayers = eligiblePlayers.filter((p) => p.squadID === null);

      const playersInSquads = eligiblePlayers.filter((p) => p.squadID !== null);

      
      const playersWithSquadStatus = playersInSquads.map((p) => {
        const squad = currentWorkingSquads.find((s) => s.players.includes(p.eosID));
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
          if (player.isLocked) continue;
          if (getCurrentTeamCounts().team1Count > getCurrentTeamCounts().team2Count + 1) {
            finalPlayerMovesMap.set(player.eosID, { eosID: player.eosID, targetTeamID: '2' });
            updatePlayerTeam(player.eosID, '2');
            Logger.verbose('TeamBalancer', 4, `Trimming: Player ${player.eosID} from Team 1 to Team 2 (overcap fix)`);
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
          if (player.isLocked) continue;
          if (getCurrentTeamCounts().team2Count > getCurrentTeamCounts().team1Count + 1) {
            finalPlayerMovesMap.set(player.eosID, { eosID: player.eosID, targetTeamID: '1' });
            updatePlayerTeam(player.eosID, '1');
            Logger.verbose('TeamBalancer', 4, `Trimming: Player ${player.eosID} from Team 2 to Team 1 (overcap fix)`);
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

    const duration = Date.now() - startTime;
    Logger.verbose('TeamBalancer', 2, `========== Scramble Plan Generated (${duration}ms) ==========`);
    Logger.verbose('TeamBalancer', 2, `Total player moves in plan: ${finalPlayerMovesMap.size}`);
    Logger.verbose('TeamBalancer', 2, `Final desired balance: Team1 = ${finalInternalCounts.team1Count}, Team2 = ${finalInternalCounts.team2Count}`);
    Logger.verbose('TeamBalancer', 2, `Unassigned players in plan: ${finalInternalCounts.unassignedCount}`);

    const result = Array.from(finalPlayerMovesMap.values());
    result.calculationTime = duration;
    return result; // Return the plan to the TeamBalancer
  }
};

export default Scrambler;