/**
 * Historical Match Replay Test
 *
 * Replays real matches from merged.jsonl through the scrambler.
 * Uses muBefore from match log as ELO source of truth.
 * Uses roundsPlayed from the ELO DB backup for veterancy.
 * Synthesises squads from team groupings (no squad data in log).
 *
 * Usage:
 *   node historical-scramble-test.js <path/to/merged.jsonl> <path/to/elo-db.json>
 *
 * Filters: non-invasion, non-draw, >= 80 players
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import Scrambler from '../utils/tb-scrambler.js';

const require = createRequire(import.meta.url);

// --- Args ---
const MATCH_LOG = process.argv[2];
const ELO_DB    = process.argv[3];

if (!MATCH_LOG || !ELO_DB) {
  console.error('Usage: node historical-scramble-test.js <merged.jsonl> <elo-db.json>');
  process.exit(1);
}

// --- Load data ---
const matches = readFileSync(MATCH_LOG, 'utf8')
  .split('\n').filter(l => l.trim())
  .map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

const dbRaw   = JSON.parse(readFileSync(ELO_DB, 'utf8'));
const db      = new Map((dbRaw.players ?? dbRaw).map(p => [p.eosID, p]));

// --- Config ---
const REGULAR_MIN     = 10;
const SCRAMBLE_PCT    = 0.5;

// --- Filter eligible matches ---
const eligible = matches.filter(m =>
  !m.gameMode?.toLowerCase().includes('invasion') &&
  m.outcome !== 'draw' &&
  m.players?.length >= 80
);

console.log(`Matches loaded: ${matches.length}`);
console.log(`Eligible (non-invasion, non-draw, >=80 players): ${eligible.length}\n`);

// --- Synthesise squads from a flat player list ---
// Groups players into squads of realistic Squad sizes.
// ~70% of players are squadded, ~30% solo (unassigned).
// Some squads are randomly locked.
function synthesiseSquads(players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const squadded = shuffled.slice(0, Math.floor(shuffled.length * 0.7));
  const solo     = shuffled.slice(squadded.length);

  const squads = [];
  let squadIdx = 1;
  let i = 0;

  while (i < squadded.length) {
    // Squad sizes: roughly 4-9 players, weighted toward 6-8
    const size = Math.min(
      squadded.length - i,
      Math.floor(Math.random() * 6) + 4
    );
    const members = squadded.slice(i, i + size);
    const locked  = Math.random() < 0.3; // 30% chance locked

    squads.push({
      squadID: squadIdx++,
      teamID:  members[0].teamID,
      players: members.map(p => p.eosID),
      locked
    });
    i += size;
  }

  // Solo players get null squadID
  const allPlayers = [
    ...squadded.map(p => ({ ...p, squadID: squads.find(s => s.players.includes(p.eosID))?.squadID ?? null })),
    ...solo.map(p => ({ ...p, squadID: null }))
  ];

  return { squads, players: allPlayers };
}

// --- Transform into scrambler format (mirrors plugin logic) ---
function transformForScrambler(players, squads) {
  const squadPlayerMap = new Map();
  for (const p of players) {
    if (p.squadID) {
      const key = `T${p.teamID}-S${p.squadID}`;
      if (!squadPlayerMap.has(key)) squadPlayerMap.set(key, []);
      squadPlayerMap.get(key).push(p.eosID);
    }
  }

  const tfSquads = squads.map(s => ({
    id:     `T${s.teamID}-S${s.squadID}`,
    teamID: String(s.teamID),
    players: squadPlayerMap.get(`T${s.teamID}-S${s.squadID}`) ?? [],
    locked: s.locked
  })).filter(s => s.players.length > 0);

  const tfPlayers = players.map(p => ({
    eosID:   p.eosID,
    teamID:  String(p.teamID),
    squadID: p.squadID ? `T${p.teamID}-S${p.squadID}` : null
  }));

  return { squads: tfSquads, players: tfPlayers };
}

// --- Stats helpers ---
const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

function getTeamStats(players, eloMap, roundsMap) {
  const t1 = players.filter(p => String(p.teamID) === '1');
  const t2 = players.filter(p => String(p.teamID) === '2');
  const muAvg = team => avg(team.map(p => eloMap.get(p.eosID)?.mu ?? 25));
  const regs  = team => team.filter(p => (roundsMap.get(p.eosID) ?? 0) >= REGULAR_MIN).length;
  const vetRatio = team => team.length > 0 ? regs(team) / team.length : 0;
  return {
    t1MuAvg:   muAvg(t1),
    t2MuAvg:   muAvg(t2),
    muDiff:    Math.abs(muAvg(t1) - muAvg(t2)),
    t1VetRatio: vetRatio(t1),
    t2VetRatio: vetRatio(t2),
    vetDiff:   Math.abs(vetRatio(t1) - vetRatio(t2)),
    t1Count:   t1.length,
    t2Count:   t2.length,
  };
}

// --- Main test loop ---
async function run() {
  const results = {
    total: 0,
    muImproved: 0,
    muWorsened: 0,
    vetImproved: 0,
    vetWorsened: 0,
    balancedFinal: 0, // numeric diff <= 2
    lockedBroken: 0,
    totalMuBefore: 0,
    totalMuAfter: 0,
    totalVetBefore: 0,
    totalVetAfter: 0,
    totalDuration: 0,
    totalChurn: 0,
  };

  const SAMPLE = Math.min(eligible.length, 50); // run 50 matches
  const selected = eligible.slice(0, SAMPLE);

  console.log(`Running ${SAMPLE} historical matches through scrambler...\n`);

  for (const match of selected) {
    const matchPlayers = match.players;

    // Build eloMap from muBefore in match log
    const eloMap = new Map(matchPlayers.map(p => [
      p.eosID,
      {
        mu:           p.muBefore,
        sigma:        p.sigmaBefore,
        roundsPlayed: db.get(p.eosID)?.roundsPlayed ?? 0
      }
    ]));

    // Build roundsMap for veteran penalty
    const roundsMap = new Map(matchPlayers.map(p => [
      p.eosID,
      db.get(p.eosID)?.roundsPlayed ?? 0
    ]));

    // Synthesise squads (per team)
    const t1Players = matchPlayers.filter(p => p.teamID === 1);
    const t2Players = matchPlayers.filter(p => p.teamID === 2);

    const { squads: t1Squads, players: t1WithSquads } = synthesiseSquads(t1Players);
    const { squads: t2Squads, players: t2WithSquads } = synthesiseSquads(t2Players);

    const allPlayers = [...t1WithSquads, ...t2WithSquads];
    const allSquads  = [...t1Squads, ...t2Squads];

    const { squads: tfSquads, players: tfPlayers } = transformForScrambler(allPlayers, allSquads);

    // Pre-scramble stats
    const before = getTeamStats(tfPlayers, eloMap, roundsMap);

    // Run scrambler
    const winStreak = match.outcome === 'team1win' ? 1 : 2;
    const startTime = Date.now();

    const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
      squads:             tfSquads,
      players:            tfPlayers,
      winStreakTeam:      winStreak,
      scramblePercentage: SCRAMBLE_PCT,
      eloMap
    });

    const duration = Date.now() - startTime;

    // Apply swap plan to get final player list
    const finalPlayers = tfPlayers.map(p => {
      const move = swapPlan.find(m => m.eosID === p.eosID);
      return move ? { ...p, teamID: move.targetTeamID } : p;
    });

    // Post-scramble stats
    const after = getTeamStats(finalPlayers, eloMap, roundsMap);

    // Check locked squads
    let brokenLocked = false;
    for (const squad of tfSquads) {
      if (!squad.locked) continue;
      const moved = squad.players.filter(pid => swapPlan.some(m => m.eosID === pid));
      if (moved.length > 0 && moved.length < squad.players.length) {
        brokenLocked = true;
        break;
      }
    }

    // Aggregate
    results.total++;
    results.totalDuration += duration;
    results.totalChurn    += swapPlan.length;
    results.totalMuBefore  += before.muDiff;
    results.totalMuAfter   += after.muDiff;
    results.totalVetBefore += before.vetDiff;
    results.totalVetAfter  += after.vetDiff;

    if (after.muDiff  < before.muDiff)  results.muImproved++;
    if (after.muDiff  > before.muDiff)  results.muWorsened++;
    if (after.vetDiff < before.vetDiff) results.vetImproved++;
    if (after.vetDiff > before.vetDiff) results.vetWorsened++;
    if (Math.abs(after.t1Count - after.t2Count) <= 2) results.balancedFinal++;
    if (brokenLocked) results.lockedBroken++;

    process.stdout.write('■');
  }

  process.stdout.write('\n\n');

  const n = results.total;
  const avgMuBefore  = results.totalMuBefore  / n;
  const avgMuAfter   = results.totalMuAfter   / n;
  const avgVetBefore = results.totalVetBefore / n;
  const avgVetAfter  = results.totalVetAfter  / n;

  console.log('════════════════════════════════════════');
  console.log('  HISTORICAL SCRAMBLE TEST RESULTS');
  console.log('════════════════════════════════════════');
  console.log(`Matches run:          ${n}`);
  console.log(`Avg execution time:   ${(results.totalDuration / n).toFixed(1)}ms`);
  console.log(`Avg players moved:    ${(results.totalChurn / n).toFixed(1)}`);
  console.log();
  console.log('--- NUMERIC BALANCE ---');
  console.log(`✅ Final diff <= 2:   ${results.balancedFinal} / ${n} (${(100 * results.balancedFinal / n).toFixed(1)}%)`);
  console.log();
  console.log('--- ELO BALANCE (global mean mu diff) ---');
  console.log(`Avg before: ${avgMuBefore.toFixed(3)}`);
  console.log(`Avg after:  ${avgMuAfter.toFixed(3)}`);
  console.log(`Improved:   ${results.muImproved} / ${n} (${(100 * results.muImproved / n).toFixed(1)}%)`);
  console.log(`Worsened:   ${results.muWorsened} / ${n} (${(100 * results.muWorsened / n).toFixed(1)}%)`);
  console.log();
  console.log('--- VETERAN PARITY (ratio diff) ---');
  console.log(`Avg before: ${avgVetBefore.toFixed(3)}`);
  console.log(`Avg after:  ${avgVetAfter.toFixed(3)}`);
  console.log(`Improved:   ${results.vetImproved} / ${n} (${(100 * results.vetImproved / n).toFixed(1)}%)`);
  console.log(`Worsened:   ${results.vetWorsened} / ${n} (${(100 * results.vetWorsened / n).toFixed(1)}%)`);
  console.log();
  console.log('--- INTEGRITY ---');
  console.log(`🔓 Locked squads broken: ${results.lockedBroken} / ${n}`);
  console.log('════════════════════════════════════════');
}

run().catch(console.error);