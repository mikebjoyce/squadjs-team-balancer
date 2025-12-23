import Scrambler from '../utils/tb-scrambler.js';
import { generateMockPlayers, generateMockSquads, transformForScrambler, generateScenario_AllLocked, generateScenario_DavidGoliath } from './mock-data-generator.js';

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
    const move = swapPlan.find(m => m.steamID === p.steamID);
    return move ? { ...p, teamID: move.targetTeamID } : p;
  });

  const t1End = finalPlayers.filter(p => p.teamID === '1').length;
  const t2End = finalPlayers.filter(p => p.teamID === '2').length;
  const diff = Math.abs(t1End - t2End);

  console.log(`   Results:`);
  console.log(`   - Execution Time: ${duration}ms`);
  console.log(`   - Moves Generated: ${moves}`);
  console.log(`   - Final State: Team 1: ${t1End} | Team 2: ${t2End} (Diff: ${diff})`);

  // 6. Verifications
  const checks = [];
  checks.push({ name: 'Teams Balanced (Diff <= 2)', pass: diff <= 2 });
  checks.push({ name: 'No Team > 50 (approx)', pass: t1End <= 51 && t2End <= 51 }); // 51 tolerance for odd numbers
  
  const duplicateMoves = new Set(swapPlan.map(m => m.steamID)).size !== swapPlan.length;
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
    const move = swapPlan.find(m => m.steamID === p.steamID);
    return move ? { ...p, teamID: move.targetTeamID } : p;
  });

  const t1End = finalPlayers.filter(p => p.teamID === '1').length;
  const t2End = finalPlayers.filter(p => p.teamID === '2').length;
  const diff = Math.abs(t1End - t2End);

  console.log(`   Results:`);
  console.log(`   - Execution Time: ${duration}ms`);
  console.log(`   - Moves Generated: ${moves}`);
  console.log(`   - Final State: Team 1: ${t1End} | Team 2: ${t2End} (Diff: ${diff})`);

  // 4. Verify Broken Squads
  const brokenSquads = [];
  tfSquads.forEach(squad => {
    const movedPlayers = squad.players.filter(pid => swapPlan.some(m => m.steamID === pid));
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

  console.log(`\n--------------------------------------------------`);
  console.log('🏁 All tests completed.');

  await runBulkTests(2000);
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
    totalTime: 0,
    failures: []
  };

  for (let i = 0; i < totalRuns; i++) {
    const playerCount = Math.floor(Math.random() * (102 - 60 + 1)) + 60; // 60-102 players
    const team1Ratio = Math.random() * (0.7 - 0.3) + 0.3; // 30/70 to 70/30 imbalance
    const unassignedRatio = Math.random() * 0.25; // 0-25% unassigned

    // Generate data with random params
    const players = generateMockPlayers(playerCount, team1Ratio, unassignedRatio);
    const squads = generateMockSquads(players);
    const { squads: tfSquads, players: tfPlayers } = transformForScrambler(players, squads);

    const t1Start = tfPlayers.filter((p) => p.teamID === '1').length;
    const t2Start = tfPlayers.filter((p) => p.teamID === '2').length;

    // Run Scrambler
    const startTime = Date.now();
    const swapPlan = await Scrambler.scrambleTeamsPreservingSquads({
      squads: tfSquads,
      players: tfPlayers,
      winStreakTeam: 1,
      scramblePercentage: 0.5,
      debug: false
    });
    const duration = Date.now() - startTime;

    // Analyze
    const finalPlayers = tfPlayers.map((p) => {
      const move = swapPlan.find((m) => m.steamID === p.steamID);
      return move ? { ...p, teamID: move.targetTeamID } : p;
    });
    const t1End = finalPlayers.filter((p) => p.teamID === '1').length;
    const t2End = finalPlayers.filter((p) => p.teamID === '2').length;
    const diff = Math.abs(t1End - t2End);

    // Check for broken locked squads
    let hasBrokenLocked = false;
    tfSquads.forEach(squad => {
      if (!squad.locked) return;
      const movedPlayers = squad.players.filter(pid => swapPlan.some(m => m.steamID === pid));
      const allMoved = movedPlayers.length === squad.players.length;
      const noneMoved = movedPlayers.length === 0;
      if (!allMoved && !noneMoved) {
        hasBrokenLocked = true;
      }
    });

    if (hasBrokenLocked) results.lockedSquadsBroken++;

    // Aggregate results
    results.total++;
    results.totalTime += duration;
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

  if (results.failures.length > 0) {
    console.log(`\n📋 Failure Details (first 5):`);
    results.failures.slice(0, 5).forEach((fail) => {
      console.log(`  - Run ${fail.run}: Initial ${fail.initial} -> Final ${fail.final} (Diff: ${fail.diff}, Unassigned: ${fail.unassigned})`);
    });
  }
}

runAllTests().catch(console.error);