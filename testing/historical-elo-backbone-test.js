/**
 * Historical Backbone ELO Test
 * Proves that the "Top 15" Backbone ELO balancing logic correctly balances
 * the high-end tier of players using the historical EloTracker dataset.
 */

import { readFileSync } from 'fs';
import { Scrambler } from '../utils/tb-scrambler.js';

// Simple mock for logger
global.Logger = { verbose: () => {} };

const ELO_DB = process.argv[2];
if (!ELO_DB) {
  console.error('Usage: node historical-elo-backbone-test.js <elodb.json>');
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
const eloMap = new Map(allPlayers.map(p => [p.eosID, p]));

console.log(`DB loaded: ${allPlayers.length} players`);

// ─── Helpers ─────────────────────────────────────────────────────

function groupBySquad(players) {
  const squads = {};
  players.forEach(p => {
    const sId = p.squadID || 'unassigned';
    if (!squads[sId]) {
      squads[sId] = { 
        squadID: p.squadID, 
        id: p.squadID ? `T${p.teamID}-S${p.squadID}` : `Unassigned-${p.eosID}`,
        players: [],
        locked: false
      };
    }
    squads[sId].players.push(p.eosID);
    if (p.squadLocked) squads[sId].locked = true; 
  });
  return Object.values(squads);
}

const getBackboneEloAvg = (players, teamID) => {
    const defaultMu = 25.0;
    const getElo = (id) => eloMap.get(id)?.mu ?? defaultMu;
    const teamPlayers = players.filter(p => p.teamID == teamID);
    if (teamPlayers.length === 0) return defaultMu;
    const teamElos = teamPlayers.map(p => getElo(p.eosID)).sort((a, b) => b - a);
    const slice = teamElos.slice(0, 15); // Top 15 players
    return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : defaultMu;
};

// ─── Session Builder ────────────────────────────────────────────

function buildSession(count) {
  const session = [];
  const shuffled = [...allPlayers].sort(() => 0.5 - Math.random());
  
  // We want a mix of high ELO and low ELO players to create an interesting scenario
  session.push(...shuffled.slice(0, count));

  let squadCounter = 1;
  let i = 0;
  const structured = [];

  while (i < session.length) {
    const size = Math.floor(Math.random() * 7) + 2; // Squad sizes 2-8
    const squadPlayers = session.slice(i, i + size);
    const isLocked = Math.random() < 0.3; // 30% chance squad is locked
    const sId = squadCounter++;

    squadPlayers.forEach(p => {
      structured.push({
        eosID: p.eosID,
        name: p.name,
        squadID: sId,
        squadLocked: isLocked
      });
    });

    i += size;
  }
  
  return structured;
}

async function runBulkTest(runs) {
  console.log(`\n========================================================`);
  console.log(`  STARTING HISTORICAL BACKBONE BULK TEST (${runs} runs)`);
  console.log(`========================================================\n`);

  const results = {
    runs: 0,
    improvedBackbones: 0,
    perfectBalanceNum: 0, // Diff <= 1
    totalInitialBackboneDiff: 0,
    totalFinalBackboneDiff: 0,
    totalInitialGlobalDiff: 0,
    totalFinalGlobalDiff: 0,
  };

  for (let i = 0; i < runs; i++) {
    // 1. Build a match with 100 random historical players
    const session = buildSession(100);
    
    // 2. Sort them by ELO and create an extremely imbalanced "stack" scenario
    // We put the top 20 players on Team 1, and bottom 20 on Team 2,
    // and randomly distribute the rest, ensuring identical overall averages? No, let's just 
    // create a scenario where the backbone is extremely skewed, but global isn't as skewed.
    const sorted = [...session].sort((a,b) => (eloMap.get(b.eosID)?.mu||25) - (eloMap.get(a.eosID)?.mu||25));
    
    // T1 gets top 15 (The Pro Stack), T2 gets bottom 15. The rest (70) distributed randomly
    let t1Players = sorted.slice(0, 15).map(p => ({...p, teamID: '1'}));
    let t2Players = sorted.slice(session.length - 15).map(p => ({...p, teamID: '2'}));
    
    const middle = sorted.slice(15, session.length - 15).sort(() => 0.5 - Math.random());
    t1Players = t1Players.concat(middle.slice(0, 35).map(p => ({...p, teamID: '1'})));
    t2Players = t2Players.concat(middle.slice(35).map(p => ({...p, teamID: '2'})));

    const players = [...t1Players, ...t2Players];
    
    // 3. Measure initial state
    const initialB1 = getBackboneEloAvg(players, '1');
    const initialB2 = getBackboneEloAvg(players, '2');
    const initialBackboneDiff = Math.abs(initialB1 - initialB2);
    
    const getGlobalAvg = (team) => {
        const t = players.filter(p => p.teamID == team);
        return t.reduce((a,b) => a + (eloMap.get(b.eosID)?.mu||25), 0) / t.length;
    };
    
    const initialGlobalDiff = Math.abs(getGlobalAvg('1') - getGlobalAvg('2'));

    // 4. Run Scrambler
    const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
      players: players,
      squads: [
        ...groupBySquad(t1Players).map(s => ({ ...s, teamID: '1' })),
        ...groupBySquad(t2Players).map(s => ({ ...s, teamID: '2' }))
      ],
      scramblePercentage: 0.5,
      winStreakTeam: 1,
      eloMap: eloMap
    });

    // 5. Apply plan and measure final state
    const finalPlayers = players.map(p => {
      const move = swapPlan.find(m => m.eosID === p.eosID);
      return move ? { ...p, teamID: move.targetTeamID } : p;
    });

    const finalB1 = getBackboneEloAvg(finalPlayers, '1');
    const finalB2 = getBackboneEloAvg(finalPlayers, '2');
    const finalBackboneDiff = Math.abs(finalB1 - finalB2);

    const getFinalGlobalAvg = (team) => {
        const t = finalPlayers.filter(p => p.teamID == team);
        return t.reduce((a,b) => a + (eloMap.get(b.eosID)?.mu||25), 0) / t.length;
    };
    
    const finalGlobalDiff = Math.abs(getFinalGlobalAvg('1') - getFinalGlobalAvg('2'));

    const finalT1Count = finalPlayers.filter(p => p.teamID == '1').length;
    const finalT2Count = finalPlayers.filter(p => p.teamID == '2').length;

    // 6. Aggregate Results
    results.runs++;
    results.totalInitialBackboneDiff += initialBackboneDiff;
    results.totalFinalBackboneDiff += finalBackboneDiff;
    results.totalInitialGlobalDiff += initialGlobalDiff;
    results.totalFinalGlobalDiff += finalGlobalDiff;
    
    if (finalBackboneDiff < initialBackboneDiff) results.improvedBackbones++;
    if (Math.abs(finalT1Count - finalT2Count) <= 1) results.perfectBalanceNum++;

    if (i % (runs/10) === 0) process.stdout.write('■');
  }

  console.log(`\n\n🏁🏁🏁 BACKBONE TEST SUMMARY 🏁🏁🏁`);
  console.log(`Total Runs: ${results.runs}`);
  console.log(`--------------------------------`);
  console.log(`✅ Perfect Numerical Balance (Diff <= 1): ${results.perfectBalanceNum} (${(results.perfectBalanceNum/results.runs*100).toFixed(1)}%)`);
  console.log(`🧠 Backbone Balance Improved: ${results.improvedBackbones} (${(results.improvedBackbones/results.runs*100).toFixed(1)}%)`);
  
  const avgInitBackbone = (results.totalInitialBackboneDiff / results.runs).toFixed(3);
  const avgFinBackbone = (results.totalFinalBackboneDiff / results.runs).toFixed(3);
  console.log(`   - Avg Initial Backbone Diff (Top 15): ${avgInitBackbone} ELO`);
  console.log(`   - Avg Final Backbone Diff (Top 15):   ${avgFinBackbone} ELO`);
  
  const avgInitGlobal = (results.totalInitialGlobalDiff / results.runs).toFixed(3);
  const avgFinGlobal = (results.totalFinalGlobalDiff / results.runs).toFixed(3);
  console.log(`\n   - (For Context) Avg Initial Global Diff: ${avgInitGlobal} ELO`);
  console.log(`   - (For Context) Avg Final Global Diff:   ${avgFinGlobal} ELO`);
  console.log(`--------------------------------\n`);
}

runBulkTest(2500).catch(console.error);
