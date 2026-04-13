/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║           SCRAMBLER REAL DATA TEST SUITE                      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 * 
 * Evaluates the Scrambler's performance using real ELO distribution
 * data, evaluating numerical balance, Mean ELO parity, and Top-15
 * ELO parity over 2000 iteration search spaces.
 */

import { readFileSync } from 'fs';
import { Scrambler } from '../utils/tb-scrambler.js';

// ─── Args ────────────────────────────────────────────────────────
const ELO_DB    = process.argv[2];
const MATCH_LOG = process.argv[3] ?? null;

if (!ELO_DB) {
  console.error('Usage: node historical-scramble-test.js <elodb.json> [merged.jsonl]');
  process.exit(1);
}

// ─── Load ELO DB ─────────────────────────────────────────────────
const eloContent = readFileSync(ELO_DB, 'utf8').trim();
let dbRaw;
try {
  dbRaw = JSON.parse(eloContent);
} catch (err) {
  dbRaw = eloContent.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}
const allPlayers = (dbRaw.players ?? dbRaw);
console.log(`DB loaded: ${allPlayers.length} players`);

// ─── Load Match Log for Ratios ───────────────────────────────────
let matchLog = [];
if (MATCH_LOG) {
  const content = readFileSync(MATCH_LOG, 'utf8');
  matchLog = content.split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

const avgRatios = matchLog.map(m => {
  const t1Count = m.players.filter(p => p.teamID == 1).length;
  return t1Count / m.players.length;
}).filter(r => !isNaN(r));

console.log(`Match log loaded: ${avgRatios.length} eligible matches for ratio sampling`);

// ─── Helpers ─────────────────────────────────────────────────────

function getStats(players, eloMap) {
  const t1 = players.filter(p => p.teamID == '1' || p.teamID == 1);
  const t2 = players.filter(p => p.teamID == '2' || p.teamID == 2);

  const getAvgMu = (list) => {
    if (list.length === 0) return 25.0;
    const sum = list.reduce((acc, p) => acc + (eloMap.get(p.eosID)?.mu || 25), 0);
    return sum / list.length;
  };

  const getTop15Mu = (list) => {
    if (list.length === 0) return 25.0;
    const sorted = [...list].map(p => eloMap.get(p.eosID)?.mu || 25).sort((a, b) => b - a);
    const slice = sorted.slice(0, 15);
    const sum = slice.reduce((acc, val) => acc + val, 0);
    return sum / slice.length;
  };

  const getVetRatio = (list) => {
    if (list.length === 0) return 0;
    const vets = list.filter(p => (eloMap.get(p.eosID)?.roundsPlayed || 0) >= 50);
    return vets.length / list.length;
  };

  const mu1 = getAvgMu(t1);
  const mu2 = getAvgMu(t2);
  const top15Mu1 = getTop15Mu(t1);
  const top15Mu2 = getTop15Mu(t2);
  const v1  = getVetRatio(t1);
  const v2  = getVetRatio(t2);

  return {
    t1Count: t1.length,
    t2Count: t2.length,
    numDiff: Math.abs(t1.length - t2.length),
    mu1,
    mu2,
    muDiff: Math.abs(mu1 - mu2),
    top15Diff: Math.abs(top15Mu1 - top15Mu2),
    vet1: v1,
    vet2: v2,
    vetDiff: Math.abs(v1 - v2)
  };
}

function groupBySquad(players) {
  const squads = {};
  players.forEach(p => {
    const sId = p.squadID || 'unassigned';
    if (!squads[sId]) {
      squads[sId] = { 
        squadID: p.squadID, 
        id: p.squadID ? `T${p.teamID}-S${p.squadID}` : `Unassigned-${p.eosID}`, // Required by Scrambler
        players: [],
        locked: false // Default
      };
    }
    squads[sId].players.push(p.eosID);
    // If any player in the squad is locked, the whole squad is locked
    if (p.squadLocked) squads[sId].locked = true; 
  });
  return Object.values(squads);
}

function checkLockedSquads(beforeT1, beforeT2, finalPlayers) {
  const originalPlayers = [...beforeT1, ...beforeT2];
  const lockedSquads = new Set(originalPlayers.filter(p => p.squadLocked).map(p => `${p.teamID}-${p.squadID}`));
  
  for (const sKey of lockedSquads) {
    const [origTeam, sId] = sKey.split('-');
    const members = originalPlayers.filter(p => p.teamID == origTeam && p.squadID == sId);
    const finalTeams = new Set(members.map(m => finalPlayers.find(fp => fp.eosID === m.eosID)?.teamID));
    if (finalTeams.size > 1) return false;
  }
  return true;
}

// ─── Session Builders ────────────────────────────────────────────

const regulars    = allPlayers.filter(p => p.roundsPlayed >= 50);
const provisional = allPlayers.filter(p => p.roundsPlayed < 50 && p.roundsPlayed > 0);
const visitors    = allPlayers.filter(p => p.roundsPlayed === 0);

console.log(`\nPlayer pools — Regulars: ${regulars.length} | Provisional: ${7337} | Visitors: ${visitors.length}`);
const muRange = regulars.length > 0 ? {
  min: Math.min(...regulars.map(p => p.mu)).toFixed(1),
  max: Math.max(...regulars.map(p => p.mu)).toFixed(1)
} : { min: 'NaN', max: 'NaN' };
console.log(`Mu range: ${muRange.min} – ${muRange.max}\n`);

function buildSession(count, regRatio = 0.3, unassignedCount = null, squadProfile = 'normal') {
  const session = [];
  const regCount = Math.floor(count * regRatio);
  const provCount = count - regCount;

  const shuffledRegs = [...regulars].sort(() => 0.5 - Math.random());
  const shuffledProv = [...provisional].sort(() => 0.5 - Math.random());

  session.push(...shuffledRegs.slice(0, regCount));
  session.push(...shuffledProv.slice(0, provCount));

  let squadCounterT1 = 1;
  let squadCounterT2 = 1;
  let i = 0;
  const structured = [];

  while (i < session.length) {
    let size;
    if (squadProfile === 'high') {
      size = Math.floor(Math.random() * 3) + 2; // Sizes 2-4 -> Average ~3 -> ~16 squads/team
    } else if (squadProfile === 'low') {
      size = Math.floor(Math.random() * 3) + 7; // Sizes 7-9 -> Average ~8 -> ~6 squads/team
    } else if (squadProfile === 'indivisible') {
      size = 9; // Exactly 9 players
    } else {
      size = Math.floor(Math.random() * 7) + 2; // Sizes 2-8 -> Average ~5 -> ~10-12 squads/team
    }
    
    const squadPlayers = session.slice(i, i + size);
    const isLocked = Math.random() < 0.3;

    // NEW: Assign team based on whether we are in the first or second half of the player list
    const currentTeam = (i < session.length / 2) ? 1 : 2;
    const sId = (currentTeam === 1 ? squadCounterT1++ : squadCounterT2++);

    squadPlayers.forEach(p => {
      structured.push({
        eosID: p.eosID,
        name: p.name,
        teamID: currentTeam, 
        originalTeam: currentTeam, // track this so assignTeams doesn't merge squads
        squadID: sId,
        squadLocked: isLocked
      });
    });

    i += size;
  }

  const targetUnassigned = unassignedCount !== null ? unassignedCount : Math.floor(Math.random() * 5); // 0 to 4
  const unassignedIndices = new Set();
  while (unassignedIndices.size < targetUnassigned && unassignedIndices.size < structured.length) {
    unassignedIndices.add(Math.floor(Math.random() * structured.length));
  }
  
  unassignedIndices.forEach(idx => {
    structured[idx].squadID = null;
    structured[idx].squadLocked = false;
  });

  return structured;
}

function assignCustomTeams(t1Array, t2Array) {
    const t1 = t1Array.map(p => ({...p, teamID: 1}));
    const t2 = t2Array.map(p => ({...p, teamID: 2}));
    
    // Re-index squad IDs for T1 so shifted players don't collide
    let nextSquadId = 1;
    const squadMapT1 = new Map();
    t1.forEach(p => {
       if (p.squadID === null) return;
       const origKey = `${p.originalTeam}-${p.squadID}`;
       if (!squadMapT1.has(origKey)) squadMapT1.set(origKey, nextSquadId++);
       p.squadID = squadMapT1.get(origKey);
    });
    
    // Re-index squad IDs for T2
    let nextSquadId2 = 1;
    const squadMapT2 = new Map();
    t2.forEach(p => {
       if (p.squadID === null) return;
       const origKey = `${p.originalTeam}-${p.squadID}`;
       if (!squadMapT2.has(origKey)) squadMapT2.set(origKey, nextSquadId2++);
       p.squadID = squadMapT2.get(origKey);
    });
    
    return { t1Players: t1, t2Players: t2 };
}

function assignTeams(players, ratio) {
    const t1Limit = Math.floor(players.length * ratio);
    return assignCustomTeams(players.slice(0, t1Limit), players.slice(t1Limit));
}

// ─── Scenario Runner ─────────────────────────────────────────────

async function runScenario(name, { t1Players, t2Players, note = '' }) {
  const eloMap = new Map(allPlayers.map(p => [p.eosID, p]));
  const before = getStats([...t1Players, ...t2Players], eloMap);
  
  const team1Snapshot = { team: '1', squads: groupBySquad(t1Players) };
  const team2Snapshot = { team: '2', squads: groupBySquad(t2Players) };

  const startTime = Date.now();
  const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
  players: [...t1Players, ...t2Players],
  squads: [
    ...groupBySquad(t1Players).map(s => ({ ...s, teamID: '1' })),
    ...groupBySquad(t2Players).map(s => ({ ...s, teamID: '2' }))
  ],
  scramblePercentage: 1,
  winStreakTeam: 1,
  eloMap
});
  const duration = Date.now() - startTime;

  const tfPlayers = [...t1Players, ...t2Players].map(p => {
    const move = swapPlan.find(m => m.eosID === p.eosID);
    return move ? { ...p, teamID: move.targetTeamID } : p;
  });

  const after = getStats(tfPlayers, eloMap);
  const lockedIntact = checkLockedSquads(t1Players, t2Players, tfPlayers);

  console.log(`\n-- ${name} ${note ? `(${note})` : ''}`);
  console.log(`   Players: T1=${before.t1Count} T2=${before.t2Count} | Locked squads: ${[...t1Players, ...t2Players].filter(p => p.squadLocked).length} | Moves: ${swapPlan.length} | Time: ${duration}ms`);
  
  const muStatus = after.muDiff <= before.muDiff ? '[PASS]' : '[WARN]';
  const vetStatus = after.vetDiff <= before.vetDiff ? '[PASS]' : (after.vetDiff <= 0.05 ? '--' : '[WARN]');
  const numStatus = after.numDiff <= 2 ? '[PASS]' : '[FAIL]';

  const top15Status = after.top15Diff <= before.top15Diff ? '[PASS]' : '[WARN]';
  console.log(`   ELO diff:  ${before.muDiff.toFixed(3)} -> ${after.muDiff.toFixed(3)}  ${muStatus}`);
  console.log(`   Top15 diff:${before.top15Diff.toFixed(3)} -> ${after.top15Diff.toFixed(3)}  ${top15Status}`);
  console.log(`   Vet diff:  ${before.vetDiff.toFixed(3)} -> ${after.vetDiff.toFixed(3)}  ${vetStatus}`);
  console.log(`   Num diff:  ${before.numDiff} -> ${after.numDiff}  ${numStatus}`);
  console.log(`   Locked:    ${lockedIntact ? '[PASS] intact' : '[FAIL] BROKEN'}`);

    console.log(`   \x1b[36m[MOVEMENT BREAKDOWN]\x1b[0m`);
    const movedGroups = new Map();
    
    // Build a map of original squad sizes to detect surgical splits
    const originalSquadSizes = new Map();
    [...t1Players, ...t2Players].forEach(p => {
        const sId = p.squadID ? `T${p.teamID}-S${p.squadID}` : `T${p.teamID}-Unassigned`;
        originalSquadSizes.set(sId, (originalSquadSizes.get(sId) || 0) + 1);
    });

    swapPlan.forEach(m => {
      const p = [...t1Players, ...t2Players].find(tp => String(tp.eosID) === String(m.eosID));
      if (!p) return;

      const sId = p.squadID ? `T${p.teamID}-S${p.squadID}` : `T${p.teamID}-Unassigned`;
      if (!movedGroups.has(sId)) {
        movedGroups.set(sId, { 
            mu: 0, 
            count: 0, 
            from: p.teamID,
            to: m.targetTeamID, 
            isLocked: p.squadLocked,
            isUnassigned: !p.squadID
        });
      }
      const sData = movedGroups.get(sId);
      sData.mu += (eloMap.get(m.eosID)?.mu || 25);
      sData.count++;
    });

    let t1ToT2Count = 0;
    let t2ToT1Count = 0;

    movedGroups.forEach((data, id) => {
      const totalInSquad = originalSquadSizes.get(id);
      const isSplit = !data.isUnassigned && data.count < totalInSquad;
      
      const statusType = data.isUnassigned ? '[UNASSIGNED]' : (data.isLocked ? '[LOCKED]' : '[OPEN]');
      const splitMarker = isSplit ? '\x1b[35m[SURGICAL SPLIT]\x1b[0m ' : '';
      const avgMu = (data.mu / data.count).toFixed(1);
      
      console.log(`      * ${statusType} ${splitMarker}${id}: Moved ${data.count}/${totalInSquad} players | Avg Mu: ${avgMu} | Total Mu: ${data.mu.toFixed(1)} | T${data.from} -> T${data.to}`);
      
      if (data.from == 1) t1ToT2Count += data.count;
      else t2ToT1Count += data.count;
    });
    
    if (movedGroups.size === 0) {
      console.log(`      * No players moved.`);
    }

    console.log(`   \x1b[36m[MASS BALANCE]\x1b[0m`);
    console.log(`     T1 Net Change: ${t2ToT1Count - t1ToT2Count > 0 ? '+' : ''}${t2ToT1Count - t1ToT2Count} players | Avg Mu: ${before.mu1.toFixed(3)} -> ${after.mu1.toFixed(3)}`);
    console.log(`     T2 Net Change: ${t1ToT2Count - t2ToT1Count > 0 ? '+' : ''}${t1ToT2Count - t2ToT1Count} players | Avg Mu: ${before.mu2.toFixed(3)} -> ${after.mu2.toFixed(3)}`);

  return { before, after, lockedIntact, time: duration, moves: swapPlan.length };
}

async function runBulk(name, generator, runs = 200) {
  const results = {
    total: 0, balanced: 0, eloImproved: 0, top15Improved: 0, vetImproved: 0, lockedBroken: 0,
    totalTime: 0, totalMoves: 0, totalMuBefore: 0, totalMuAfter: 0,
    totalTop15Before: 0, totalTop15After: 0,
    totalVetBefore: 0, totalVetAfter: 0
  };

  process.stdout.write(`[BULK] ${name} (${runs} runs) `);

  for (let i = 0; i < runs; i++) {
    const { t1Players, t2Players } = generator();
    const eloMap = new Map(allPlayers.map(p => [p.eosID, p]));
    
    const startTime = Date.now();
    const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
  players: [...t1Players, ...t2Players],
  squads: [
    ...groupBySquad(t1Players).map(s => ({ ...s, teamID: '1' })),
    ...groupBySquad(t2Players).map(s => ({ ...s, teamID: '2' }))
  ],
  scramblePercentage: 1,
  winStreakTeam: 1,
  eloMap
});
    const duration = Date.now() - startTime;

    const finalPlayers = [...t1Players, ...t2Players].map(p => {
      const move = swapPlan.find(m => m.eosID === p.eosID);
      return move ? { ...p, teamID: move.targetTeamID } : p;
    });

    const before = getStats([...t1Players, ...t2Players], eloMap);
    const after = getStats(finalPlayers, eloMap);
    const lockedIntact = checkLockedSquads(t1Players, t2Players, finalPlayers);

    results.total++;
    if (after.numDiff <= 2) results.balanced++;
    if (after.muDiff < before.muDiff) results.eloImproved++;
    if (after.top15Diff < before.top15Diff) results.top15Improved++;
    if (after.vetDiff < before.vetDiff) results.vetImproved++;
    if (!lockedIntact) results.lockedBroken++;
    
    results.totalTime += duration;
    results.totalMoves += swapPlan.length;
    results.totalMuBefore += before.muDiff;
    results.totalMuAfter += after.muDiff;
    results.totalTop15Before += before.top15Diff;
    results.totalTop15After += after.top15Diff;
    results.totalVetBefore += before.vetDiff;
    results.totalVetAfter += after.vetDiff;

    if (i % (runs/10) === 0) process.stdout.write('#');
  }

  console.log(`\n   Balanced (diff<=2):   ${results.balanced}/${runs} (${(results.balanced/runs*100).toFixed(1)}%)`);
  console.log(`   ELO improved:         ${results.eloImproved}/${runs} (${(results.eloImproved/runs*100).toFixed(1)}%) | Avg ${ (results.totalMuBefore/runs).toFixed(3) } -> ${ (results.totalMuAfter/runs).toFixed(3) }`);
  console.log(`   Top15 improved:       ${results.top15Improved}/${runs} (${(results.top15Improved/runs*100).toFixed(1)}%) | Avg ${ (results.totalTop15Before/runs).toFixed(3) } -> ${ (results.totalTop15After/runs).toFixed(3) }`);
  console.log(`   Vet improved:         ${results.vetImproved}/${runs} (${(results.vetImproved/runs*100).toFixed(1)}%) | Avg ${ (results.totalVetBefore/runs).toFixed(3) } -> ${ (results.totalVetAfter/runs).toFixed(3) }`);
  console.log(`   Locked broken:        ${results.lockedBroken}/${runs}`);
  console.log(`   Avg time: ${(results.totalTime/runs).toFixed(1)}ms | Avg moves: ${(results.totalMoves/runs).toFixed(1)}\n`);
}

// ─── Main Execution ─────────────────────────────────────────────

(async function main() {
  console.log('========================================================');
  console.log('  SCRAMBLER REAL DATA TEST SUITE');
  console.log('========================================================');

  console.log('\n> SCENARIO TESTS (single runs, verbose output)');
  console.log('------------------------------------------------');

  const randRatio = () => avgRatios.length > 0 ? avgRatios[Math.floor(Math.random() * avgRatios.length)] : 0.5;

  {
    const session = buildSession(100);
    const { t1Players, t2Players } = assignTeams(session, 0.51);
    await runScenario('Balanced Session', { t1Players, t2Players, note: 'ratio 0.51' });
  }

  {
    const session = buildSession(100);
    const { t1Players, t2Players } = assignTeams(session, 0.52);
    await runScenario('Imbalanced Session (52/48)', { t1Players, t2Players });
  }

  {
    const session = buildSession(100, 0.5, 0); // 50 regs, 50 others
    const regs = session.filter(p => (allPlayers.find(ap => ap.eosID === p.eosID)?.roundsPlayed || 0) >= 50);
    const others = session.filter(p => !regs.includes(p));
    const { t1Players, t2Players } = assignCustomTeams(
        [...regs.slice(0, 30), ...others.slice(0, 20)],
        [...regs.slice(30), ...others.slice(20)]
    );
    await runScenario('Veteran Stack (T1 regs=30 T2 regs=0, sizes 50/50)', { t1Players, t2Players });
  }

  {
    const session = buildSession(100, 0.3, 0);
    const sorted = [...session].sort((a,b) => (allPlayers.find(p=>p.eosID===b.eosID)?.mu||25) - (allPlayers.find(p=>p.eosID===a.eosID)?.mu||25));
    const { t1Players, t2Players } = assignCustomTeams(sorted.slice(0, 50), sorted.slice(50));
    await runScenario('ELO Stack (T1 highest 50, T2 lowest 50)', { t1Players, t2Players });
  }

  {
    const session = buildSession(102);
    const { t1Players, t2Players } = assignTeams(session, 0.52);
    await runScenario('Max Capacity (102 players)', { t1Players, t2Players });
  }

  {
    const session = buildSession(40, 0.3, 2);
    const { t1Players, t2Players } = assignTeams(session, 0.60);
    await runScenario('Low Pop Seeding (40 players)', { t1Players, t2Players });
  }

  {
    const session = buildSession(100, 0.3, null, 'low');
    const { t1Players, t2Players } = assignTeams(session, 0.51);
    await runScenario('Low Squad Count (~6 per team, sizes 7-9)', { t1Players, t2Players });
  }

  {
    const session = buildSession(100, 0.3, null, 'high');
    const { t1Players, t2Players } = assignTeams(session, 0.51);
    await runScenario('High Squad Count (~16 per team, sizes 2-4)', { t1Players, t2Players });
  }
  
  {
    const session = buildSession(100, 0.3, 0, 'indivisible');
    session.forEach(p => { p.squadLocked = true; }); // Force all locked
    const { t1Players, t2Players } = assignTeams(session, 0.54); // 54 vs 46 Imbalance
    await runScenario('Indivisible Lobby (All 9-man Locked Squads, 54/46)', { t1Players, t2Players });
  }

  {
    const session = buildSession(100, 0.3, 100); // 100 unassigned players
    const { t1Players, t2Players } = assignTeams(session, 0.52);
    await runScenario('Lone Wolf Avalanche (100 Unassigned, 52/48)', { t1Players, t2Players });
  }

  {
    const session = buildSession(100, 0.5, 0);
    const sorted = [...session].sort((a,b) => (allPlayers.find(p=>p.eosID===b.eosID)?.mu||25) - (allPlayers.find(p=>p.eosID===a.eosID)?.mu||25));
    const { t1Players, t2Players } = assignCustomTeams(sorted.slice(0, 50), sorted.slice(50));
    await runScenario('Variance Test (Run 1) [50v50 Elo Skew]', { t1Players, t2Players });
    await runScenario('Variance Test (Run 2) [50v50 Elo Skew]', { t1Players, t2Players });
    await runScenario('Variance Test (Run 3) [50v50 Elo Skew]', { t1Players, t2Players });
  }

  console.log('\n> BULK TESTS (200 runs each)');
  console.log('------------------------------------------------');

  await runBulk('Random realistic sessions', () => {
    const count = Math.floor(Math.random() * 42) + 60;
    return assignTeams(buildSession(count), randRatio());
  });

  await runBulk('Veteran-skewed sessions', () => {
    const count = Math.floor(Math.random() * 42) + 60;
    const session = buildSession(count, 0.5);
    const regs = session.filter(p => (allPlayers.find(ap => ap.eosID === p.eosID)?.roundsPlayed || 0) >= 50);
    const others = session.filter(p => !regs.includes(p));
    // Manual team assignment to create the skew
    return {
      t1Players: [...regs, ...others.slice(0, 10)].map(p => ({...p, teamID: 1})),
      t2Players: others.slice(10).map(p => ({...p, teamID: 2}))
    };
  });

  console.log('========================================================');
  console.log('  ALL TESTS COMPLETE');
  console.log('========================================================');
})();
