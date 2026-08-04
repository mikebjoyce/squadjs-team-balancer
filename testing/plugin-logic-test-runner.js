import TeamBalancer from '../plugins/team-balancer.js';
import Logger from '../../core/logger.js'; // The plugin uses this, so we need a mock.

// Suppress logger output for cleaner test results
Logger.verbose = (module, level, message) => {
  if (level === 1) console.error(`[${module}] ERROR: ${message}`);
};

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
    switchTeam: async (rconIdentifier, teamID) => {
      // Actually mutate the mock player so SwapExecutor's verification step sees the move succeed.
      const player = mockServer.players.find(
        (p) => p.steamID === rconIdentifier || p.name === rconIdentifier || p.eosID === rconIdentifier
      );
      if (player) player.teamID = Number(teamID);
    },
  },
  players: [], // empty for logic tests
  squads: [], // empty for logic tests
  currentLayer: null,
  // Mock listener methods to prevent errors
  removeListener: () => {},
  on: () => {},
  listenerCount: () => 0,
  emit: () => {}, // executeScramble() emits TEAM_BALANCER_SCRAMBLE_EXECUTED
  updatePlayerList: async () => {}, // SwapExecutor refreshes the player list to verify moves
};

const mockDbState = {
  winStreakTeam: null,
  winStreakCount: 0,
  consecutiveWinsTeam: null,
  consecutiveWinsCount: 0,
  manuallyDisabled: false,
  lastSyncTimestamp: Date.now(),
  lastScrambleTime: null,
  scrambleOnRoundEndBy: null,
};

const mockModel = {
  sync: async () => {},
  findOrCreate: async () => {
    const instance = {
      ...mockDbState,
      save: async function () {
        mockDbState.winStreakTeam = this.winStreakTeam;
        mockDbState.winStreakCount = this.winStreakCount;
        mockDbState.lastSyncTimestamp = this.lastSyncTimestamp;
        mockDbState.lastScrambleTime = this.lastScrambleTime;
        mockDbState.scrambleOnRoundEndBy = this.scrambleOnRoundEndBy;
        mockDbState.manuallyDisabled = this.manuallyDisabled;
        mockDbState.consecutiveWinsTeam = this.consecutiveWinsTeam;
        mockDbState.consecutiveWinsCount = this.consecutiveWinsCount;
      },
    };
    return [instance, true];
  },
  findByPk: async () => {
    const instance = {
      ...mockDbState,
      save: async function () {
        mockDbState.winStreakTeam = this.winStreakTeam;
        mockDbState.winStreakCount = this.winStreakCount;
        mockDbState.lastSyncTimestamp = this.lastSyncTimestamp;
        mockDbState.lastScrambleTime = this.lastScrambleTime;
        mockDbState.scrambleOnRoundEndBy = this.scrambleOnRoundEndBy;
        mockDbState.manuallyDisabled = this.manuallyDisabled;
        mockDbState.consecutiveWinsTeam = this.consecutiveWinsTeam;
        mockDbState.consecutiveWinsCount = this.consecutiveWinsCount;
      },
    };
    return instance;
  },
};

const mockConnectors = {
  // Mock the database connector to prevent file system access and errors
  sqlite: {
    define: () => mockModel,
    transaction: async (fn) => {
      // Execute the callback immediately with a dummy transaction object
      return fn({
        commit: async () => {},
        rollback: async () => {},
        LOCK: { UPDATE: 'UPDATE' },
      });
    },
    query: async () => [], // tb-database initDB issues PRAGMA journal_mode=WAL etc.
    // Without this, initDB throws ("getDialect is not a function") and falls into its catch, so
    // mount() would only ever restore defaults and no restore-from-DB path would be covered.
    getDialect: () => 'sqlite',
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
  changeTeamRetryInterval: 150,
  maxScrambleCompletionTime: 5000,
  warnOnSwap: false,
  discordClient: null,
  discordAdminChannelID: null,
  discordReportChannelID: null,
  discordAdminRoleIDs: [],
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

  // Mock RconMessages and formatMessage as BasePlugin loading is bypassed/incomplete in test harness
  tb.RconMessages = {
    prefix: '[TB]',
    executeScrambleMessage: 'Scrambling teams!',
    executeDryRunMessage: 'Dry run scramble!',
    scrambleCompleteMessage: 'Scramble complete.',
    scrambleFailedMessage: 'Scramble failed.',
    manualScrambleAnnouncement: 'Manual scramble in {delay}s',
    immediateManualScramble: 'Scrambling now!',
    scrambleAnnouncement: 'Scramble in {delay}s after {count} dominant wins',
    singleRoundScramble: 'Single round scramble triggered.',
    matchEndScrambleAnnouncement: 'Match-end scramble in {delay}s',
    seedScrambleAnnouncement: 'Seed scramble in {delay}s',
    draw: 'Round ended in a Draw!',
    system: { trackingEnabled: 'Tracking enabled', trackingDisabled: 'Tracking disabled' },
    dominant: { stomped: 'Stomp', steamrolled: 'Steamrolled', invasionAttackStomp: 'Atk Stomp', invasionDefendStomp: 'Def Stomp' },
    nonDominant: { streakBroken: 'Streak Broken', invasionAttackWin: 'Atk Win', invasionDefendWin: 'Def Win', narrowVictory: 'Narrow', marginalVictory: 'Marginal', tacticalAdvantage: 'Tactical', operationalSuperiority: 'Operational' }
  };
  tb.formatMessage = (msg, params) => {
    if (!msg) return '';
    return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), msg);
  };

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
  const announcement = capturedBroadcasts.find((msg) => msg.includes('Scramble in'));
  assert(!!announcement, 'Scramble announcement broadcast was captured.');
  if (announcement) {
    assert(announcement.includes('1 dominant wins'), 'Announcement includes correct win count.');
  }

  // Test post-scramble reset
  // We can call executeScramble directly to test the reset logic.
  // Populate server with unbalanced teams to ensure scramble generates moves and triggers the success path.
  // Note: transformSquadJSData filters out players without eosID, so each mock player needs one.
  // Also need players on BOTH teams (heavily imbalanced) so the scrambler has somewhere to swap to.
  tb.server.players = [
    ...Array.from({ length: 9 }, (_, i) => ({
      eosID: `mock_eos_t1_${i}`,
      steamID: `765611980000000${i}`,
      name: `T1Player${i}`,
      teamID: 1,
      squadID: null,
      roles: ['Rifleman']
    })),
    {
      eosID: 'mock_eos_t2_0',
      steamID: '76561198000000099',
      name: 'T2Player0',
      teamID: 2,
      squadID: null,
      roles: ['Rifleman']
    }
  ];

  await tb.executeScramble(false); // isSimulated = false
  assert(tb.winStreakCount === 0, 'executeScramble resets the win streak count to 0.');
  assert(tb._scrambleInProgress === false, 'Scramble is no longer in progress after execution.');

  // --- Phase 3.5: !scramble matchend (deferred round-end scramble) ---
  console.log('\n[Phase 3.5: !scramble matchend]');

  // Armed flag is consumed at round end and initiates the (countdown) scramble + announcement.
  await tb.resetStreak();
  tb.manuallyDisabled = false;
  tb.options.enableWinStreakTracking = true;
  tb.gameModeCached = 'RAAS';
  capturedBroadcasts.length = 0;
  tb._scrambleOnRoundEnd = true;
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } }); // non-dominant: no auto-scramble
  assert(tb._scrambleOnRoundEnd === false, 'matchend: armed flag is consumed at round end.');
  assert(tb._scramblePending === true, 'matchend: a scramble is initiated at round end.');
  assert(!!capturedBroadcasts.find((m) => m.includes('Match-end scramble in')), 'matchend: round-end announcement is broadcast.');
  await tb.cancelPendingScramble(null, null, true);

  // Fires even when win-streak tracking is disabled (it's an explicit admin command).
  await tb.resetStreak();
  tb.manuallyDisabled = true;
  tb._scrambleOnRoundEnd = true;
  await tb.onRoundEnded({ winner: { team: 1, tickets: 400 }, loser: { tickets: 0 } });
  assert(tb._scramblePending === true, 'matchend: fires at round end even when tracking is disabled.');
  await tb.cancelPendingScramble(null, null, true);
  tb.manuallyDisabled = false;

  // If another scramble is already pending at round end, matchend must not double up (and not announce).
  tb._scrambleOnRoundEnd = true;
  tb._scramblePending = true;
  capturedBroadcasts.length = 0;
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  assert(tb._scrambleOnRoundEnd === false, 'matchend: flag consumed even when another scramble is pending.');
  assert(!capturedBroadcasts.find((m) => m.includes('Match-end scramble in')), 'matchend: no announcement when another scramble is already pending.');
  tb._scramblePending = false;

  // Command layer: arm via "!scramble matchend", then abort via "!scramble cancel".
  // requireScrambleConfirmation defaults to true and would divert the command into the confirmation gate.
  tb.options.requireScrambleConfirmation = false;
  tb._scrambleOnRoundEnd = false;
  await tb.onScrambleCommand({ message: 'matchend', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });
  assert(tb._scrambleOnRoundEnd === true, 'matchend: command arms the round-end flag.');
  // Survives a restart: the arm is persisted to the DB and reads back parsed (what mount() restores).
  assert(typeof mockDbState.scrambleOnRoundEndBy === 'string' && mockDbState.scrambleOnRoundEndBy.includes('admin1'), 'matchend: armed state is persisted to the DB.');
  const reloadedArm = tb.db._parseArm(mockDbState.scrambleOnRoundEndBy);
  assert(reloadedArm && reloadedArm.steamID === 'admin1', 'matchend: persisted arm reads back on reload (survives restart).');
  await tb.onScrambleCommand({ message: 'cancel', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });
  assert(tb._scrambleOnRoundEnd === false, 'matchend: "!scramble cancel" clears the armed flag.');
  assert(mockDbState.scrambleOnRoundEndBy === null, 'matchend: cancel clears the persisted arm too.');

  // "matchend" must not combine with "now"/"dry" (dry would bypass the confirmation gate and arm a live scramble).
  await tb.onScrambleCommand({ message: 'matchend dry', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });
  assert(tb._scrambleOnRoundEnd === false, 'matchend: "matchend dry" combo is rejected, nothing armed.');

  // A dry run must NOT disarm a scheduled end-of-round scramble.
  tb._scrambleOnRoundEnd = true;
  await tb.onScrambleCommand({ message: 'dry', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });
  assert(tb._scrambleOnRoundEnd === true, 'matchend: a dry run does not disarm the scheduled scramble.');
  tb._scrambleOnRoundEnd = false;
  tb.options.requireScrambleConfirmation = true; // restore default

  // A typo'd argument must be rejected outright. It used to fall through to the bare-"!scramble" path,
  // overwrite the pending "matchend" confirmation, and turn the next "confirm" into a LIVE mid-round scramble.
  const admin = { message: '', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } };
  tb.scrambleConfirmation = null;
  tb._scramblePending = false;
  capturedBroadcasts.length = 0;
  await tb.onScrambleCommand({ ...admin, message: 'matchend' });
  const typoReply = await tb.onScrambleCommand({ ...admin, message: 'confiirm' });
  assert(/Unknown argument/.test(typoReply || ''), 'typo: "confiirm" is rejected as an unknown argument.');
  assert(!!tb.scrambleConfirmation?.args?.includes('matchend'), 'typo: the pending matchend confirmation survives the typo.');
  await tb.onScrambleCommand({ ...admin, message: 'confirm' });
  assert(tb._scrambleOnRoundEnd === true, 'typo: "confirm" after a typo still arms the END-OF-ROUND scramble.');
  assert(tb._scramblePending === false, 'typo: no live mid-round scramble is started.');
  assert(capturedBroadcasts.length === 0, 'typo: nothing is broadcast to players (arming is silent, no countdown announcement).');
  await tb.onScrambleCommand({ ...admin, message: 'cancel' });

  // Match-identity gate: an arm carried across a restart into a LATER round is discarded (not fired),
  // and that round is still evaluated normally by the win-streak path (fall-through).
  await tb.resetStreak();
  tb.manuallyDisabled = false;
  tb.options.enableWinStreakTracking = true;
  tb.gameModeCached = 'RAAS';
  tb._scramblePending = false;
  capturedBroadcasts.length = 0;
  mockServer.matchStartTime = new Date(2000000); // this round (round B) started here
  tb._scrambleOnRoundEnd = true;
  tb._scrambleOnRoundEndBy = { steamID: 'admin1', name: 'Admin', matchStartTime: 1000000 }; // armed in round A
  await tb.onRoundEnded({ winner: { team: 1, tickets: 400 }, loser: { tickets: 0 } }); // dominant win in round B
  assert(tb._scrambleOnRoundEnd === false, 'matchend: an arm from a previous round (restart across a boundary) is discarded.');
  assert(!capturedBroadcasts.find((m) => m.includes('Match-end scramble in')), 'matchend: a stale cross-round arm does NOT scramble the wrong round.');
  assert(tb.winStreakCount === 1, 'matchend: after discarding a stale arm, the round is still evaluated normally (streak incremented).');

  // Restart WITHIN the same round: server.matchStartTime is recomputed as Date.now()-PLAYTIME (integer
  // seconds) on every poll, so it jitters by <1s across polls. The current value differs slightly from
  // the stamp but stays within tolerance → the arm must STILL fire (regression guard against strict-eq).
  await tb.resetStreak();
  tb._scramblePending = false;
  capturedBroadcasts.length = 0;
  mockServer.matchStartTime = new Date(3000450); // ~450ms intra-round jitter vs the stamp below
  tb._scrambleOnRoundEnd = true;
  tb._scrambleOnRoundEndBy = { steamID: 'admin1', name: 'Admin', matchStartTime: 3000000 }; // same round
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  assert(tb._scramblePending === true, 'matchend: an arm still fires when the round start is within jitter tolerance (restart within the same round).');
  assert(!!capturedBroadcasts.find((m) => m.includes('Match-end scramble in')), 'matchend: within-tolerance arm broadcasts the round-end announcement.');
  await tb.cancelPendingScramble(null, null, true);

  // Arming stamps the current round's start time onto the arm (and persists it).
  tb.options.requireScrambleConfirmation = false;
  mockServer.matchStartTime = new Date(4000000);
  tb._scrambleOnRoundEnd = false;
  await tb.onScrambleCommand({ message: 'matchend', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });
  assert(tb._scrambleOnRoundEndBy?.matchStartTime === 4000000, 'matchend: arming stamps the round start time onto the arm.');
  assert(tb.db._parseArm(mockDbState.scrambleOnRoundEndBy)?.matchStartTime === 4000000, 'matchend: the round stamp is persisted to the DB.');
  await tb.onScrambleCommand({ message: 'cancel', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });
  tb.options.requireScrambleConfirmation = true;
  delete mockServer.matchStartTime;

  // --- Phase 3.6: NEW_GAME discards a pending scramble countdown ---
  console.log('\n[Phase 3.6: NEW_GAME discards a pending countdown]');

  // A countdown armed in the previous round must not fire into the new one: at NEW_GAME the teams are
  // freshly assigned (and teamIDs stay null for 30-60s), so it would scramble the wrong round.
  // The timer, not _scramblePending, has to drive the cleanup: resetStreak() clears that flag on its
  // own right after the seed/streak paths arm the countdown, so the flag is already false here.
  await tb.resetStreak();
  tb._scramblePending = false;
  tb._scrambleInProgress = false;
  tb.options.scrambleAnnouncementDelay = 0.05; // 50ms countdown, fires while this test is still running
  let countdownExecutions = 0;
  tb.executeScramble = async () => {
    countdownExecutions++;
    return true;
  };
  await tb.initiateScramble(false, false);
  assert(!!tb._scrambleCountdownTimeout, 'newgame: initiateScramble arms a countdown timer.');
  tb._scramblePending = false; // simulate the flag going false while the countdown is still armed
  await tb.onNewGame({ layer: { gamemode: 'RAAS', name: 'Yehorivka_RAAS_v1' } });
  assert(!tb._scrambleCountdownTimeout, 'newgame: the pending countdown timer is cleared at NEW_GAME.');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert(countdownExecutions === 0, 'newgame: a countdown from the previous round does not execute in the new round.');
  delete tb.executeScramble;
  tb.options.scrambleAnnouncementDelay = defaultTestOptions.scrambleAnnouncementDelay;
  clearTimeout(tb._abbreviationPollStartTimeout); // onNewGame schedules abbreviation polling 5 min out

  // --- Phase 3.7: Seed auto-scramble (independent of win-streak tracking) ---
  console.log('\n[Phase 3.7: Seed auto-scramble]');

  // Capture what onRoundEnded actually reported for the round — the JSONL row and the DB row are
  // built from the same object, and the seed path's outcome fields live or die with it.
  const capturedReports = [];
  const realInsertRoundReport = tb.db.insertRoundReport.bind(tb.db);
  tb.db.insertRoundReport = async (row) => {
    capturedReports.push(row);
  };
  tb.options.enableDatabaseLogging = true;

  const seedRoundSetup = async () => {
    await tb.resetStreak();
    tb._scramblePending = false;
    tb._scrambleOnRoundEnd = false;
    tb.gameModeCached = 'Seed';
    tb.layerNameCached = 'Logar_Seed_v1';
    capturedBroadcasts.length = 0;
    capturedReports.length = 0;
  };

  // The fix: a Seed round ends while win-streak tracking is off in the config -> still scrambles.
  tb.options.enableWinStreakTracking = false;
  tb.manuallyDisabled = false;
  await seedRoundSetup();
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  assert(tb._scramblePending === true, 'seed: scrambles with enableWinStreakTracking = false.');
  assert(!!capturedBroadcasts.find((m) => m.includes('Seed scramble in')), 'seed: announcement is broadcast with tracking disabled.');
  await tb.cancelPendingScramble(null, null, true);

  // Also unaffected by the manual !teambalancer off toggle.
  tb.manuallyDisabled = true;
  await seedRoundSetup();
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  assert(tb._scramblePending === true, 'seed: scrambles even when manually disabled.');
  await tb.cancelPendingScramble(null, null, true);
  tb.manuallyDisabled = false;

  // A Seed round that ends without a winner (admin switches the layer mid-seed) must still scramble.
  await seedRoundSetup();
  await tb.onRoundEnded({});
  assert(tb._scramblePending === true, 'seed: scrambles on a Seed round that ends without a winner.');
  await tb.cancelPendingScramble(null, null, true);

  // Must not over-fire: a non-Seed round with tracking disabled stays silent.
  await seedRoundSetup();
  tb.gameModeCached = 'RAAS';
  tb.layerNameCached = 'Gorodok_RAAS_v1';
  await tb.onRoundEnded({ winner: { team: 1, tickets: 400 }, loser: { tickets: 0 } });
  assert(tb._scramblePending === false, 'seed: a non-Seed round does not scramble when tracking is disabled.');
  assert(capturedBroadcasts.length === 0, 'seed: a non-Seed round broadcasts nothing when tracking is disabled.');

  // Its own option still switches it off.
  tb.options.enableSeedAutoScramble = false;
  await seedRoundSetup();
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  assert(tb._scramblePending === false, 'seed: enableSeedAutoScramble = false suppresses the scramble.');
  assert(capturedBroadcasts.length === 0, 'seed: nothing is broadcast when enableSeedAutoScramble = false.');
  tb.options.enableSeedAutoScramble = true;

  // Never scrambles off a guessed layer: this round's layer never resolved, so the caches are
  // null and only lastKnownGoodLayer (the PREVIOUS round's Seed layer) is available.
  await seedRoundSetup();
  tb.gameModeCached = null;
  tb.layerNameCached = null;
  tb.lastKnownGoodLayer = { gamemode: 'Seed', name: 'Logar_Seed_v1' };
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  assert(tb._scramblePending === false, 'seed: a fallback (stale) layer does not trigger the seed scramble.');
  assert(capturedBroadcasts.length === 0, 'seed: nothing is broadcast when the layer is only a fallback guess.');
  tb.lastKnownGoodLayer = null;

  // Regression: the original path (tracking enabled) still fires.
  // The seed block returns, so _scramblePending survives — it must not fall through into
  // resetStreak('Ignored match ended'), which would clear it under an armed countdown.
  tb.options.enableWinStreakTracking = true;
  await seedRoundSetup();
  await tb.onRoundEnded({ winner: { team: 1, tickets: 400 }, loser: { tickets: 0 } });
  assert(tb._scramblePending === true, 'seed: still scrambles with tracking enabled (unchanged path).');
  assert(!!capturedBroadcasts.find((m) => m.includes('Seed scramble in')), 'seed: announcement is broadcast with tracking enabled.');
  await tb.cancelPendingScramble(null, null, true);

  // The early return must not cost the round its outcome data: the report is written by the
  // finally block for every path, so winner and tickets have to be parsed before the return.
  assert(capturedReports.length === 1, 'seed: the auto-scrambled round is still reported.');
  assert(capturedReports[0]?.winningTeamID === 1, 'seed report: winning team is recorded.');
  assert(capturedReports[0]?.winnerTickets === 400 && capturedReports[0]?.loserTickets === 0, 'seed report: ticket counts are recorded.');
  assert(capturedReports[0]?.ticketMargin === 400, 'seed report: ticket margin is recorded.');
  assert(capturedReports[0]?.winnerName === 'Team 1' && capturedReports[0]?.loserName === 'Team 2', 'seed report: team names are recorded.');
  assert(capturedReports[0]?.scrambleCondition === 'Seed Auto Scramble', 'seed report: the scramble is attributed to the seed trigger.');

  // A streak carried into the Seed round must not survive it. Asserted with a NON-zero streak:
  // seedRoundSetup() zeroes the counter, so asserting 0 after a fresh setup proves nothing.
  await seedRoundSetup();
  tb.winStreakTeam = 1;
  tb.winStreakCount = 1;
  tb.consecutiveWinsTeam = 1;
  tb.consecutiveWinsCount = 1;
  await tb.onRoundEnded({ winner: { team: 1, tickets: 400 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 0, 'seed: a carried-over win streak is reset by the Seed round.');
  assert(tb.consecutiveWinsCount === 0, 'seed: a carried-over consecutive-win count is reset too.');
  assert(tb._scramblePending === true, 'seed: resetting the streak does not disarm the countdown.');
  await tb.cancelPendingScramble(null, null, true);

  // Only for Seed rounds the operator excluded from tracking: take "Seed" out of ignoredGameModes
  // and the round must be streak-evaluated like any other mode instead of auto-scrambled.
  await seedRoundSetup();
  tb.options.ignoredGameModes = ['Jensen'];
  tb.options.maxWinStreak = 2; // Phase 3.4 left it at 1; a dominant win would trigger a scramble.
  await tb.onRoundEnded({ winner: { team: 1, tickets: 400 }, loser: { tickets: 0 } });
  assert(!capturedBroadcasts.find((m) => m.includes('Seed scramble in')), 'seed: no auto-scramble when Seed is not in ignoredGameModes.');
  assert(tb.winStreakCount === 1, 'seed: a non-ignored Seed round is win-streak evaluated instead.');
  assert(tb._scramblePending === false, 'seed: a non-ignored Seed round below the streak threshold arms nothing.');
  tb.options.ignoredGameModes = ['Seed', 'Jensen'];
  tb.options.maxWinStreak = 1;

  // "!teambalancer off" must not orphan an armed seed countdown: it calls resetStreak, which must
  // leave _scramblePending alone so the admin can still abort with "!scramble cancel".
  await seedRoundSetup();
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  assert(tb._scramblePending === true, 'off: precondition — a seed countdown is armed.');
  await tb.onChatCommand({ message: 'off', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });
  assert(tb._scramblePending === true, 'off: "!teambalancer off" leaves the armed countdown visible.');
  assert((await tb.cancelPendingScramble('admin1', null, true)) === true, 'off: the countdown can still be cancelled after "!teambalancer off".');
  await tb.onChatCommand({ message: 'on', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });

  // Tracking enabled + no winner: must scramble WITHOUT also reporting the round as a draw.
  await seedRoundSetup();
  await tb.onRoundEnded({});
  assert(tb._scramblePending === true, 'seed: a winner-less Seed round scrambles with tracking enabled.');
  assert(!capturedBroadcasts.find((m) => m.includes('Draw')), 'seed: a winner-less Seed round does not also broadcast the draw message.');
  await tb.cancelPendingScramble(null, null, true);

  // Another scramble already pending: no second announcement, no false report attribution, and
  // the round-end poller teardown still happens before the early return.
  await seedRoundSetup();
  tb._scramblePending = true;
  tb.startPollingTeamAbbreviations();
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  assert(!capturedBroadcasts.find((m) => m.includes('Seed scramble in')), 'seed: no announcement when another scramble is already pending.');
  assert(capturedReports.length === 1 && capturedReports[0].scrambleCondition === 'None', 'seed: a skipped scramble is still reported, without attribution.');
  assert(tb._teamAbbreviationPollingInterval === null, 'seed: pollers are stopped even when the scramble is skipped.');
  tb._scramblePending = false;

  // A Seed round never feeds the streak, even on the skip path — the old ignored-match branch
  // always reset, and the early return must not cost that.
  await seedRoundSetup();
  tb.winStreakTeam = 1;
  tb.winStreakCount = 1;
  tb._scramblePending = true;
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  assert(tb.winStreakCount === 0, 'seed: the streak is reset even when the scramble is skipped.');
  tb._scramblePending = false;

  // Duplicate ROUND_ENDED for the same round: the second one must not slip into the first one's
  // await windows and arm a second scramble. Fired without awaiting the first on purpose.
  await seedRoundSetup();
  const firstRound = tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  const duplicateRound = tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  await Promise.all([firstRound, duplicateRound]);
  assert(capturedBroadcasts.filter((m) => m.includes('Seed scramble in')).length === 1, 'reentrancy: a duplicate ROUND_ENDED announces only once.');
  assert(capturedReports.length === 1, 'reentrancy: a duplicate ROUND_ENDED writes only one round report.');
  assert(tb._roundEndInFlight === false, 'reentrancy: the in-flight guard is released afterwards.');
  await tb.cancelPendingScramble(null, null, true);

  // A throw AFTER a countdown was armed must not orphan the timer: the catch in onRoundEnded used
  // to drop _scramblePending on its own, which left the timer running but invisible to
  // cancelPendingScramble() — an admin could no longer abort a scramble that still fired.
  await seedRoundSetup();
  await tb.initiateScramble(false, false);
  assert(!!tb._scrambleCountdownTimeout, 'catch: precondition — a countdown is armed.');
  const realIsIgnoredMatch = tb.isIgnoredMatch.bind(tb);
  tb.isIgnoredMatch = () => {
    throw new Error('forced failure after the countdown was armed');
  };
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  tb.isIgnoredMatch = realIsIgnoredMatch;
  assert(tb._scrambleCountdownTimeout === null, 'catch: a throw clears the armed countdown timer, not just the flag.');
  assert(tb._scramblePending === false, 'catch: the pending flag and the timer end in the same state.');
  assert(tb._roundEndInFlight === false, 'catch: the in-flight guard is released after a throw.');

  // The armed match-end path tears the pollers down on BOTH branches — here the skip branch.
  await seedRoundSetup();
  tb.gameModeCached = 'RAAS';
  tb.layerNameCached = null;
  tb._scrambleOnRoundEnd = true;
  tb._scramblePending = true;
  tb.startPollingTeamAbbreviations();
  await tb.onRoundEnded({ winner: { team: 1, tickets: 50 }, loser: { tickets: 0 } });
  assert(tb._teamAbbreviationPollingInterval === null, 'matchend: pollers are stopped even when the armed scramble is skipped.');
  tb._scramblePending = false;
  tb._scrambleOnRoundEnd = false;

  // unmount() must not leave the pending flag latched — it kills the countdown timer, so nothing
  // would ever clear the flag again and every later trigger would refuse silently.
  tb._scramblePending = true;
  await tb.unmount();
  assert(tb._scramblePending === false, 'unmount: a pending scramble flag is cleared with the countdown it kills.');
  await tb.mount();
  tb._stopPolling(); // mount() restarted the abbreviation poller

  // Status surfaces must not claim the trigger is armed when ignoredGameModes cannot match Seed.
  tb.options.ignoredGameModes = ['Jensen'];
  assert(tb.seedAutoScrambleStatus() === 'OFF (Seed not in ignoredGameModes)', 'status: a Seed round outside ignoredGameModes is reported as not armed.');
  assert(tb.seedScrambleNote() === '', 'status: the "stays active" note is withheld when the trigger cannot fire.');
  tb.options.ignoredGameModes = ['Seed', 'Jensen'];
  assert(tb.seedAutoScrambleStatus() === 'ON (at Seed round end)', 'status: armed again once Seed is ignored.');

  // The seed note is admin-only: it belongs on the reply, not in the server-wide broadcast.
  capturedBroadcasts.length = 0;
  const offReply = await tb.onChatCommand({ message: 'off', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });
  assert(/Seed auto-scramble stays active/.test(offReply || ''), 'off: the admin reply carries the seed note.');
  assert(!capturedBroadcasts.find((m) => m.includes('Seed auto-scramble')), 'off: the server-wide broadcast does not leak the seed note to players.');
  const statusReply = await tb.onChatCommand({ message: 'status', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });
  assert(/Seed Auto Scramble:/.test(statusReply || ''), 'status: the status block reports the seed trigger.');
  await tb.onChatCommand({ message: 'on', chat: 'ChatAdmin', steamID: 'admin1', player: { name: 'Admin', steamID: 'admin1' } });

  // Restore defaults for any phase added after this one.
  tb.db.insertRoundReport = realInsertRoundReport;
  tb.options.enableDatabaseLogging = false;
  tb.gameModeCached = 'RAAS';
  tb.layerNameCached = null;
  tb.manuallyDisabled = false;
  tb.options.enableWinStreakTracking = true;
  tb.options.enableSeedAutoScramble = true;

  // --- Final Report ---
  console.log(`\n🏁 All logic tests completed. Result: ${passCount}/${testCount} passed.`);
  if (passCount !== testCount) {
    console.error('⚠️ Some logic tests failed. Please review the output.');
  }
}

runPluginLogicTests().catch(console.error);