/**
 * Regression test: cross-clan virtual squad decomposition.
 * 
 * Verifies that when two different clan groups have members in separate
 * physical squads and a third clan spans both of those squads, virtual
 * squad construction does NOT decompose prior clans' already-built
 * virtual squads.
 * 
 * Topology:
 *   Team 1, Squad 3:   Clan A (large) + Clan C member 1 + fillers
 *   Team 1, Command:   Clan B (small) + Clan C member 2 + fillers
 *   Team 2, Squad 7:   Opposing players
 * 
 * Processing order (largest clan first):
 *   1. Clan A → claims Squad 3 fully (pullEntireSquads)
 *   2. Clan B → claims Command Squad fully (pullEntireSquads)
 *   3. Clan C → members in BOTH claimed squads
 *      - Without the fix: "others" loop extracts Clan C's members from
 *        the prior clans' virtual squads, decomposing them into independent
 *        candidate entries → squad division.
 *      - With the fix: claimed squads are skipped → squads stay atomic.
 */

import { Scrambler } from '../utils/tb-scrambler.js';
import { extractClanGroups } from '../utils/tb-clan-grouping.js';
import {
  generateMockPlayers,
  generateMockSquads,
  transformForScrambler
} from './mock-data-generator.js';

export async function runCrossClanSquadDecompositionTest({ runs = 30 } = {}) {
  console.log('\n--------------------------------------------------');
  console.log('🧪 TEST: Cross-Clan Virtual Squad Decomposition');

  let dividedCount = 0;
  let squadDividedCount = 0;
  let duplicateCount = 0;

  for (let run = 0; run < runs; run++) {
    // Build a full 80-player layout with three clans spanning two squads.
    const players = generateMockPlayers(80, 0.5, 0);
    const squads = generateMockSquads(players);

    // Find two squads on Team 1 that can host our clans.
    const t1Squads = squads.filter(s => s.teamID === 1);
    if (t1Squads.length < 2) throw new Error('Need at least 2 squads on Team 1');
    const [squadA, squadB] = t1Squads.slice(0, 2);

    // Reassign players so Squad A and Squad B each have enough room.
    // Squad A: 12 players (9 clan A + 1 clan C + 2 filler)
    // Squad B: 6 players  (3 clan B + 1 clan C + 2 filler)
    const t1Players = players.filter(p => p.teamID === 1);
    
    // Squash Squad A to 12 and Squad B to 6 by reassigning extras.
    for (const p of t1Players) {
      p.squadID = null;
    }
    for (let i = 0; i < 12; i++) t1Players[i].squadID = squadA.squadID;
    for (let i = 12; i < 18; i++) t1Players[i].squadID = squadB.squadID;
    // Rest stay unassigned or in other squads.

    // Tag names with clan prefixes.
    const tagPlayer = (idx, name) => {
      t1Players[idx].name = name;
    };

    // Squad A: Clan A members (9) — use distinct tags that merge at distance 1.
    const clanATags = ['[ACE]','[ACe]','[aCE]','[SPA]','[SPa]','[ACE]','[ACE]','[ACE]','[ACE]'];
    for (let i = 0; i < 9; i++) tagPlayer(i, `${clanATags[i]} MemberA${i}`);

    // Squad A: Clan C member 1 (1) — CRITICAL: this clan spans BOTH squads.
    tagPlayer(9, '[MTX] CrossClanMember1');

    // Squad A filler (2)
    tagPlayer(10, `FillerA1`);
    tagPlayer(11, `FillerA2`);

    // Squad B: Clan B members (3) — separate group.
    tagPlayer(12, '[BCD] MemberB1');
    tagPlayer(13, '[BCD] MemberB2');
    tagPlayer(14, '[BCD] MemberB3');

    // Squad B: Clan C member 2 (1) — CRITICAL: spans both squads.
    tagPlayer(15, '[MTX] CrossClanMember2');

    // Squad B filler (2)
    tagPlayer(16, `FillerB1`);
    tagPlayer(17, `FillerB2`);

    // Rebuild squads with updated squadIDs.
    const updatedSquads = generateMockSquads(players);
    // Lock Command Squad (squadB)
    updatedSquads.forEach(s => {
      if (s.teamID === 1 && s.squadID === squadB.squadID) s.locked = true;
    });

    const { squads: tfSquads, players: tfPlayers } = transformForScrambler(players, updatedSquads);

    // Build ELO map.
    const eloMap = new Map();
    for (const p of tfPlayers) {
      eloMap.set(p.eosID, { mu: 25.0 + Math.random() * 8, roundsPlayed: Math.floor(Math.random() * 20) });
    }

    // Extract clan groups (use raw players for clan extraction).
    const rawPlayersForExtraction = players.map(p => ({
      eosID: p.eosID,
      name: p.name,
      teamID: p.teamID
    }));

    const clanGroups = extractClanGroups(rawPlayersForExtraction, {
      minSize: 2, maxSize: 18, maxEditDistance: 1,
      caseSensitive: false, // case-insensitive so [ACE]/[ACe]/[aCE] all merge
      ignoreList: []
    });

    // Run scrambler.
    const result = await Scrambler.scrambleTeamsPreservingSquads({
      squads: tfSquads, players: tfPlayers,
      winStreakTeam: 1, scramblePercentage: 0.5,
      eloMap, clanGroups, pullEntireSquads: true
    });

    const moveSet = new Set(result.map(m => m.eosID));

    // Check virtual squads for division. Merged clans share one entry, so a player showing up
    // in two entries means the report would list them twice — the exact bug the merge path
    // used to produce by handing every absorbed tag the merged roster.
    if (result.virtualSquads) {
      const seenInVirtual = new Set();
      for (const vs of result.virtualSquads) {
        for (const id of [...vs.members, ...vs.pulled]) {
          if (seenInVirtual.has(id)) duplicateCount++;
          seenInVirtual.add(id);
        }
      }
      for (const vs of result.virtualSquads) {
        const allRoster = [...new Set([...vs.members, ...vs.pulled])];
        const moved = allRoster.filter(id => moveSet.has(id));
        const stayed = allRoster.filter(id => !moveSet.has(id));
        if (moved.length > 0 && stayed.length > 0) {
          dividedCount++;
        }
      }
    }

    // Check physical squad integrity on Team 1.
    for (const s of updatedSquads) {
      if (s.teamID !== 1) continue;
      const squadPlayers = players.filter(p => p.squadID === s.squadID && p.teamID === 1);
      const moved = squadPlayers.filter(p => moveSet.has(p.eosID));
      const stayed = squadPlayers.filter(p => !moveSet.has(p.eosID));
      if (moved.length > 0 && stayed.length > 0) {
        squadDividedCount++;
      }
    }
  }

  console.log(`   Cross-clan squad decomposition: ${dividedCount}/${runs} virtual divisions`);
  console.log(`   Cross-clan physical squad damage: ${squadDividedCount}/${runs}`);
  console.log(`   Players in more than one virtual squad: ${duplicateCount}`);

  const pass = dividedCount === 0 && squadDividedCount === 0 && duplicateCount === 0;
  console.log(`   ${pass ? '✅' : '❌'} ${pass ? 'No decomposition — squads stay atomic, rosters disjoint' : 'Squad decomposition or duplicate roster entries detected!'}`);

  return { pass, dividedCount, squadDividedCount, duplicateCount, runs };
}

/**
 * Regression test: a clan whose members sit entirely inside a prior clan's virtual squad.
 *
 * That is the anchor fallback in tb-scrambler.js — the only contributing candidate is already
 * claimed, so the new unit is built on top of the earlier one and the earlier squad never
 * appears in `others`. Deterministic, so one run is enough.
 *
 * Both tags must survive on the merged unit and every real clan member must count as a member,
 * not as someone the squad pulled along: the Discord report names the block after `tags` and
 * marks `members` with ◆, `pulled` with ◇.
 */
export async function runAnchorFallbackTagTest() {
  console.log('\n--------------------------------------------------');
  console.log('🧪 TEST: Anchor fallback keeps both clans\' tags');

  const clanned = ['a1', 'a2', 'a3', 'b1', 'b2', 'f1'];
  const filler = (prefix, n, squadID, teamID) =>
    Array.from({ length: n }, (_, i) => ({ eosID: `${prefix}${i}`, teamID, squadID }));
  const players = [
    ...clanned.map((eosID) => ({ eosID, teamID: '1', squadID: 'T1-S1' })),
    ...filler('x', 8, 'T1-S2', '1'),
    ...filler('y', 10, 'T2-S1', '2')
  ];
  const squadOf = (id) => players.filter((p) => p.squadID === id).map((p) => p.eosID);
  const squads = ['T1-S1', 'T1-S2', 'T2-S1'].map((id) => ({
    id, teamID: id.startsWith('T1') ? '1' : '2', players: squadOf(id), locked: false
  }));

  const result = await Scrambler.scrambleTeamsPreservingSquads({
    squads, players, winStreakTeam: 1, scramblePercentage: 0.5,
    clanGroups: { AAA: ['a1', 'a2', 'a3'], BBB: ['b1', 'b2'] },
    pullEntireSquads: true
  });

  const unit = (result.virtualSquads || []).find((vs) => vs.teamID === '1');
  const tags = [...(unit?.tags || [])].sort();
  const members = [...(unit?.members || [])].sort();
  const tagsOk = tags.join(',') === 'AAA,BBB';
  const membersOk = members.join(',') === 'a1,a2,a3,b1,b2';
  const pulledOk = (unit?.pulled || []).join(',') === 'f1';

  console.log(`   Units on team 1:  ${(result.virtualSquads || []).filter((v) => v.teamID === '1').length} (expected 1)`);
  console.log(`   Tags on the unit: [${tags.join(', ')}] (expected [AAA, BBB])`);
  console.log(`   Clan members:     [${members.join(', ')}] (expected all five)`);
  console.log(`   Pulled along:     [${(unit?.pulled || []).join(', ')}] (expected f1)`);

  const pass = !!unit && tagsOk && membersOk && pulledOk;
  console.log(`   ${pass ? '✅' : '❌'} ${pass ? 'Merged unit keeps every tag and every member' : 'A clan tag or its members were lost on the fallback anchor!'}`);

  return { pass, tags, members };
}
