/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║           SCRAMBLER REAL DATA TEST SUITE                      ║
 * ╚═══════════════════════════════════════════════════════════════╝
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

  const getVetRatio = (list) => {
    if (list.length === 0) return 0;
    const vets = list.filter(p => (eloMap.get(p.eosID)?.roundsPlayed || 0) >= 50);
    return vets.length / list.length;
  };

  const mu1 = getAvgMu(t1);
  const mu2 = getAvgMu(t2);
  const v1  = getVetRatio(t1);
  const v2  = getVetRatio(t2);

  return {
    t1Count: t1.length,
    t2Count: t2.length,
    numDiff: Math.abs(t1.length - t2.length),
    mu1,
    mu2,
    muDiff: Math.abs(mu1 - mu2),
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

function buildSession(count, regRatio = 0.3) {
  const session = [];
  const regCount = Math.floor(count * regRatio);
  const provCount = count - regCount;

  const shuffledRegs = [...regulars].sort(() => 0.5 - Math.random());
  const shuffledProv = [...provisional].sort(() => 0.5 - Math.random());

  session.push(...shuffledRegs.slice(0, regCount));
  session.push(...shuffledProv.slice(0, provCount));

  // Assign to realistic squads (size 2-9)
  let squadCounter = 1;
  let teamCounter = 1;
  let i = 0;
  const structured = [];

  while (i < session.length) {
    const size = Math.floor(Math.random() * 8) + 2;
    const squadPlayers = session.slice(i, i + size);
    const isLocked = Math.random() < 0.3;
    const sId = squadCounter++;

    // NEW: Assign team based on whether we are in the first or second half of the player list
    const currentTeam = (i < session.length / 2) ? 1 : 2;

    squadPlayers.forEach(p => {
      structured.push({
        eosID: p.eosID,
        name: p.name,
        teamID: currentTeam, 
        squadID: sId,
        squadLocked: isLocked
      });
    });

    i += size;
    if (squadCounter > 10) {
        teamCounter = 2;
        squadCounter = 1;
    }
  }
  return structured;
}

function assignTeams(players, ratio) {
    const t1Limit = Math.floor(players.length * ratio);
    return {
        t1Players: players.slice(0, t1Limit).map(p => ({...p, teamID: 1})),
        t2Players: players.slice(t1Limit).map(p => ({...p, teamID: 2}))
    };
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

  console.log(`\n── ${name} ${note ? `(${note})` : ''}`);
  console.log(`   Players: T1=${before.t1Count} T2=${before.t2Count} | Locked squads: ${[...t1Players, ...t2Players].filter(p => p.squadLocked).length} | Moves: ${swapPlan.length} | Time: ${duration}ms`);
  
  const muStatus = after.muDiff <= before.muDiff ? '✅' : '⚠️ ';
  const vetStatus = after.vetDiff <= before.vetDiff ? '✅' : (after.vetDiff <= 0.05 ? '──' : '⚠️ ');
  const numStatus = after.numDiff <= 2 ? '✅' : '❌';

  console.log(`   ELO diff:  ${before.muDiff.toFixed(3)} → ${after.muDiff.toFixed(3)}  ${muStatus}`);
  console.log(`   Vet diff:  ${before.vetDiff.toFixed(3)} → ${after.vetDiff.toFixed(3)}  ${vetStatus}`);
  console.log(`   Num diff:  ${before.numDiff} → ${after.numDiff}  ${numStatus}`);
  console.log(`   Locked:    ${lockedIntact ? '✅ intact' : '❌ BROKEN'}`);

  if (after.muDiff > before.muDiff || after.numDiff > 2) {
    console.log(`   \x1b[33m[DEBUG: Regressive Case Analysis]\x1b[0m`);
    const movedSquads = new Map();
    swapPlan.forEach(m => {
      // String conversion prevents TypeErrors if IDs are mixed types
      const p = [...t1Players, ...t2Players].find(tp => String(tp.eosID) === String(m.eosID));
      
      // Safety check: if the player isn't found, skip to the next move
      if (!p) return;

      const sId = p.squadID ? `T${p.teamID}-S${p.squadID}` : `T${p.teamID}-Unassigned`;
      if (!movedSquads.has(sId)) {
        movedSquads.set(sId, { mu: 0, count: 0, to: m.targetTeamID, isLocked: p.squadLocked });
      }
      const sData = movedSquads.get(sId);
      sData.mu += (eloMap.get(m.eosID)?.mu || 25);
      sData.count++;
    });

    console.log(`     Major Movements:`);
    movedSquads.forEach((data, id) => {
      if (data.count > 1 || data.mu > 30) {
        console.log(`      • ${data.isLocked ? '[LOCKED]' : '[OPEN]'} ${id}: ${data.count} players | Total Mu: ${data.mu.toFixed(1)} | To T${data.to}`);
      }
    });
    console.log(`     Mass Balance: T1 Sum Mu: ${(after.mu1 * after.t1Count).toFixed(1)} | T2 Sum Mu: ${(after.mu2 * after.t2Count).toFixed(1)}`);
  }

  return { before, after, lockedIntact, time: duration, moves: swapPlan.length };
}

async function runBulk(name, generator, runs = 200) {
  const results = {
    total: 0, balanced: 0, eloImproved: 0, vetImproved: 0, lockedBroken: 0,
    totalTime: 0, totalMoves: 0, totalMuBefore: 0, totalMuAfter: 0,
    totalVetBefore: 0, totalVetAfter: 0
  };

  process.stdout.write(`🔁 Bulk: ${name} (${runs} runs) `);

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
    if (after.vetDiff < before.vetDiff) results.vetImproved++;
    if (!lockedIntact) results.lockedBroken++;
    
    results.totalTime += duration;
    results.totalMoves += swapPlan.length;
    results.totalMuBefore += before.muDiff;
    results.totalMuAfter += after.muDiff;
    results.totalVetBefore += before.vetDiff;
    results.totalVetAfter += after.vetDiff;

    if (i % (runs/10) === 0) process.stdout.write('■');
  }

  console.log(`\n   Balanced (diff<=2):   ${results.balanced}/${runs} (${(results.balanced/runs*100).toFixed(1)}%)`);
  console.log(`   ELO improved:         ${results.eloImproved}/${runs} (${(results.eloImproved/runs*100).toFixed(1)}%) | Avg ${ (results.totalMuBefore/runs).toFixed(3) } → ${ (results.totalMuAfter/runs).toFixed(3) }`);
  console.log(`   Vet improved:         ${results.vetImproved}/${runs} (${(results.vetImproved/runs*100).toFixed(1)}%) | Avg ${ (results.totalVetBefore/runs).toFixed(3) } → ${ (results.totalVetAfter/runs).toFixed(3) }`);
  console.log(`   Locked broken:        ${results.lockedBroken}/${runs}`);
  console.log(`   Avg time: ${(results.totalTime/runs).toFixed(1)}ms | Avg moves: ${(results.totalMoves/runs).toFixed(1)}\n`);
}

// ─── Main Execution ─────────────────────────────────────────────

(async function main() {
  console.log('════════════════════════════════════════════════════════');
  console.log('  SCRAMBLER REAL DATA TEST SUITE');
  console.log('════════════════════════════════════════════════════════');

  console.log('\n▶ SCENARIO TESTS (single runs, verbose output)');
  console.log('────────────────────────────────────────────────');

  const randRatio = () => avgRatios.length > 0 ? avgRatios[Math.floor(Math.random() * avgRatios.length)] : 0.5;

  {
    const session = buildSession(100);
    const { t1Players, t2Players } = assignTeams(session, 0.51);
    await runScenario('Balanced Session', { t1Players, t2Players, note: 'ratio 0.51' });
  }

  {
    const session = buildSession(100);
    const { t1Players, t2Players } = assignTeams(session, 0.62);
    await runScenario('Imbalanced Session 62/38', { t1Players, t2Players });
  }

  {
    const session = buildSession(100);
    const regs = session.filter(p => (allPlayers.find(ap => ap.eosID === p.eosID)?.roundsPlayed || 0) >= 50);
    const others = session.filter(p => !regs.includes(p));
    const t1Players = [...regs, ...others.slice(0, 20)].map(p => ({...p, teamID: 1}));
    const t2Players = others.slice(20).map(p => ({...p, teamID: 2}));
    await runScenario('Veteran Stack', { t1Players, t2Players, note: `T1 regs=${regs.length} T2 regs=0` });
  }

  {
    const session = buildSession(100);
    const sorted = [...session].sort((a,b) => (allPlayers.find(p=>p.eosID===b.eosID)?.mu||25) - (allPlayers.find(p=>p.eosID===a.eosID)?.mu||25));
    const t1Players = sorted.slice(0, 50).map(p => ({...p, teamID: 1}));
    const t2Players = sorted.slice(50).map(p => ({...p, teamID: 2}));
    const b = getStats([...t1Players, ...t2Players], new Map(allPlayers.map(p=>[p.eosID, p])));
    await runScenario('ELO Stack', { t1Players, t2Players, note: `T1 avg=${b.mu1.toFixed(1)} T2 avg=${b.mu2.toFixed(1)}` });
  }

  {
    const session = buildSession(102);
    const { t1Players, t2Players } = assignTeams(session, 0.52);
    await runScenario('Max Capacity (102 players)', { t1Players, t2Players });
  }

  console.log('\n▶ BULK TESTS (200 runs each)');
  console.log('────────────────────────────────────────────────');

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

  console.log('════════════════════════════════════════════════════════');
  console.log('  ALL TESTS COMPLETE');
  console.log('════════════════════════════════════════════════════════');
})();