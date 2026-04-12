import { Scrambler } from '../utils/tb-scrambler.js';
import { generateMockPlayers, generateMockSquads, transformForScrambler, generateScenario_AllLocked, generateScenario_DavidGoliath } from './mock-data-generator.js';

// Helper to analyze team composition (Large vs Small vs Solo)
function getComposition(players) {
  const stats = {
    1: { large: 0, small: 0, solo: 0 },
    2: { large: 0, small: 0, solo: 0 }
  };

  // Group by SquadID + TeamID to handle splits naturally
  // Key: "SquadID::TeamID"
  const fragments = {};

  players.forEach(p => {
    if (!p.squadID) {
      stats[p.teamID].solo++;
    } else {
      const key = `${p.squadID}::${p.teamID}`;
      if (!fragments[key]) fragments[key] = 0;
      fragments[key]++;
    }
  });

  Object.entries(fragments).forEach(([key, count]) => {
    const teamID = key.split('::')[1];
    const target = stats[teamID];

    if (count >= 7) target.large++;
    else if (count >= 2) target.small++;
    else target.solo++;
  });

  return stats;
}

async function runTest(testName, config) {
  console.log(`\n--------------------------------------------------`);
  console.log(`🧪 TEST: ${testName}`);
  console.log(`   Config: ${JSON.stringify({ ...config, unassignedRatio: config.unassignedRatio ?? 'random' })}`);

  // 1. Generate Data
  const players = generateMockPlayers(config.playerCount, config.team1Ratio, config.unassignedRatio);
  const squads = generateMockSquads(players);
  
  // 2. Transform for Scrambler (mimic Plugin logic)
  const { squads: tfSquads, players: tfPlayers } = transformForScrambler(players, squads);

  // 3. Calculate initial state
  const t1Start = tfPlayers.filter(p => p.teamID === '1').length;
  const t2Start = tfPlayers.filter(p => p.teamID === '2').length;
  console.log(`   Initial State: Team 1: ${t1Start} | Team 2: ${t2Start} | Total: ${tfPlayers.length}`);

  // 4. Run Scrambler
  const startTime = Date.now();
  const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
    squads: tfSquads,
    players: tfPlayers,
    winStreakTeam: config.winStreakTeam || 1,
    scramblePercentage: config.scramblePercentage || 0.5,
    debug: false // Set to true for verbose internal logs
  });
  const duration = Date.now() - startTime;

  // 5. Analyze Results
  const moves = swapPlan.length;
  
  // Simulate applying moves to check final balance
  const finalPlayers = tfPlayers.map(p => {
    const move = swapPlan.find(m => m.eosID === p.eosID);
    return move ? { ...p, teamID: move.targetTeamID } : p;
  });

  const t1End = finalPlayers.filter(p => p.teamID === '1').length;
  const t2End = finalPlayers.filter(p => p.teamID === '2').length;
  const diff = Math.abs(t1End - t2End);

  const comp = getComposition(finalPlayers);

  console.log(`   Results:`);
  console.log(`   - Execution Time: ${duration}ms`);
  console.log(`   - Moves Generated: ${moves}`);
  console.log(`   - Final State: Team 1: ${t1End} | Team 2: ${t2End} (Diff: ${diff})`);
  console.log(`   - Composition T1: [ Large: ${comp[1].large} | Small: ${comp[1].small} | Solo: ${comp[1].solo} ]`);
  console.log(`   - Composition T2: [ Large: ${comp[2].large} | Small: ${comp[2].small} | Solo: ${comp[2].solo} ]`);

  // 6. Verifications
  const checks = [];
  checks.push({ name: 'Teams Balanced (Diff <= 2)', pass: diff <= 2 });
  checks.push({ name: 'No Team > 50 (approx)', pass: t1End <= 51 && t2End <= 51 }); // 51 tolerance for odd numbers
  
  const duplicateMoves = new Set(swapPlan.map(m => m.eosID)).size !== swapPlan.length;
  checks.push({ name: 'No Duplicate Moves', pass: !duplicateMoves });

  checks.forEach(c => console.log(`   ${c.pass ? '✅' : '❌'} ${c.name}`));
}

async function runCustomTest(testName, dataGeneratorFn) {
  console.log(`\n--------------------------------------------------`);
  console.log(`🧪 TEST: ${testName}`);

  // 1. Generate Data using custom generator
  const { players, squads } = dataGeneratorFn();
  const { squads: tfSquads, players: tfPlayers } = transformForScrambler(players, squads);

  const t1Start = tfPlayers.filter(p => p.teamID === '1').length;
  const t2Start = tfPlayers.filter(p => p.teamID === '2').length;
  console.log(`   Initial State: Team 1: ${t1Start} | Team 2: ${t2Start} | Total: ${tfPlayers.length}`);

  // 2. Run Scrambler
  const startTime = Date.now();
  const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
    squads: tfSquads,
    players: tfPlayers,
    winStreakTeam: 1,
    scramblePercentage: 0.5
  });
  const duration = Date.now() - startTime;

  // 3. Analyze Results
  const moves = swapPlan.length;
  const finalPlayers = tfPlayers.map(p => {
    const move = swapPlan.find(m => m.eosID === p.eosID);
    return move ? { ...p, teamID: move.targetTeamID } : p;
  });

  const t1End = finalPlayers.filter(p => p.teamID === '1').length;
  const t2End = finalPlayers.filter(p => p.teamID === '2').length;
  const diff = Math.abs(t1End - t2End);

  const comp = getComposition(finalPlayers);

  console.log(`   Results:`);
  console.log(`   - Execution Time: ${duration}ms`);
  console.log(`   - Moves Generated: ${moves}`);
  console.log(`   - Final State: Team 1: ${t1End} | Team 2: ${t2End} (Diff: ${diff})`);
  console.log(`   - Composition T1: [ Large: ${comp[1].large} | Small: ${comp[1].small} | Solo: ${comp[1].solo} ]`);
  console.log(`   - Composition T2: [ Large: ${comp[2].large} | Small: ${comp[2].small} | Solo: ${comp[2].solo} ]`);

  // 4. Verify Broken Squads
  const brokenSquads = [];
  tfSquads.forEach(squad => {
    const movedPlayers = squad.players.filter(pid => swapPlan.some(m => m.eosID === pid));
    const allMoved = movedPlayers.length === squad.players.length;
    const noneMoved = movedPlayers.length === 0;
    
    if (!allMoved && !noneMoved) {
      brokenSquads.push({ id: squad.id, locked: squad.locked, size: squad.players.length, moved: movedPlayers.length });
    }
  });

  if (brokenSquads.length > 0) {
    console.log(`   ⚠️  Broken Squads:`);
    brokenSquads.forEach(b => console.log(`      - ${b.id} (Locked: ${b.locked}): ${b.moved}/${b.size} moved`));
  }
}

async function runEloTest() {
  console.log(`\n--------------------------------------------------`);
  console.log(`🧪 TEST: ELO Balancing - Detect and fix a 15-man Pro Stack`);

  // Scenario: Team 1 has 15 Pros (35 ELO) and 35 Newbies (15 ELO).
  // Team 2 is 50 perfectly Average players (25 ELO).
  // Total Average is 25.0 for both teams. A simple mean-only algo would do NOTHING.
  const players = [];
  const eloMap = new Map();

  // Team 1: 15 Pros
  for (let i = 0; i < 15; i++) {
    const id = `pro_${i}`;
    players.push({ eosID: id, teamID: 1, squadID: 101, name: `Pro_${i}` });
    eloMap.set(id, { mu: 35.0 });
  }
  // Team 1: 35 Newbies
  for (let i = 0; i < 35; i++) {
    const id = `noob_${i}`;
    players.push({ eosID: id, teamID: 1, squadID: null, name: `Noob_${i}` });
    eloMap.set(id, { mu: 15.0 });
  }
  // Team 2: 50 Average
  for (let i = 0; i < 50; i++) {
    const id = `avg_${i}`;
    players.push({ eosID: id, teamID: 2, squadID: null, name: `Avg_${i}` });
    eloMap.set(id, { mu: 25.0 });
  }

  const squads = [
    { id: 101, teamID: 1, players: players.filter(p => p.squadID === 101).map(p => p.eosID), locked: false }
  ];

  const { squads: tfSquads, players: tfPlayers } = transformForScrambler(players, squads);

  const t1Start = tfPlayers.filter(p => p.teamID === '1').length;
  const t2Start = tfPlayers.filter(p => p.teamID === '2').length;
  console.log(`   Initial State: Team 1: ${t1Start} | Team 2: ${t2Start} | Total: ${tfPlayers.length}`);

  const plan = await Scrambler.scrambleTeamsPreservingSquads({
    squads: tfSquads,
    players: tfPlayers,
    winStreakTeam: 1,
    scramblePercentage: 0.2, // Move up to 20 players
    eloMap: eloMap
  });

  const movedPros = plan.filter(m => m.eosID.startsWith('pro') && m.targetTeamID === '2').length;
  console.log(`\n   Results:`);
  console.log(`   - Pros moved from Team 1 to Team 2: ${movedPros}/15`);

  if (movedPros >= 5) {
    console.log("   ✅ SUCCESS: The Backbone/Ace logic detected the elite stack and moved them!");
  } else {
    console.log("   ❌ FAILURE: The algorithm failed to prioritize moving the high-ELO players.");
  }
}

async function runAllTests() {
  console.log('🚀 Starting Scrambler Stress Tests...');

  // ✓ 50/50 balanced teams → moderate churn
  await runTest('50/50 Balanced', { playerCount: 80, team1Ratio: 0.5 });

  // ✓ 45/55 imbalanced → corrects imbalance
  await runTest('45/55 Imbalanced', { playerCount: 80, team1Ratio: 0.45 });

  // ✓ 50/52 slight overcap → trims correctly
  await runTest('50/52 Slight Overcap', { playerCount: 102, team1Ratio: 0.49 });

  // ✓ 20/80 severe imbalance
  // Note: Squad servers usually prevent this, but the scrambler should still handle the math.
  await runTest('20/80 Severe Imbalance', { playerCount: 80, team1Ratio: 0.2 });

  // ✓ 102 players (max capacity)
  await runTest('Max Capacity (102 Players)', { playerCount: 102, team1Ratio: 0.6 }); // Start imbalanced

  // ✓ "Absolute Packed" test with 0% unassigned players
  await runTest('Absolute Packed (0% Unassigned)', { playerCount: 80, team1Ratio: 0.55, unassignedRatio: 0 });

  // ✓ "The Wall of Locked Squads"
  await runCustomTest('All Locked Squads (High Imbalance)', () => generateScenario_AllLocked(100, 0.8));

  // ✓ "Unbreakable Large Squads"
  await runCustomTest('Single Large Unlocked vs Many Small Locked', generateScenario_DavidGoliath);

  // ✓ "Cap-Pressure Surgical"
  await runTest('Max Capacity Surgical Trim', { playerCount: 102, team1Ratio: 0.5, unassignedRatio: 0 });

  // ✓ ELO Balancing Test
  await runEloTest();

  // Additional Tests
  // ✓ Low Pop
  await runTest('Low Pop (40 Players)', { playerCount: 40, team1Ratio: 0.5 });

  // ✓ Mid-Game Join Wave
  await runTest('Mid-Game Join Wave (60 Players)', { playerCount: 60, team1Ratio: 0.4 });

  // ✓ Seeding Mode
  await runTest('Seeding Mode (20 Players)', { playerCount: 20, team1Ratio: 0.5 });

  console.log(`\n--------------------------------------------------`);
  console.log('🏁 All tests completed.');

  await runBulkTests(2500);
}

async function runBulkTests(totalRuns = 100) {
  console.log(`\n==================================================`);
  console.log(`🚀🚀🚀 STARTING BULK STRESS TEST (${totalRuns} runs) 🚀🚀🚀`);
  console.log(`==================================================`);

  const results = {
    total: 0,
    perfectBalance: 0, // diff <= 1
    acceptableBalance: 0, // diff == 2
    failedBalance: 0, // diff > 2
    lockedSquadsBroken: 0,
    infantryOverloadRuns: 0, // Runs where a team has > 2 large squads
    totalUtilitySquads: 0,
    totalLargeSquadsMoved: 0,
    eloRuns: 0,
    eloBalanceImproved: 0,
    totalInitialBackboneEloDiff: 0,
    totalFinalBackboneEloDiff: 0,
    totalTime: 0,
    totalChurn: 0,
    failures: []
  };

  for (let i = 0; i < totalRuns; i++) {
    const isEloRun = Math.random() < 0.5; // 50% of bulk tests will include ELO

    const playerCount = Math.floor(Math.random() * (102 - 60 + 1)) + 60; // 60-102 players
    const team1Ratio = Math.random() * (0.7 - 0.3) + 0.3; // 30/70 to 70/30 imbalance
    const unassignedRatio = Math.random() * 0.25; // 0-25% unassigned

    // Generate data with random params
    const players = generateMockPlayers(playerCount, team1Ratio, unassignedRatio);
    const squads = generateMockSquads(players);
    const { squads: tfSquads, players: tfPlayers } = transformForScrambler(players, squads);

    const t1Start = tfPlayers.filter((p) => p.teamID === '1').length;
    const t2Start = tfPlayers.filter((p) => p.teamID === '2').length;

    // ELO Test Data Generation (if applicable)
    let eloMap = null;
    let initialBackboneDiff = 0;

    const getBackboneEloAvg = (players, eloMap, teamID) => {
      const defaultMu = 25.0;
      const getElo = (id) => eloMap.get(id)?.mu ?? defaultMu;
      const teamPlayers = players.filter(p => p.teamID === teamID);
      if (teamPlayers.length === 0) return defaultMu;
      const teamElos = teamPlayers.map(p => getElo(p.eosID)).sort((a, b) => b - a);
      const slice = teamElos.slice(0, 15); // Top 15 players
      return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : defaultMu;
    };

    if (isEloRun) {
      results.eloRuns++;
      eloMap = new Map();
      const dominantTeam = t1Start > t2Start ? '1' : '2';

      tfPlayers.forEach(p => {
        let mu;
        const rand = Math.random();
        const isDominantTeamPlayer = p.teamID === dominantTeam;

        if (isDominantTeamPlayer) { // Skew ELO towards the larger team
          if (rand < 0.25) mu = 35.0;      // 25% chance of being a pro
          else if (rand < 0.6) mu = 30.0; // 35% chance of being a vet
          else mu = 25.0;                 // 40% average
        } else {
          if (rand < 0.05) mu = 35.0;      // 5% pro
          else if (rand < 0.2) mu = 30.0; // 15% vet
          else if (rand < 0.6) mu = 25.0; // 40% average
          else mu = 18.0;                 // 40% newbie
        }
        eloMap.set(p.eosID, { mu });
      });

      initialBackboneDiff = Math.abs(getBackboneEloAvg(tfPlayers, eloMap, '1') - getBackboneEloAvg(tfPlayers, eloMap, '2'));
      results.totalInitialBackboneEloDiff += initialBackboneDiff;
    }

    // Run Scrambler
    const startTime = Date.now();
    const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
      squads: tfSquads,
      players: tfPlayers,
      winStreakTeam: 1, scramblePercentage: 0.5, debug: false, eloMap: eloMap
    });
    const duration = Date.now() - startTime;

    // Analyze
    const finalPlayers = tfPlayers.map((p) => {
      const move = swapPlan.find((m) => m.eosID === p.eosID);
      return move ? { ...p, teamID: move.targetTeamID } : p;
    });
    const t1End = finalPlayers.filter((p) => p.teamID === '1').length;
    const t2End = finalPlayers.filter((p) => p.teamID === '2').length;
    const diff = Math.abs(t1End - t2End);

    // Composition Analysis
    const comp = getComposition(finalPlayers);
    if (comp[1].large > 2 || comp[2].large > 2) results.infantryOverloadRuns++;
    results.totalUtilitySquads += (comp[1].small + comp[2].small);

    if (isEloRun) {
      const finalBackboneDiff = Math.abs(getBackboneEloAvg(finalPlayers, eloMap, '1') - getBackboneEloAvg(finalPlayers, eloMap, '2'));
      results.totalFinalBackboneEloDiff += finalBackboneDiff;
      if (finalBackboneDiff < initialBackboneDiff) {
        results.eloBalanceImproved++;
      }
    }

    // Check for broken locked squads
    let hasBrokenLocked = false;
    tfSquads.forEach(squad => {
      if (!squad.locked) return;
      const movedPlayers = squad.players.filter(pid => swapPlan.some(m => m.eosID === pid));
      const allMoved = movedPlayers.length === squad.players.length;
      const noneMoved = movedPlayers.length === 0;
      if (!allMoved && !noneMoved) {
        hasBrokenLocked = true;
      }
    });

    if (hasBrokenLocked) results.lockedSquadsBroken++;

    // Calculate Large Squads Moved
    let largeSquadsMoved = 0;
    tfSquads.forEach(s => {
      if (s.players.length >= 7) {
    const movedPlayers = s.players.filter(pid => swapPlan.some(m => m.eosID === pid));
    if (movedPlayers.length === s.players.length) largeSquadsMoved++;
      }
    });
    results.totalLargeSquadsMoved += largeSquadsMoved;

    // Aggregate results
    results.total++;
    results.totalTime += duration;
    results.totalChurn += swapPlan.length;
    if (diff <= 1) results.perfectBalance++;
    else if (diff === 2) results.acceptableBalance++;
    else {
      results.failedBalance++;
      results.failures.push({
        run: i + 1,
        initial: `${t1Start}/${t2Start}`,
        final: `${t1End}/${t2End}`,
        diff: diff,
        unassigned: players.filter((p) => !p.squadID).length
      });
    }
    if ((i + 1) % (totalRuns / 10) === 0) process.stdout.write('■');
  }
  process.stdout.write('\n\n');

  console.log(`🏁🏁🏁 BULK TEST SUMMARY 🏁🏁🏁`);
  console.log(`Total Runs: ${results.total}`);
  console.log(`Avg. Execution Time: ${(results.totalTime / results.total).toFixed(2)}ms`);
  console.log(`--------------------------------`);
  const perfectPercent = ((results.perfectBalance / results.total) * 100).toFixed(2);
  const acceptablePercent = ((results.acceptableBalance / results.total) * 100).toFixed(2);
  const failedPercent = ((results.failedBalance / results.total) * 100).toFixed(2);
  console.log(`✅ Perfect Balance (Diff <= 1):   ${results.perfectBalance} (${perfectPercent}%)`);
  console.log(`👌 Acceptable Balance (Diff = 2): ${results.acceptableBalance} (${acceptablePercent}%)`);
  console.log(`❌ Failed Balance (Diff > 2):     ${results.failedBalance} (${failedPercent}%)`);
  console.log(`🔓 Runs with Locked Squad Breaks:   ${results.lockedSquadsBroken}`);
  console.log(`--------------------------------`);
  if (results.eloRuns > 0) {
    const eloImprovePercent = ((results.eloBalanceImproved / results.eloRuns) * 100).toFixed(2);
    const avgInitialEloDiff = (results.totalInitialBackboneEloDiff / results.eloRuns).toFixed(2);
    const avgFinalEloDiff = (results.totalFinalBackboneEloDiff / results.eloRuns).toFixed(2);
    console.log(`🧠 ELO Balancing (Backbone) Results (${results.eloRuns} runs):`);
    console.log(`   - Avg Initial Diff: ${avgInitialEloDiff}`);
    console.log(`   - Avg Final Diff:   ${avgFinalEloDiff}`);
    console.log(`   - Improvement Rate: ${eloImprovePercent}%`);
  }
  console.log(`⚠️ Runs with Infantry Overload (>2 Large): ${results.infantryOverloadRuns} (${((results.infantryOverloadRuns / results.total) * 100).toFixed(2)}%)`);
  console.log(`🛠️ Avg Utility Squads per Run: ${(results.totalUtilitySquads / results.total).toFixed(2)}`);
  console.log('⚓ Avg. Large Squads Moved: ' + (results.totalLargeSquadsMoved / results.total).toFixed(2));
  console.log('🔄 Avg. Churn (Players Moved): ' + (results.totalChurn / results.total).toFixed(2));
  console.log('🎯 Success Rate (Diff <= 2): ' + (((results.perfectBalance + results.acceptableBalance) / results.total) * 100).toFixed(2) + '%');
  console.log(`--------------------------------`);

  if (results.failures.length > 0) {
    console.log(`\n📋 Failure Details (first 5):`);
    results.failures.slice(0, 5).forEach((fail) => {
      console.log(`  - Run ${fail.run}: Initial ${fail.initial} -> Final ${fail.final} (Diff: ${fail.diff}, Unassigned: ${fail.unassigned})`);
    });
  }
}

runAllTests().catch(console.error);