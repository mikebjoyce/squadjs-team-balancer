/**
 * Generates mock player data for testing the TeamBalancer.
 * @param {number} count - Total number of players to generate.
 * @param {number} team1Ratio - Ratio of players on Team 1 (0.0 to 1.0). Default 0.5.
 * @returns {Array} Array of player objects.
 */
export function generateMockPlayers(count = 50, team1Ratio = 0.5, unassignedRatio) {
  const players = [];
  const team1Count = Math.floor(count * team1Ratio);

  // If unassignedRatio is not provided, default to a random value between 0% and 5% to simulate mostly packed servers.
  const effectiveUnassignedRatio =
    typeof unassignedRatio === 'number' ? unassignedRatio : Math.random() * 0.05;

  for (let i = 0; i < count; i++) {
    const teamID = i < team1Count ? 1 : 2;
    let squadID = null;
    if (Math.random() >= effectiveUnassignedRatio) {
      // Weighted squad assignment to create realistic size distribution
      const rand = Math.random();
      if (rand < 0.2) { // 20% of players go into 3 specialized squads (armor/heli) -> small squads
        squadID = Math.floor(Math.random() * 3) + 1;
      } else { // 80% of players go into 4 infantry squads -> large squads
        squadID = Math.floor(Math.random() * 4) + 4;
      }
    }

    players.push({
      eosID: `mock_eos_${i}`,
      name: `TestPlayer${i}`,
      teamID: teamID,
      squadID: squadID
    });
  }
  return players;
}

/**
 * Groups players into squad objects based on their squadID.
 * @param {Array} players - The array of mock players.
 * @returns {Array} Array of squad objects.
 */
export function generateMockSquads(players) {
  const squadMap = new Map();

  players.forEach((p) => {
    if (p.squadID) {
      const key = `${p.teamID}-${p.squadID}`;
      if (!squadMap.has(key)) {
        // Specialized squads (e.g., armor/heli) are more likely to be locked.
        const isSpecialized = p.squadID <= 3;
        const lockChance = isSpecialized ? 0.8 : 0.5; // 80% for specialized, 50% for infantry

        squadMap.set(key, {
          squadID: p.squadID,
          teamID: p.teamID,
          players: [],
          // Increased lock rate to ~60% average to match real-world scenarios.
          locked: Math.random() < lockChance
        });
      }
      squadMap.get(key).players.push(p.eosID);
    }
  });

  return Array.from(squadMap.values());
}

/**
 * Transforms mock data into the format expected by Scrambler.scrambleTeamsPreservingSquads.
 * Matches the logic in TeamBalancer.transformSquadJSData.
 */
export function transformForScrambler(mockPlayers, mockSquads) {
  // Transform Squads
  const transformedSquads = mockSquads.map((squad) => ({
    id: `T${squad.teamID}-S${squad.squadID}`,
    teamID: String(squad.teamID),
    players: squad.players, // Already array of eosIDs
    locked: squad.locked
  }));

  // Transform Players
  const transformedPlayers = mockPlayers.map((player) => ({
    eosID: player.eosID,
    teamID: String(player.teamID),
    squadID: player.squadID ? `T${player.teamID}-S${player.squadID}` : null
  }));

  return {
    squads: transformedSquads,
    players: transformedPlayers
  };
}

/**
 * Applies clan-tag prefixes to a subset of mock players in-place.
 * Each injection: { tag, count, teamID, squadID?, delimiter? }
 *   - tag: clan tag string (e.g. 'AAA')
 *   - count: how many players to tag
 *   - teamID: 1 or 2 (which team to draw from)
 *   - squadID: optional, places the tagged players in this squadID on the team.
 *     If fewer than `count` untagged players are already in that squadID,
 *     untagged same-team players are reassigned (their squadID is overwritten)
 *     to the target squadID to fulfil the request.
 *   - delimiter: optional 2-char string with opening + closing delimiter
 *     (default '[]'). Use '<>', '()', '{}' for other bracket styles.
 *     Pass a 1-char string (e.g. '[') to use only an opening delimiter
 *     (no close), simulating malformed names.
 *
 * Throws if the team doesn't have enough untagged players to satisfy the request.
 *
 * NOTE: When using `squadID`, callers should rebuild the squads array AFTER
 * injection (e.g. `generateMockSquads(players)`), since squad membership may
 * have changed.
 *
 * Returns the array of mutated players for chaining.
 */
export function injectClanTags(players, injections) {
  const tagged = new Set();
  for (const { tag, count, teamID, squadID, delimiter = '[]' } of injections) {
    const open = delimiter[0] ?? '';
    const close = delimiter[1] ?? '';
    const untaggedSameTeam = players.filter(
      (p) => p.teamID === teamID && !tagged.has(p.eosID)
    );
    if (untaggedSameTeam.length < count) {
      throw new Error(
        `injectClanTags: cannot place ${count} ${open}${tag}${close} on team ${teamID} — only ${untaggedSameTeam.length} untagged players available.`
      );
    }

    // Prefer players already in the target squad to minimize reassignment.
    const inSquad = typeof squadID !== 'undefined'
      ? untaggedSameTeam.filter((p) => p.squadID === squadID)
      : untaggedSameTeam;
    const needFromOutside = Math.max(0, count - inSquad.length);
    const fromOutside = typeof squadID !== 'undefined'
      ? untaggedSameTeam.filter((p) => p.squadID !== squadID).slice(0, needFromOutside)
      : [];

    const chosen = [...inSquad.slice(0, count), ...fromOutside];
    for (const p of chosen) {
      if (typeof squadID !== 'undefined') p.squadID = squadID;
      p.name = `${open}${tag}${close}${p.name}`;
      tagged.add(p.eosID);
    }
  }
  return players;
}

/**
 * Scenario: clan members already together on Team 1 spread across 3 squads.
 * Clan [AAA] has 5 members: 2 in squad 4, 2 in squad 5, 1 in squad 6.
 * Expectation: with grouping enabled, all 5 [AAA] members end up on the same team.
 */
export function generateScenario_ClanGrouping() {
  const players = generateMockPlayers(80, 0.5, 0);
  injectClanTags(players, [
    { tag: 'AAA', count: 2, teamID: 1, squadID: 4 },
    { tag: 'AAA', count: 2, teamID: 1, squadID: 5 },
    { tag: 'AAA', count: 1, teamID: 1, squadID: 6 },
    { tag: 'BBB', count: 3, teamID: 1, squadID: 7 },
    { tag: 'CCC', count: 3, teamID: 2, squadID: 4 },
    { tag: 'CCC', count: 2, teamID: 2, squadID: 5 }
  ]);
  const squads = generateMockSquads(players);
  return { players, squads };
}

/**
 * Scenario: clan split across teams (3 on T1, 3 on T2). Each side's 3 should
 * stay together with itself, but cross-team consolidation is NOT required.
 */
export function generateScenario_ClanSplitAcrossTeams() {
  const players = generateMockPlayers(80, 0.5, 0);
  injectClanTags(players, [
    { tag: 'SPL', count: 2, teamID: 1, squadID: 4 },
    { tag: 'SPL', count: 1, teamID: 1, squadID: 5 },
    { tag: 'SPL', count: 2, teamID: 2, squadID: 4 },
    { tag: 'SPL', count: 1, teamID: 2, squadID: 5 }
  ]);
  const squads = generateMockSquads(players);
  return { players, squads };
}

/**
 * Scenario: similar clan tags within edit distance 1 should merge.
 * [CLAN] x3 + [CLAM] x2 on T1 (edit distance 1) -> should merge to one group of 5.
 * [TBG]  x2 + [TBx]  x2 on T1 (edit distance 1) -> should merge to one group of 4.
 * [XYZ] x3 standalone.
 * [ABC] x2 + [Abc] x2 (edit distance 2) -> NOT merged at threshold 1.
 */
export function generateScenario_ClanSimilarity() {
  const players = generateMockPlayers(80, 0.5, 0);
  injectClanTags(players, [
    { tag: 'CLAN', count: 3, teamID: 1, squadID: 4 },
    { tag: 'CLAM', count: 2, teamID: 1, squadID: 5 },
    { tag: 'TBG',  count: 2, teamID: 1, squadID: 6 },
    { tag: 'TBx',  count: 2, teamID: 1, squadID: 7 },
    { tag: 'XYZ',  count: 3, teamID: 2, squadID: 4 },
    { tag: 'ABC',  count: 2, teamID: 2, squadID: 5 },
    { tag: 'Abc',  count: 2, teamID: 2, squadID: 6 }
  ]);
  const squads = generateMockSquads(players);
  return { players, squads };
}

/**
 * Scenario: low-pop server with a 15-member clan spread across three squads
 * on Team 1, paired with a low scramble percentage. With Phase 1's fixed
 * 3-player grace and a per-side target of ~6 (60 players × 0.2), a 15-player
 * virtual squad can never fit the target window atomically — Phase 1 skips
 * it. The clan members stay together vacuously (they all started on T1 and
 * nobody touches them); the algorithm balances by moving smaller non-clan
 * squads. Cohesion is preserved without atomically swapping the clan.
 *
 * Uses generateMockPlayers + injectClanTags. injectClanTags reassigns squadIDs
 * if needed to reach the requested count, so we always get exactly 15 [BIG]s.
 */
export function generateScenario_LowPopLargeClan() {
  const players = generateMockPlayers(60, 0.5, 0);
  injectClanTags(players, [
    { tag: 'BIG', count: 5, teamID: 1, squadID: 4 },
    { tag: 'BIG', count: 5, teamID: 1, squadID: 5 },
    { tag: 'BIG', count: 5, teamID: 1, squadID: 6 }
  ]);
  const squads = generateMockSquads(players);
  return { players, squads };
}

/**
 * Scenario: clan tags containing special characters covering the full
 * regex character class (dash, underscore, dot, ampersand, pipe, plus,
 * equals, asterisk, hash, at).
 * Verifies the regex extracts each kind correctly and grouping treats
 * them as normal tags. Includes a similarity-merge case across special
 * chars (`[7-CAV]` + `[7-CV]` differ by deletion of one 'A' → distance 1).
 */
export function generateScenario_ClanSpecialChars() {
  const players = generateMockPlayers(120, 0.5, 0);
  injectClanTags(players, [
    { tag: '7-CAV', count: 3, teamID: 1, squadID: 4 },   // dash
    { tag: '7-CV',  count: 2, teamID: 1, squadID: 5 },   // distance 1 from 7-CAV (delete 'A')
    { tag: 'H_M',   count: 2, teamID: 1, squadID: 6 },   // underscore
    { tag: 'H&M',   count: 2, teamID: 1, squadID: 7 },   // ampersand
    { tag: 'A|B',   count: 2, teamID: 2, squadID: 4 },   // pipe
    { tag: 'B.A.D', count: 3, teamID: 2, squadID: 5 },   // dots
    { tag: 'TOP+',  count: 2, teamID: 2, squadID: 6 },   // plus
    { tag: '*TOP*', count: 2, teamID: 2, squadID: 7 },   // asterisks
    { tag: '#1ST',  count: 2, teamID: 1, squadID: 8 },   // hash
    { tag: '@HQ',   count: 2, teamID: 2, squadID: 8 }    // at
  ]);
  const squads = generateMockSquads(players);
  return { players, squads };
}

/**
 * Scenario: clan tags using different delimiter styles, including no delimiter
 * at all. Verifies that `[`, `<`, `(`, `{` are all recognized as optional
 * opening delimiters and that bare-prefix tags (no wrapper) also extract.
 */
export function generateScenario_ClanDelimiters() {
  const players = generateMockPlayers(80, 0.5, 0);
  injectClanTags(players, [
    { tag: 'BRK',  count: 3, teamID: 1, squadID: 4, delimiter: '[]' },  // square brackets
    { tag: 'ANG',  count: 2, teamID: 1, squadID: 5, delimiter: '<>' },  // angle brackets
    { tag: 'PAR',  count: 2, teamID: 1, squadID: 6, delimiter: '()' },  // parens
    { tag: 'CRL',  count: 2, teamID: 1, squadID: 7, delimiter: '{}' },  // curly braces
    { tag: 'BARE', count: 3, teamID: 2, squadID: 4, delimiter: '' },    // no delimiter at all
    { tag: 'OPN',  count: 2, teamID: 2, squadID: 5, delimiter: '[' }    // open-only (no close)
  ]);
  const squads = generateMockSquads(players);
  return { players, squads };
}

/**
 * Scenario: real-world Squad name patterns. Verifies the regex extracts
 * tags correctly across the variety of formats actually seen on servers:
 *   - bracketed with spaces: `[QRZ] Steel Hawks`
 *   - bare with separator: `KqXz | Korvath`
 *   - bracketed with Unicode: `[QZ℘] Voidstomper`, `[KΛZ] iTxBlueFlame`
 *   - bracketed with trademark: `[XQR]™ Drazo`
 *   - Unicode bare prefix (no bracket / no separator): `KΛZ Korven`,
 *     `♣ΛCE Wurstwasser` — caught by the bare-prefix fallback (Strategy 5).
 *
 * Hand-built (no random mock generation) because exact name reproduction
 * matters for the assertions, and Unicode chars don't compose cleanly
 * with the random TestPlayerN naming.
 */
export function generateScenario_RealWorldNames() {
  const players = [];
  const push = (i, teamID, squadID, name) => {
    players.push({ eosID: `rw_${i}`, name, teamID, squadID });
  };

  // [QRZ] x3 on Team 1 squad 4
  push(0, 1, 4, '[QRZ] Steel Hawks');
  push(1, 1, 4, '[QRZ] Vasha');
  push(2, 1, 4, '[QRZ] Vexlund');

  // KqXz x2 on Team 1 squad 5 (bare with pipe separator)
  push(3, 1, 5, 'KqXz | Korvath');
  push(4, 1, 5, 'KqXz | Drava');

  // JX x3 on Team 1 squad 6 (bare, very short tag)
  push(5, 1, 6, 'JX |  Drazark');
  push(6, 1, 6, 'JX | K1L3R');
  push(7, 1, 6, 'JX | Drazgrim');

  // QZ℘ x2 on Team 2 squad 4 (Unicode math symbol)
  push(8, 2, 4, '[QZ℘]  Voidstomper');
  push(9, 2, 4, '[QZ℘] Cravo');

  // KΛZ x3 on Team 2 squad 5 (Unicode Greek capital lambda) — mix of
  // bracketed and bare. The bracketed pair matches strategy 1; the bare
  // `KΛZ Korven` matches strategy 5 (bare-prefix fallback). All three
  // produce the same key `KΛZ` and group together.
  push(10, 2, 5, '[KΛZ] iTxBlueFlame');
  push(11, 2, 5, '[KΛZ] Vexreon');
  push(12, 2, 5, 'KΛZ Korven');

  // [XQR] x2 on Team 2 squad 6 (trademark suffix, also tests close-bracket termination)
  push(13, 2, 6, '[XQR]™ Drazo');
  push(14, 2, 6, '[XQR]™ Krazek');

  // ♣ΛCE x3 on Team 2 squad 10 — exotic Unicode (card-suit + Greek + euro).
  // Bracketed pair + bare prefix. Strategy 1 captures `♣ΛCE` and `♣ΛC€`
  // from the bracketed names; strategy 5 captures `♣ΛCE` from the bare
  // one. The Real-world test runs with `maxEditDistance: 1`, so the
  // `♣ΛC€` variant merges into `♣ΛCE` (Levenshtein 1) and all three
  // players group together. In `caseSensitive: false` deployments the
  // `€ → e` entry in NON_ASCII_MAP would also collapse them.
  push(15, 2, 10, '[♣ΛCE] Hans_Wurst');
  push(16, 2, 10, '[♣ΛC€] Mr.Monopol');
  push(17, 2, 10, '♣ΛCE Wurstwasser');

  // Filler players with VARIED first chars so they don't accidentally
  // group as a single 7-char prefix clan (which would happen if everyone
  // were named e.g. `T1FillerN`). This keeps the test focused on the
  // real-world tag extraction behavior rather than the false-positive
  // grouping documented in the regex caveats.
  const fillerNames = [
    'Alex', 'Mike', 'John', 'Pete', 'Sam', 'Tim', 'Bob', 'Dan',
    'Joe', 'Ron', 'Tom', 'Max', 'Liu', 'Eve', 'Zoe', 'Kai',
    'Ana', 'Leo', 'Ivy', 'Pat', 'Ben', 'Cal', 'Dex', 'Eli',
    'Fox', 'Gus', 'Hal', 'Ira', 'Jay', 'Kim'
  ];
  for (let i = 0; i < 15; i++) push(18 + i, 1, 7, `${fillerNames[i]}_${i}`);
  for (let i = 0; i < 15; i++) push(33 + i, 2, 7, `${fillerNames[15 + i]}_${i}`);

  const squads = generateMockSquads(players);
  return { players, squads };
}

/**
 * Scenario: clan with only 1 same-team member is below the floor and must be ignored.
 */
export function generateScenario_ClanBelowMin() {
  const players = generateMockPlayers(60, 0.5, 0);
  injectClanTags(players, [
    { tag: 'SOLO', count: 1, teamID: 1, squadID: 4 }
  ]);
  const squads = generateMockSquads(players);
  return { players, squads };
}

/**
 * Generates a scenario where EVERY squad is locked.
 */
export function generateScenario_AllLocked(count = 100, team1Ratio = 0.8) {
  const players = generateMockPlayers(count, team1Ratio, 0); // 0 unassigned to force squad moves
  const squads = generateMockSquads(players);
  
  // Force lock all squads
  squads.forEach(s => s.locked = true);

  return { players, squads };
}

/**
 * Generates "David vs Goliath": Team 1 has one massive unlocked squad, Team 2 has small locked squads.
 * Used to test surgical splitting of the large squad.
 */
export function generateScenario_DavidGoliath() {
  const players = [];
  
  // Team 1: 1 Massive Squad of 9 (Unlocked)
  for (let i = 0; i < 9; i++) {
    players.push({ eosID: `t1_giant_${i}`, name: `Giant_${i}`, teamID: 1, squadID: 1 });
  }
  
  // Team 1: Fill with some small locked squads to create bulk (e.g., 21 more players = 30 total)
  for (let i = 0; i < 21; i++) {
    const squadID = 2 + Math.floor(i / 3); // Squads of 3
    players.push({ eosID: `t1_filler_${i}`, name: `Filler_${i}`, teamID: 1, squadID: squadID });
  }

  // Team 2: 10 players in small locked squads (Squads of 2)
  for (let i = 0; i < 10; i++) {
    const squadID = 100 + Math.floor(i / 2);
    players.push({ eosID: `t2_small_${i}`, name: `Small_${i}`, teamID: 2, squadID: squadID });
  }

  const squads = generateMockSquads(players);

  // Apply Locks: Unlock T1-S1, Lock everything else
  squads.forEach(s => {
    if (s.teamID === 1 && s.squadID === 1) s.locked = false;
    else s.locked = true;
  });

  return { players, squads };
}