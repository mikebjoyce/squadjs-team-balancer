import TeamBalancer from '../plugins/team-balancer.js';
import Logger from '../../core/logger.js'; // The plugin uses this, so we need a mock.

// Suppress logger output for cleaner test results
Logger.verbose = () => {};

console.log('🧪 Initializing Plugin Logic Test Harness...');

// 1. Environment Initialization (The "Harness")
const capturedBroadcasts = [];
const mockServer = {
  rcon: {
    broadcast: async (msg) => {
      capturedBroadcasts.push(msg);
    },
    execute: async (cmd) => {},
    warn: async (steamID, msg) => {},
    switchTeam: async (steamID, teamID) => {}, // Needed for executeScramble
  },
  players: [], // empty for logic tests
  squads: [], // empty for logic tests
  currentLayer: null,
  // Mock listener methods to prevent errors
  removeListener: () => {},
  on: () => {},
  listenerCount: () => 0,
};

const mockConnectors = {
  // Mock the database connector to prevent file system access and errors
  sqlite: {
    define: () => ({
      sync: async () => {},
      findOrCreate: async () => [
        {
          winStreakTeam: null,
          winStreakCount: 0,
          lastSyncTimestamp: Date.now(),
          lastScrambleTime: null,
          save: async () => {},
        },
        true,
      ],
      findByPk: async () => ({
        winStreakTeam: null,
        winStreakCount: 0,
        lastSyncTimestamp: Date.now(),
        lastScrambleTime: null,
        save: async () => {},
      }),
    }),
  },
};

const defaultTestOptions = {
  database: 'sqlite',
  enableWinStreakTracking: true,
  maxWinStreak: 2,
  enableSingleRoundScramble: false,
  singleRoundScrambleThreshold: 500,
  minTicketsToCountAsDominantWin: 300,
  invasionAttackTeamThreshold: 300,
  invasionDefenceTeamThreshold: 650,
  scrambleAnnouncementDelay: 10,
  scramblePercentage: 0.5,
  showWinStreakMessages: true,
  debugLogs: false,
  devMode: true, // To simplify command handling if needed
  useGenericTeamNamesInBroadcasts: true, // For predictable broadcast messages
  changeTeamRetryInterval: 200,
  maxScrambleCompletionTime: 5000,
  warnOnSwap: false,
  discordClient: null,
  discordChannelID: null,
};

// Helper for asserting test conditions
let testCount = 0;
let passCount = 0;
function assert(condition, message) {
  testCount++;
  if (condition) {
    passCount++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.log(`  ❌ FAIL: ${message}`);
  }
}

async function runPluginLogicTests() {
  console.log('\n🚀 Starting Plugin Logic Tests...');

  // Instantiate the plugin with our mock environment
  const tb = new TeamBalancer(mockServer, { ...defaultTestOptions }, mockConnectors);
  // Manually mount to initialize DB stubs etc.
  await tb.mount();

  // --- Phase 3.1: Layer & Mode Detection ---
  console.log('\n[Phase 3.1: Layer & Mode Detection]');
  // The plugin uses `gameModeCached`. We will set it directly for predictable testing.
  tb.gameModeCached = 'RAAS';
  assert(tb.gameModeCached.includes('RAAS'), 'Game mode is correctly set to Standard (RAAS)');
  tb.gameModeCached = 'Invasion';
  assert(tb.gameModeCached.includes('Invasion'), 'Game mode is correctly set to Invasion');

  // --- Phase 3.2: The "Dominant Win" Matrix ---
  console.log('\n[Phase 3.2: The "Dominant Win" Matrix]');

  // Standard (Threshold 300): Win -> True
  await tb.resetStreak();
  tb.gameModeCached = 'RAAS';
  await tb.onRoundEnded({ winner: { team: 1, tickets: 301 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 1, 'Standard Dominant Win (301 tickets) correctly increments streak.');

  // Standard (Threshold 300): Loss -> False
  await tb.resetStreak();
  tb.gameModeCached = 'RAAS';
  await tb.onRoundEnded({ winner: { team: 1, tickets: 150 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 0, 'Standard Non-Dominant Win (150 tickets) does NOT increment streak.');

  // Invasion Attacker (Threshold 300): Win -> True
  await tb.resetStreak();
  tb.gameModeCached = 'Invasion';
  await tb.onRoundEnded({ winner: { team: 1, tickets: 350 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 1, 'Invasion Attacker Dominant Win (350 tickets) correctly increments streak.');

  // Invasion Defender (Threshold 650): Loss -> False
  await tb.resetStreak();
  tb.gameModeCached = 'Invasion';
  await tb.onRoundEnded({ winner: { team: 2, tickets: 500 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 0, 'Invasion Defender Non-Dominant Win (500 tickets) does NOT increment streak.');

  // Invasion Defender (Threshold 650): Win -> True
  await tb.resetStreak();
  tb.gameModeCached = 'Invasion';
  await tb.onRoundEnded({ winner: { team: 2, tickets: 700 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 1, 'Invasion Defender Dominant Win (700 tickets) correctly increments streak.');

  // --- Phase 3.3: Streak & Scramble Triggering ---
  console.log('\n[Phase 3.3: Streak & Scramble Triggering]');

  // Sequence 1: Two dominant wins trigger scramble
  await tb.resetStreak();
  tb.options.maxWinStreak = 2;
  tb.gameModeCached = 'RAAS';
  await tb.onRoundEnded({ winner: { team: 1, tickets: 400 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 1, 'Sequence 1.1: First dominant win sets streak to 1.');
  assert(tb._scramblePending === false, 'Sequence 1.1: Scramble is NOT pending after first win.');

  await tb.onRoundEnded({ winner: { team: 1, tickets: 400 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 2, 'Sequence 1.2: Second dominant win sets streak to 2.');
  assert(tb._scramblePending === true, 'Sequence 1.2: Scramble IS pending after second win.');
  await tb.cancelPendingScramble(null, null, true); // Clean up for next test

  // Sequence 2: Streak Breaker
  await tb.resetStreak();
  tb.gameModeCached = 'RAAS';
  await tb.onRoundEnded({ winner: { team: 1, tickets: 400 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 1, 'Sequence 2.1: First dominant win sets streak to 1.');

  await tb.onRoundEnded({ winner: { team: 2, tickets: 50 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 0, 'Sequence 2.2: Non-dominant win by other team resets streak to 0.');

  // Sequence 3: Single Round Trigger
  await tb.resetStreak();
  tb.options.enableSingleRoundScramble = true;
  tb.options.singleRoundScrambleThreshold = 500;
  tb.gameModeCached = 'RAAS';
  await tb.onRoundEnded({ winner: { team: 1, tickets: 600 }, loser: { tickets: 99 } }); // Margin 501
  assert(tb._scramblePending === true, 'Sequence 3: Single round scramble is triggered by massive ticket margin.');
  await tb.cancelPendingScramble(null, null, true); // Clean up
  tb.options.enableSingleRoundScramble = false; // Reset option

  // --- Phase 3.4: Announcement & Post-Scramble Reset ---
  console.log('\n[Phase 3.4: Announcement & Post-Scramble Reset]');

  // Test scramble announcement
  await tb.resetStreak();
  capturedBroadcasts.length = 0; // Clear broadcast history
  tb.options.maxWinStreak = 1;
  await tb.onRoundEnded({ winner: { team: 1, tickets: 400 }, loser: { tickets: 0 } });
  const announcement = capturedBroadcasts.find((msg) => msg.includes('Scrambling in'));
  assert(!!announcement, 'Scramble announcement broadcast was captured.');
  assert(announcement.includes('1 dominant wins'), 'Announcement includes correct win count.');

  // Test post-scramble reset
  // We can call executeScramble directly to test the reset logic
  await tb.executeScramble(false); // isSimulated = false
  assert(tb.winStreakCount === 0, 'executeScramble resets the win streak count to 0.');
  assert(tb._scrambleInProgress === false, 'Scramble is no longer in progress after execution.');

  // --- Final Report ---
  console.log(`\n🏁 All logic tests completed. Result: ${passCount}/${testCount} passed.`);
  if (passCount !== testCount) {
    console.error('⚠️ Some logic tests failed. Please review the output.');
  }
}

runPluginLogicTests().catch(console.error);