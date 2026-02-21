import { Scrambler } from '../utils/tb-scrambler.js';
import Logger from '../core/logger.js';

// Mock Logger to see results in console
Logger.verbose = (module, level, message) => {
  if (level <= 2) console.log(`[${module}] ${message}`);
};

async function runEloTest() {
  console.log("🧪 Starting ELO Balancing Integration Test...");

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

  console.log("\n--- TEST: Can the algorithm detect and fix a 15-man Pro Stack? ---");
  const plan = await Scrambler.scrambleTeamsPreservingSquads({
    squads,
    players,
    winStreakTeam: 1,
    scramblePercentage: 0.2, // Move up to 20 players
    eloMap: eloMap
  });

  const movedPros = plan.filter(m => m.eosID.startsWith('pro') && m.targetTeamID === '2').length;
  console.log(`\nResults:`);
  console.log(`- Pros moved from Team 1 to Team 2: ${movedPros}/15`);
  
  if (movedPros >= 5) {
    console.log("✅ SUCCESS: The Backbone/Vanguard logic detected the elite stack and moved them!");
  } else {
    console.log("❌ FAILURE: The algorithm failed to prioritize moving the high-ELO players.");
  }
}

runEloTest();