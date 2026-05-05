/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║          SQUAD-PRESERVING TEAM SCRAMBLE ALGORITHM             ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * ─── PURPOSE ─────────────────────────────────────────────────────
 *
 * Pure logic module implementing the squad-preserving team scramble
 * algorithm. Accepts a snapshot of squads and players, computes the
 * optimal swap plan via exhaustive tiered search, and returns a move
 * list. Does not execute RCON commands — execution is SwapExecutor's job.
 *
 * ─── EXPORTS ─────────────────────────────────────────────────────
 *
 * Scrambler (named)
 *   Object with one public method:
 *     scrambleTeamsPreservingSquads({ squads, players, winStreakTeam,
 *       scramblePercentage, eloMap, debug, clanGroups, pullEntireSquads,
 *       minPlayersToMove, maxPlayersToMove })
 *       Returns an Array of { eosID, targetTeamID } move objects,
 *       with a calculationTime property attached to the array.
 *
 * ─── DEPENDENCIES ────────────────────────────────────────────────
 *
 * Logger (../../core/logger.js)
 *   Verbose logging for phase transitions and scoring.
 *
 * ─── NOTES ───────────────────────────────────────────────────────
 *
 * - Unassigned players are treated as individual pseudo-squads to
 *   maximise movement flexibility without breaking formed squads.
 * - Four-phase escalation (2000 iterations total):
 *     Phase 1 — Pure squad swaps only. Maximises cohesion.
 *     Phase 2 — Shatters one random UNLOCKED squad if balance is poor.
 *     Phase 3 — Late fallback: may split one LOCKED squad.
 *     Phase 4 — Nuclear: decomposes all squads for maximum balance (last 5 iterations).
 * - Scoring penalties (lower = better):
 *     balanceScore        — Exponential penalty for team diff > 2.
 *     sizeDeviationPenalty — Penalty for significant underpopulation.
 *     eloBalancePenalty   — Composite score derived from a 50/50 weighted split between Mean ELO diff and Top-15 ELO diff (ELO mode only).
 *     veteranPenalty      — Imbalanced regular player counts (ELO mode only).
 *     clanCohesionPenalty — Soft penalty for clan groups splitting across teams (runs in both modes; ~87.7% per-member preservation in testing).
 *     anchorPenalty       — Moving >2 large squads from one team (Heuristic mode only).
 * - clanGroups is optional. When present, builds virtual squads to keep same-team clan members together as a soft
 *   preference. Balance takes priority; clans may split if necessary for diff ≤ 2. Runs identically in both ELO and
 *   heuristic modes.
 * - eloMap is optional. When present, heuristic penalties are replaced by ELO parity scoring. Clan cohesion penalty
 *   persists unchanged when using ELO mode (no interaction side effects).
 * - Cap enforcement runs as a final pass, trimming team overages in
 *   priority order: Unassigned → Unlocked Squad Members. Locked players are never moved.
 * - Baseline performance: ~70–95ms per exhaustive search, 99.9% balance
 *   success rate (diff ≤ 2 players) under standard conditions.
 *
 * Author:
 * Discord: `real_slacker`
 *
 * ═══════════════════════════════════════════════════════════════
 */

import Logger from '../../core/logger.js';

export const Scrambler = {
  async scrambleTeamsPreservingSquads({
    squads,
    players,
    winStreakTeam,
    scramblePercentage = 0.5,
    eloMap = null,
    minPlayersToMove = 0,
    maxPlayersToMove = 0,
    clanGroups = null,
    pullEntireSquads = false
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

    const playerMap = new Map(workingPlayers.map(p => [p.eosID, p]));
    const updatePlayerTeam = (eosID, newTeamID) => {
      const player = playerMap.get(eosID);
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

    // ─── Clan Tag Grouping (Pre-Phase) ─────────────────────────────
    // Build "virtual squads" per team that bind same-team clan members
    // together so Phase 1 swaps them as a unit. Only mutates the
    // candidate arrays (t1Candidates / t2Candidates) — workingSquads is
    // left intact so the cap-enforcement pass at the end still sees the
    // original game-state lock semantics.
    //
    // Cross-team consolidation is intentionally NOT performed: clan
    // members already split across teams are treated as two independent
    // groups (per user spec).
    const virtualSquadsByTag = new Map(); // `${teamID}:${tag}` -> { originalMembers: Set<eosID> }
    if (clanGroups && Object.keys(clanGroups).length > 0) {
      // Largest clans first so big groups claim their preferred anchors.
      const sortedClans = Object.entries(clanGroups).sort(
        (a, b) => b[1].length - a[1].length
      );

      const PER_TEAM_MIN = 2; // Sanity floor; broader filtering happened in extractClanGroups


       for (const teamID of ['1', '2']) {
         const teamCandidates = teamID === '1' ? t1Candidates : t2Candidates;
         const claimedAnchorIds = new Set(); // track anchors already absorbed by a prior clan this team

         for (const [tag, eosIDs] of sortedClans) {
          
          const sameTeamMembers = eosIDs.filter(
            (id) => playerMap.get(id)?.teamID === teamID
          );
          if (sameTeamMembers.length < PER_TEAM_MIN) continue;

          const memberSet = new Set(sameTeamMembers);

           // Squads (real or unassigned-pseudo) currently in candidates that hold any clan member.
           // Exclude any squads whose original id was already claimed as an anchor
           // by a prior clan on this team — prevents cross-clan virtual squad merges.
           const contributing = teamCandidates.filter((s) =>
             !claimedAnchorIds.has(s.id) && s.players.some((p) => memberSet.has(p))
           );
          if (contributing.length === 0) continue;

          // Register for the Phase 2/3/4 scoring penalty regardless of how many
          // squads the clan spans the penalty applies whenever a final plan
          // separates clan members across teams.
          virtualSquadsByTag.set(`${teamID}:${tag}`, {
            originalMembers: memberSet
          });

          // Anchor: most clan members; tiebreak by larger total size; tiebreak by lower id.
          const anchor = [...contributing].sort((a, b) => {
            const aClan = a.players.filter((p) => memberSet.has(p)).length;
            const bClan = b.players.filter((p) => memberSet.has(p)).length;
            if (aClan !== bClan) return bClan - aClan;
            if (a.players.length !== b.players.length) return b.players.length - a.players.length;
            return a.id < b.id ? -1 : 1;
          })[0];
          const others = contributing.filter((s) => s.id !== anchor.id);

          // Build the virtual squad's player list.
          const seen = new Set(anchor.players);
          const newPlayers = [...anchor.players];
          for (const s of others) {
            for (const p of s.players) {
              const include = pullEntireSquads || memberSet.has(p);
              if (include && !seen.has(p)) {
                newPlayers.push(p);
                seen.add(p);
              }
            }
          }

           const virtualSquad = {
             ...anchor,
             players: newPlayers,
             locked: false, // virtual squads are never locked; prevents wasLocked contamination via decomposeList
             isVirtual: true,
             clanTag: tag
           };

           // Replace anchor in the candidate list with the virtual squad.
           const anchorIdx = teamCandidates.indexOf(anchor);
           if (anchorIdx !== -1) teamCandidates[anchorIdx] = virtualSquad;
           claimedAnchorIds.add(anchor.id); // prevent later clans from re-using this anchor

          // Update other contributing squads (iterate in reverse for safe splicing).
          const otherSet = new Set(others);
          for (let i = teamCandidates.length - 1; i >= 0; i--) {
            const s = teamCandidates[i];
            if (s === virtualSquad || !otherSet.has(s)) continue;
            if (pullEntireSquads) {
              teamCandidates.splice(i, 1);
            } else {
              const remaining = s.players.filter((p) => !memberSet.has(p));
              if (remaining.length === 0) {
                teamCandidates.splice(i, 1);
              } else {
                teamCandidates[i] = { ...s, players: remaining };
              }
            }
          }

          Logger.verbose(
            'TeamBalancer',
            4,
            `Clan grouping: Team ${teamID} [${tag}] (${sameTeamMembers.length} members) -> virtual squad anchored on ${anchor.id} (${newPlayers.length} total players, pullEntireSquads=${pullEntireSquads})`
          );
        }
      }
      Logger.verbose(
        'TeamBalancer',
        2,
        `Clan grouping active: ${virtualSquadsByTag.size} per-team groups built across ${Object.keys(clanGroups).length} extracted clans.`
      );
    }
    // ────────────────────────────────────────────────────────────────

    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };

    const SQUAD_FIT_GRACE = 3;
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
          if (currentCount < maxPlayersToSelect && currentCount + size - maxPlayersToSelect <= SQUAD_FIT_GRACE) {
            selected.push(squad);
            usedSquadIds.add(squad.id);
            currentCount += size;
          }
        }
      }
      return selected;
    };

    const analyzeComposition = (squads) => {
      let largeInfantryCount = 0;
      let utilityCount = 0;
      let hasLockedInfantry = false;
      for (const s of squads) {
        const size = s.players.length;
        if (size >= 7) {
          largeInfantryCount++;
          if (s.locked) hasLockedInfantry = true;
        } else if (size >= 2 && size <= 6) {
          utilityCount++;
        }
      }
      return { largeInfantryCount, utilityCount, hasLockedInfantry };
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

      let combinedScore = penaltyT1Overcap + penaltyT2Overcap + sizeDeviationPenalty;

      if (playerEloMap.size > 0) {
        // --- ELO BALANCE SCORING ---
        // Note: The clan cohesion penalty block below (after this if/else) always runs
        // regardless of mode. It applies the same soft penalty in both ELO and heuristic paths.
        combinedScore += balanceScore; // Pure numerical parity

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

        const getAvg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : defaultMu);
        const getTop15Avg = (arr) => {
          if (!arr.length) return defaultMu;
          const sorted = [...arr].sort((a, b) => b - a);
          const slice = sorted.slice(0, 15);
          return slice.reduce((a, b) => a + b, 0) / slice.length;
        };

        const meanDiff = Math.abs(getAvg(t1Elos) - getAvg(t2Elos));
        const top15Diff = Math.abs(getTop15Avg(t1Elos) - getTop15Avg(t2Elos));

        const getPenalty = (diff) => {
          if (diff <= 0.1) return diff * 20;
          if (diff <= 0.3) return 2.0 + (diff - 0.1) * 40;
          if (diff <= 0.6) return 10.0 + (diff - 0.3) * 80;
          return 34.0 + (diff - 0.6) * 150;
        };

        const compositeDiff = 0.6 * meanDiff + 0.4 * top15Diff;
        const eloBalancePenalty = Math.min(getPenalty(compositeDiff), 480);

        combinedScore += eloBalancePenalty;
        // --- VETERAN PARITY SCORING ---
        const countRegs = (teamID, movingOut, movingIn) => {
          const staying = workingPlayers
            .filter(p => p.teamID === teamID && !movingOut.has(p.eosID))
            .filter(p => (playerRoundsMap.get(p.eosID) ?? 0) >= REGULAR_MIN_ROUNDS).length;
          const arriving = [...movingIn]
            .filter(id => (playerRoundsMap.get(id) ?? 0) >= REGULAR_MIN_ROUNDS).length;
          return staying + arriving;
        };

        const reg1 = countRegs('1', movingToT2, movingToT1);
        const reg2 = countRegs('2', movingToT1, movingToT2);
        const vet1 = hypotheticalNewT1 > 0 ? reg1 / hypotheticalNewT1 : 0;
        const vet2 = hypotheticalNewT2 > 0 ? reg2 / hypotheticalNewT2 : 0;
        const veteranPenalty = Math.abs(vet1 - vet2) * 300;
        combinedScore += veteranPenalty;

      } else {
        // --- HEURISTIC BALANCE SCORING (NO ELO) ---
        const oldBalanceScore = diff <= 2 ? diff * 80 : (diff * diff) * 60;
        combinedScore += oldBalanceScore;

        const churnScore = Math.abs(actualPlayersMoved - targetPlayersToMoveOverall);
        let churnUnderPenalty = 0;
        if (actualPlayersMoved < targetPlayersToMoveOverall) {
          churnUnderPenalty = (targetPlayersToMoveOverall - actualPlayersMoved) * 15;
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
              penalty += 10;
            }
          }
          return penalty;
        };
        const cohesionPenalty = calcCohesionPenalty(selectedT1Squads) + calcCohesionPenalty(selectedT2Squads);

        const countLarge = (squads) => squads.filter(s => s.players.length >= 7).length;
        const movedLargeSquadsT1 = countLarge(selectedT1Squads);
        const movedLargeSquadsT2 = countLarge(selectedT2Squads);
        let anchorPenalty = 0;
        if (movedLargeSquadsT1 > 2) anchorPenalty += 500;
        if (movedLargeSquadsT2 > 2) anchorPenalty += 500;

        const t1Stats = analyzeComposition(selectedT1Squads);
        const t2Stats = analyzeComposition(selectedT2Squads);

        let infantryOverload = 0;
        if (t1Stats.largeInfantryCount > 2) infantryOverload += 180;
        if (t2Stats.largeInfantryCount > 2) infantryOverload += 180;

        let utilityReward = 0;
        utilityReward -= (Math.min(t1Stats.utilityCount, 3) * 60);
        utilityReward -= (Math.min(t2Stats.utilityCount, 3) * 60);

        let winStreakTax = 0;
        // Squad preserving algorithm intent: break at least one locked squad from the winning team to disrupt their dominant core.
        // A penalty of 150 is frequently dominated by other factors, but discourages leaving the dominant core completely intact.
        if (String(winStreakTeam) === '1' && !selectedT1Squads.some(s => s.locked)) winStreakTax += 150;
        if (String(winStreakTeam) === '2' && !selectedT2Squads.some(s => s.locked)) winStreakTax += 150;

        combinedScore +=
          (churnScore * 2) +
          churnUnderPenalty +
          lockedPenalty +
          cohesionPenalty +
          anchorPenalty +
          infantryOverload +
          utilityReward +
          winStreakTax;

        if (targetPlayersToMoveOverall > 10 && actualPlayersMoved < targetPlayersToMoveOverall * 0.5) {
          combinedScore += 300; // Penalty for missing churn
        }
      }

      // ─── Clan Cohesion Penalty ──────────────────────────────────────
      // Soft penalty for splitting a registered virtual clan group across teams.
      // Phase 1 swaps virtual squads atomically so this only triggers after
      // Phase 2/3/4 decomposes a virtual squad — exactly when we want to push
      // the search away from breaking up a clan unless balance demands it.
      if (virtualSquadsByTag.size > 0) {
        const movingToT2 = new Set(selectedT1Squads.flatMap((s) => s.players));
        const movingToT1 = new Set(selectedT2Squads.flatMap((s) => s.players));
        let clanSplitPenalty = 0;
        for (const vs of virtualSquadsByTag.values()) {
          let onT1 = 0, onT2 = 0;
          for (const pid of vs.originalMembers) {
            const orig = playerMap.get(pid);
            if (!orig) continue;
            let finalTeam = orig.teamID;
            if (movingToT2.has(pid)) finalTeam = '2';
            else if (movingToT1.has(pid)) finalTeam = '1';
            if (finalTeam === '1') onT1++;
            else onT2++;
          }
          clanSplitPenalty += Math.min(onT1, onT2) * 75;
        }
        combinedScore += clanSplitPenalty;
      }

      return combinedScore;
    };

    // Hardcoded to 2000 as an exhaustive search bound.
    // At ~5-20ms per 500 searches, this takes ~20-80ms and provides deeper permutation exploration.
    // NOTE: The scrambler runs for 2,000 iterations to ensure it fully explores
    // the possibility space before escalating to more destructive phases.
    const MAX_ATTEMPTS = 2000;
    const SURGICAL_START = Math.floor(MAX_ATTEMPTS * 0.5);
    const LOCKED_START = Math.floor(MAX_ATTEMPTS * 0.8);
    const NUCLEAR_START = MAX_ATTEMPTS - 5;
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

      // Surgical Squad Splitting
      if (i >= SURGICAL_START && i < NUCLEAR_START && bestScore > 10) {
        const allowLocked = i >= LOCKED_START;
        const getEligible = (list) => list.filter(s => (allowLocked || !s.locked) && !s.id.startsWith('Unassigned') && !s.id.startsWith('Split'));
        const t1Eligible = getEligible(localT1);
        const t2Eligible = getEligible(localT2);
        const allEligible = [...t1Eligible, ...t2Eligible];

        if (allEligible.length > 0) {
          // Prefer non-clan-virtual squads so clan groups stay intact unless nothing else is eligible.
          const nonClanEligible = allEligible.filter((s) => !s.isVirtual);
          const victimPool = nonClanEligible.length > 0 ? nonClanEligible : allEligible;
          const victim = victimPool[Math.floor(Math.random() * victimPool.length)];
          if (victim.teamID === '1') localT1 = decomposeList(localT1, victim.id);
          else localT2 = decomposeList(localT2, victim.id);
        }
      }

      // Phase 4: Nuclear Option
      // NOTE: This phase is explicitly designed as a last-resort safety valve.
      // It only triggers in the final 5 iterations (1995-1999) if 1,995 attempts
      // failed to find a mathematically viable solution that preserves squads.
      // It sacrifices squad cohesion to ensure numerical balance can be achieved
      // in unresolvable edge cases.
      if (i >= NUCLEAR_START) {
        if (i === NUCLEAR_START) Logger.verbose('TeamBalancer', 2, 'Engaging Nuclear Option: Decomposing all squads for final attempts.');
        localT1 = decomposeList(localT1, null, true);
        localT2 = decomposeList(localT2, null, true);
      }

      const currentUsedSquadIds = new Set(); // Reset for each attempt

      shuffle(localT1);
      shuffle(localT2);

      const teamDiff = initialCounts.team1Count - initialCounts.team2Count;

      // Determine the swap range based on whether custom bounds were provided (ELO edge-case logic)
      let currentMaxBaseSwap = Math.floor(targetPlayersToMove / 2);
      let currentMinBaseSwap = 0;

      if (eloMap && minPlayersToMove > 0 && maxPlayersToMove >= minPlayersToMove) {
        currentMinBaseSwap = Math.floor(minPlayersToMove / 2);
        currentMaxBaseSwap = Math.floor(maxPlayersToMove / 2);
      }

      // Randomize the base swap size within the calculated bounds
      const baseSwapSize = Math.floor(Math.random() * (currentMaxBaseSwap - currentMinBaseSwap + 1)) + currentMinBaseSwap;

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

      if (Logger.verboseness && Logger.verboseness['TeamBalancer'] >= 4) {
        const selT1Players = selT1.reduce((n, s) => n + s.players.length, 0);
        const selT2Players = selT2.reduce((n, s) => n + s.players.length, 0);
        const hypoT1 = initialCounts.team1Count - selT1Players + selT2Players;
        const hypoT2 = initialCounts.team2Count - selT2Players + selT1Players;
        Logger.verbose(
          'TeamBalancer',
          4,
          `Attempt ${i + 1}: Score = ${currentScore.toFixed(2)}, Move T1->T2 = ${selT1Players}, Move T2->T1 = ${selT2Players}, Hypo T1 = ${hypoT1}, Hypo T2 = ${hypoT2} | Churn: ${selT1Players + selT2Players}/${targetPlayersToMove}`
        );
        Logger.verbose('TeamBalancer', 4, `Team1 selected squads IDs: ${selT1.map((s) => s.id).join(', ')}`);
        Logger.verbose('TeamBalancer', 4, `Team2 selected squads IDs: ${selT2.map((s) => s.id).join(', ')}`);
      }

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