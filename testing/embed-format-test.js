/**
 * Scramble-report embed formatting check.
 *
 * Standalone assertions for DiscordHelpers.createScrambleDetailsMessage: one row per listed
 * player, virtual squads rendered as a single block per team ahead of the regular squads, no
 * player listed twice, and no embed field over Discord's 1024-character limit.
 *
 * Needs a SquadJS-style layout so `../../core/logger.js` resolves, plus a package.json marking
 * the tree as ESM — both of which SquadJS provides in production. This builds them inside the
 * container, so nothing is written to the repo (add --print to dump a sample embed):
 *
 *   docker run --rm -v "$PWD":/src:ro node:20 sh -c 'mkdir -p /work/core \
 *     && cp -r /src /work/app \
 *     && echo "{\"type\":\"module\"}" > /work/app/package.json \
 *     && echo "export default { verbose() {} };" > /work/core/logger.js \
 *     && cd /work/app && node testing/embed-format-test.js'
 */
import assert from 'assert';
import { DiscordHelpers } from '../utils/tb-discord-helpers.js';

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${label}\n      ${err.message}`);
  }
};

const player = (eosID, name, teamID, squadID) => ({ eosID, name, teamID, squadID, steamID: eosID });

const makeBalancer = (players, squads) => ({
  server: { players, squads },
  getTeamName: (id) => (String(id) === '1' ? 'USA' : 'RGF')
});

const withPlan = (moves, extras = {}) => {
  const plan = [...moves];
  plan.calculationTime = 42;
  Object.assign(plan, extras);
  return plan;
};

const isVirtual = (f) => f.name.includes('Clan Grouping');
const virtualFields = (e) => e.fields.filter(isVirtual);
const regularFields = (e) => e.fields.filter((f) => f.name.includes('➔') && !isVirtual(f));
const linesOf = (f) => f.value.replace(/```text\n?|\n?```/g, '').split('\n');
// Player rows are indented by two spaces; block headers are not, separators are blank.
const rowsIn = (fields) => fields.flatMap(linesOf).filter((l) => l.startsWith('  ') && l.trim());

// ─── Fixture: a [3DP] virtual squad spanning Alpha and Bravo, plus unrelated movers ───
const CLAN_PLAYERS = [
  player('e1', '[3DP] Sparrow', '1', '1'),
  player('e2', '[3DP] Kovacs', '1', '1'),
  player('e3', 'Halloway', '1', '1'),   // pulled along: shares Alpha with the clan
  player('e6', '[3DP] Okonkwo', '1', '2'), // clan member sitting in Bravo
  player('e4', 'Bennett', '1', '2'),    // plain Bravo mover
  player('e5', 'Ridley', '2', '3')      // plain mover, other direction
];
const CLAN_SQUADS = [
  { squadID: '1', teamID: '1', squadName: 'Alpha' },
  { squadID: '2', teamID: '1', squadName: 'Bravo' },
  { squadID: '3', teamID: '2', squadName: 'Charlie' }
];
const CLAN_ELO = new Map([
  ['e1', { mu: 31.42, roundsPlayed: 40 }],
  ['e2', { mu: 29.8, roundsPlayed: 12 }],
  ['e3', { mu: 27.1, roundsPlayed: 3 }],
  ['e6', { mu: 24.5, roundsPlayed: 22 }],
  ['e4', { mu: 27.35, roundsPlayed: 2 }],
  ['e5', { mu: 26.2, roundsPlayed: 50 }]
]);
const VS_3DP = {
  teamID: '1', tag: '3DP', tags: ['3DP'],
  anchorEosID: 'e1', members: ['e1', 'e2', 'e6'], pulled: ['e3']
};
const ROSTER_3DP = [...VS_3DP.members, ...VS_3DP.pulled];
const CLAN_MOVES = [...ROSTER_3DP, 'e4'].map((eosID) => ({ eosID, targetTeamID: '2' }))
  .concat([{ eosID: 'e5', targetTeamID: '1' }]);

const build = (plan, players = CLAN_PLAYERS, squads = CLAN_SQUADS, elo = CLAN_ELO) =>
  DiscordHelpers.createScrambleDetailsMessage(plan, false, makeBalancer(players, squads), elo);

console.log('\nScramble report embed format\n');

const withClans = await build(withPlan(CLAN_MOVES, { virtualSquads: [VS_3DP] }));

check('fields are ordered: balance, then per team virtual squads before regular squads', () => {
  const names = withClans.fields.map((f) => f.name);
  assert.strictEqual(names[0], 'Balance Projection');
  assert.strictEqual(names[1],
    '🔗 Team 1 (USA) ➔ Team 2 (RGF) Clan Grouping (Virtual Squads) [4 players]');
  assert.ok(names[2].startsWith('Team 1 (USA) ➔ Team 2 (RGF)'), `3rd field: ${names[2]}`);
  assert.ok(names[3].startsWith('Team 2 (RGF) ➔ Team 1 (USA)'), `4th field: ${names[3]}`);
  assert.strictEqual(names.length, 4, `team 2 has no virtual squad: ${names}`);
});

check('the virtual squad is one block holding its whole roster', () => {
  const lines = virtualFields(withClans).flatMap(linesOf);
  const headers = lines.filter((l) => l.startsWith('Virtual Squad:'));
  assert.strictEqual(headers.length, 1, `expected one block, got: ${headers}`);
  assert.ok(headers[0].startsWith('Virtual Squad: [3DP] 4p · Ø'), `header: ${headers[0]}`);
  assert.ok(headers[0].includes('⚓Alpha'), `anchor squad missing: ${headers[0]}`);
  for (const name of ['Sparrow', 'Kovacs', 'Okonkwo', 'Halloway']) {
    assert.strictEqual(rowsIn(virtualFields(withClans)).filter((r) => r.includes(name)).length, 1,
      `${name} not on exactly one row of the virtual block`);
  }
});

check('virtual squad players are not repeated in the regular squad blocks', () => {
  const regular = rowsIn(regularFields(withClans)).join('\n');
  for (const name of ['Sparrow', 'Kovacs', 'Okonkwo', 'Halloway']) {
    assert.ok(!regular.includes(name), `${name} duplicated into a regular block`);
  }
  assert.ok(regular.includes('Bennett') && regular.includes('Ridley'), 'plain movers missing');
  assert.ok(regularFields(withClans)[0].name.includes('[1 players]'),
    `count must exclude virtual squad members: ${regularFields(withClans)[0].name}`);
});

check('the source-squad column shows the real in-game squad', () => {
  const rows = rowsIn(virtualFields(withClans));
  const rowFor = (name) => rows.find((r) => r.includes(name));
  assert.ok(/◆ Alpha\s+\[3DP\] Sparrow$/.test(rowFor('Sparrow')), `Sparrow: "${rowFor('Sparrow')}"`);
  assert.ok(/◆ Bravo\s+\[3DP\] Okonkwo$/.test(rowFor('Okonkwo')), `Okonkwo: "${rowFor('Okonkwo')}"`);
  assert.ok(/◇ Alpha\s+Halloway$/.test(rowFor('Halloway')), `Halloway: "${rowFor('Halloway')}"`);
});

check('a fully moved virtual squad carries no status suffix and no moved/stay column', () => {
  const lines = virtualFields(withClans).flatMap(linesOf);
  assert.ok(!/moved together|divided/.test(lines[0]), `header: ${lines[0]}`);
  assert.ok(!/\b(moved|stay)\s/.test(rowsIn(virtualFields(withClans)).join('\n')),
    'moved/stay column should only appear when the squad is divided');
});

// Same plan, but the virtual squad pulled nobody along: no ◇ anywhere in the report.
const noPulled = await build(withPlan(CLAN_MOVES, {
  virtualSquads: [{ ...VS_3DP, pulled: [] }]
}));
// And a plan without ELO data at all: no ★ anywhere.
const noElo = await build(withPlan(CLAN_MOVES, { virtualSquads: [VS_3DP] }),
  CLAN_PLAYERS, CLAN_SQUADS, null);

check('the legend covers every symbol actually used, and only those', () => {
  assert.strictEqual(withClans.footer?.text,
    '★ regular (10+ rounds) · ◆ clan member (virtual squad) · ◇ pulled with squad · ⚓ anchor squad');
  assert.ok(!noPulled.footer.text.includes('◇'), `stale ◇: ${noPulled.footer.text}`);
  assert.ok(noPulled.footer.text.includes('◆'), 'clan marker legend missing');
  assert.ok(!noElo.footer.text.includes('★'), `stale ★ without ELO: ${noElo.footer.text}`);
  assert.ok(noElo.footer.text.includes('◆'), 'clan marker legend missing without ELO');
});

check('rows are sorted by mu descending', () => {
  const mus = rowsIn(virtualFields(withClans)).map((r) => parseFloat(r.trim()));
  assert.deepStrictEqual(mus, [...mus].sort((a, b) => b - a), `not descending: ${mus}`);
});

check('listed rows account for exactly the planned moves', () => {
  const total = rowsIn(virtualFields(withClans)).length + rowsIn(regularFields(withClans)).length;
  assert.strictEqual(total, CLAN_MOVES.length, `${total} rows vs ${CLAN_MOVES.length} moves`);
});

// Only one of the four roster players actually moves.
const dividedClan = await build(withPlan(
  [{ eosID: 'e1', targetTeamID: '2' }, { eosID: 'e5', targetTeamID: '1' }],
  { virtualSquads: [VS_3DP] }
));

check('a torn-apart virtual squad reads "divided!" and marks moved/stay, movers first', () => {
  const lines = virtualFields(dividedClan).flatMap(linesOf);
  assert.ok(lines[0].endsWith('(divided!)'), `header: ${lines[0]}`);
  assert.ok(lines[0].includes('⚓Alpha'), `anchor squad missing: ${lines[0]}`);
  const rows = rowsIn(virtualFields(dividedClan));
  assert.strictEqual(rows.length, 4, 'the whole roster stays visible when divided');
  assert.ok(rows[0].startsWith('  moved') && rows[0].includes('Sparrow'), `first row: "${rows[0]}"`);
  assert.strictEqual(rows.filter((r) => r.startsWith('  moved')).length, 1, 'exactly one mover');
  assert.strictEqual(rows.filter((r) => r.startsWith('  stay')).length, 3, 'three stay');
  const moved = rowsIn(virtualFields(dividedClan)).filter((r) => r.startsWith('  moved')).length;
  assert.strictEqual(moved + rowsIn(regularFields(dividedClan)).length, 2, 'row count vs plan');
  // The field count tracks who changes team, not how many rows are shown.
  assert.ok(virtualFields(dividedClan)[0].name.endsWith('[1 players]'),
    `count must exclude the stayers: ${virtualFields(dividedClan)[0].name}`);
});

// A virtual squad nobody was moved out of: the report is about what changes, so it is omitted.
const untouchedClan = await build(withPlan(
  [{ eosID: 'e5', targetTeamID: '1' }],
  { virtualSquads: [VS_3DP] }
));

check('a virtual squad nobody moved out of is omitted entirely', () => {
  assert.strictEqual(virtualFields(untouchedClan).length, 0, 'untouched group should not be shown');
  assert.ok(!untouchedClan.fields.some((f) => f.name.startsWith('Team 1')), 'team 1 moves nobody');
  assert.ok(!/[◆◇]/.test(untouchedClan.footer.text), 'no clan markers, so no clan legend');
  assert.strictEqual(rowsIn(regularFields(untouchedClan)).length, 1, 'only Ridley moves');
});

const noClans = await build(withPlan(CLAN_MOVES));

check('no virtual squads: no clan field, no clan markers, only the ★ legend', () => {
  assert.strictEqual(virtualFields(noClans).length, 0, 'clan field should be absent');
  assert.ok(!/[◆◇]/.test(JSON.stringify(noClans)), 'markers should be absent');
  assert.strictEqual(noClans.footer.text, '★ regular (10+ rounds)', `footer: ${noClans.footer?.text}`);
  assert.strictEqual(rowsIn(regularFields(noClans)).length, CLAN_MOVES.length, 'all movers listed');
});

// ─── Merged unit: two clans the scrambler bound into one virtual squad ───────────────
// The scrambler emits ONE entry per unit it moves, listing every tag involved. Before that,
// each tag got its own entry over the same shared roster, so players showed up two and three
// times with the marker of whichever entry was rendered last.
const MERGED_PLAYERS = [
  player('m1', '[3DP] Sparrow', '1', '1'),
  player('m2', '[3DP] Kovacs', '1', '1'),
  player('m3', 'Halloway', '1', '1'),        // pulled along: shares Alpha with the clan
  player('m4', 'KMP | Okonkwo', '1', '2'),
  player('m5', 'KMP | Reyes', '1', '2'),
  player('m6', 'Bennett', '1', '2'),         // pulled along from Bravo
  player('m7', 'Ridley', '2', '3')
];
const MERGED_VS = {
  teamID: '1', tags: ['3DP', 'KMP'], tag: '3DP', anchorEosID: 'm1',
  members: ['m1', 'm2', 'm4', 'm5'], pulled: ['m3', 'm6']
};
const merged = await build(
  withPlan(
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((eosID) => ({ eosID, targetTeamID: '2' }))
      .concat([{ eosID: 'm7', targetTeamID: '1' }]),
    { virtualSquads: [MERGED_VS] }
  ),
  MERGED_PLAYERS,
  CLAN_SQUADS,
  new Map(MERGED_PLAYERS.map((p, i) => [p.eosID, { mu: 30 - i, roundsPlayed: 20 }]))
);

check('a merged unit is one block naming every clan tag, anchor included', () => {
  const headers = virtualFields(merged).flatMap(linesOf).filter((l) => l.startsWith('Virtual Squad:'));
  assert.strictEqual(headers.length, 1, `expected one block, got: ${headers}`);
  assert.ok(headers[0].startsWith('Virtual Squad: [3DP] + [KMP] 6p · Ø'), `header: ${headers[0]}`);
  assert.ok(headers[0].includes('⚓Alpha'), `anchor squad missing: ${headers[0]}`);
});

check('no player of a merged unit is listed twice anywhere in the report', () => {
  const all = merged.fields.map((f) => f.value).join('\n');
  for (const p of MERGED_PLAYERS) {
    const hits = all.split('\n').filter((l) => l.endsWith(p.name)).length;
    assert.strictEqual(hits, 1, `${p.name} appears on ${hits} rows`);
  }
});

check('◆ marks the players carrying one of the block\'s tags, ◇ the ones pulled along', () => {
  const rows = rowsIn(virtualFields(merged));
  const markerOf = (name) => (rows.find((r) => r.endsWith(name)) || '').match(/[◆◇]/)?.[0];
  for (const name of ['[3DP] Sparrow', '[3DP] Kovacs', 'KMP | Okonkwo', 'KMP | Reyes']) {
    assert.strictEqual(markerOf(name), '◆', `${name} should be a clan member`);
  }
  for (const name of ['Halloway', 'Bennett']) {
    assert.strictEqual(markerOf(name), '◇', `${name} should be marked as pulled along`);
  }
});

check('a block that fits in one field is never split across two code blocks', () => {
  for (const [label, embed] of [['merged', merged], ['withClans', withClans]]) {
    assert.strictEqual(virtualFields(embed).length, 1, `${label}: virtual field was split`);
    for (const dir of ['Team 1', 'Team 2']) {
      assert.ok(regularFields(embed).filter((f) => f.name.startsWith(dir)).length <= 1,
        `${label}: ${dir} regular field was split`);
    }
  }
  // Every mover in `merged` belongs to the unit, so team 1 has no regular field at all.
  assert.strictEqual(regularFields(merged).length, 1, 'only the team 2 direction lists movers');
});

// ─── Oversized blocks: two 18-man clans on one team, plus 40 squadless players ───
const big = [];
const bigSquads = [];
for (const [tag, squadID] of [['LONGCLANA', '1'], ['LONGCLANB', '2']]) {
  bigSquads.push({ squadID, teamID: '1', squadName: `VeryLongSquadName${squadID}` });
  for (let i = 0; i < 18; i++) big.push(player(`${tag}${i}`, `[${tag}] PlayerWithALongName${i}`, '1', squadID));
}
const unassigned = Array.from({ length: 40 }, (_, i) =>
  player(`u${i}`, `UnassignedPlayerWithALongName${i}`, '1', null));
const bigAll = [...big, ...unassigned];
const bigBlock = await build(
  withPlan(bigAll.map((p) => ({ eosID: p.eosID, targetTeamID: '2' })), {
    virtualSquads: [
      { teamID: '1', tag: 'LONGCLANA', tags: ['LONGCLANA'], anchorEosID: 'LONGCLANA0',
        members: big.slice(0, 18).map((p) => p.eosID), pulled: [] },
      { teamID: '1', tag: 'LONGCLANB', tags: ['LONGCLANB'], anchorEosID: 'LONGCLANB0',
        members: big.slice(18).map((p) => p.eosID), pulled: [] }
    ]
  }),
  bigAll,
  bigSquads,
  new Map(bigAll.map((p, i) => [p.eosID, { mu: 20 + i * 0.3, roundsPlayed: i }]))
);

check('every field stays within Discord limits, virtual and regular alike', () => {
  const listFields = bigBlock.fields.filter((f) => f.name.includes('➔'));
  assert.ok(virtualFields(bigBlock).length > 1, 'expected the virtual field to be split');
  assert.ok(regularFields(bigBlock).length > 1, 'expected the UNASSIGNED block to be split');
  for (const f of listFields) {
    assert.ok(f.value.length <= 1024, `field "${f.name}" is ${f.value.length} chars`);
  }
  assert.strictEqual(rowsIn(virtualFields(bigBlock)).length, 36, 'lost clan players while chunking');
  assert.strictEqual(rowsIn(regularFields(bigBlock)).length, 40, 'lost players while chunking');
});

// ─── Oversized embed: 12 clan squads across both teams, each of them torn in half ───
// A divided virtual squad lists its stayers as well, so the row count is no longer bounded by
// the plan — enough blocks and the embed total passes 6000 even though every field is under 1024.
const crowdPlayers = [];
const crowdSquads = [];
const crowdVirtual = [];
for (const teamID of ['1', '2']) {
  for (let s = 1; s <= 6; s++) {
    const squadID = `${teamID}${s}`;
    const members = Array.from({ length: 8 }, (_, i) => `${squadID}-${i}`);
    crowdSquads.push({ squadID, teamID, squadName: `Squad ${s} Infantry` });
    members.forEach((eosID, i) =>
      crowdPlayers.push(player(eosID, `[CLAN${s}] LongishPlayerName${i}`, teamID, squadID)));
    crowdVirtual.push({ teamID, tag: `CLAN${s}`, tags: [`CLAN${s}`],
      anchorEosID: members[0], members, pulled: [] });
  }
}
const crowded = await build(
  withPlan(
    crowdPlayers.filter((_, i) => i % 2 === 0)
      .map((p) => ({ eosID: p.eosID, targetTeamID: p.teamID === '1' ? '2' : '1' })),
    { virtualSquads: crowdVirtual }
  ),
  crowdPlayers,
  crowdSquads,
  new Map(crowdPlayers.map((p, i) => [p.eosID, { mu: 20 + (i % 20) * 0.5, roundsPlayed: i % 30 }]))
);

const embedChars = (e) => (e.title || '').length + (e.description || '').length +
  (e.footer?.text || '').length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
const truncationNotice = (e) => e.fields.find((f) => f.name.includes('Truncated'));

check('the whole embed stays within Discord limits and says what it dropped', () => {
  assert.ok(embedChars(crowded) <= 6000, `${embedChars(crowded)} chars total`);
  assert.ok(crowded.fields.length <= 25, `${crowded.fields.length} fields`);
  for (const f of crowded.fields) {
    assert.ok(f.value.length <= 1024, `field "${f.name}" is ${f.value.length} chars`);
  }
  const notice = truncationNotice(crowded);
  assert.ok(notice, 'a report cut short must say so instead of ending mid-list');
  assert.strictEqual(crowded.fields.filter((f) => f.name.includes('Truncated')).length, 1,
    'one notice for the whole report, however many calls were cut short');
  assert.ok(/^\d+ further lines/.test(notice.value), `notice: ${notice.value}`);
  assert.ok(notice === crowded.fields[crowded.fields.length - 1], 'the notice belongs last');
});

check('reports that fit are left alone by the size budget', () => {
  for (const [label, embed] of [['bigBlock', bigBlock], ['withClans', withClans]]) {
    assert.ok(embedChars(embed) <= 6000, `${label}: ${embedChars(embed)} chars`);
    assert.ok(!truncationNotice(embed), `${label} fits and must not be truncated`);
  }
});

// ─── Truncation is reported once per embed, not once per call ───────────────────────────
// One embed takes up to four pushChunkedFields calls (both directions × virtual and regular
// squads). The notice is pushed past the size budget, so a notice per call would overshoot
// the 6000 that `reserve` sets aside for exactly one. The helper therefore only reports how
// much it dropped and leaves the writing to createScrambleDetailsMessage.
check('pushChunkedFields returns what it dropped and appends no notice of its own', () => {
  const embed = {
    title: '🔀 Scramble Execution Plan',
    description: '**Total players affected:** 96\n**Calculation Time:** 42ms',
    fields: [{ name: 'Balance Projection', value: 'x'.repeat(300) }]
  };
  const block = (b) => Array.from({ length: 16 }, (_, i) =>
    `  stay   25.0★ ◆ Squad 1 I  [CLAN${b}] LongishPlayerName${i}`.padEnd(80).slice(0, 80));

  let dropped = 0;
  for (const dir of ['A', 'B', 'C', 'D']) {
    dropped += DiscordHelpers.pushChunkedFields(embed, Array.from({ length: 40 }, (_, b) => block(b)),
      `🔗 Team 1 (USA) ➔ Team 2 (RGF) Clan Grouping (Virtual Squads) ${dir}`, '[96 players]');
  }

  assert.ok(dropped > 0, 'four oversized calls must report dropped lines');
  assert.strictEqual(embed.fields.filter((f) => f.name.includes('Truncated')).length, 0,
    'the helper must not write the notice itself');
  assert.ok(embedChars(embed) <= 6000, `${embedChars(embed)} chars total`);
  assert.ok(embed.fields.length <= 25, `${embed.fields.length} fields`);
  for (const f of embed.fields) assert.ok(f.value.length <= 1024, `field "${f.name}" is ${f.value.length} chars`);
});

// Sample output for eyeballing column alignment.
if (process.argv.includes('--print')) {
  for (const embed of [withClans, merged, dividedClan]) {
    console.log('\n─── sample embed ───');
    for (const f of embed.fields) console.log(`\n${f.name}\n${f.value}`);
    if (embed.footer) console.log(`\n${embed.footer.text}`);
  }
}

console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
