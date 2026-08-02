/**
 * Scramble-report embed formatting check.
 *
 * Standalone assertions for DiscordHelpers.createScrambleDetailsMessage: one row per listed
 * player, virtual squads rendered as a single block per team ahead of the regular squads, and
 * no embed field over Discord's 1024-character limit.
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
const VS_3DP = { teamID: '1', tag: '3DP', members: ['e1', 'e2', 'e6'], pulled: ['e3'] };
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

check('a fully moved virtual squad reads "moved together", without a moved/stay column', () => {
  const lines = virtualFields(withClans).flatMap(linesOf);
  assert.ok(lines[0].endsWith('(moved together)'), `header: ${lines[0]}`);
  assert.ok(!/\b(moved|stay)\s/.test(rowsIn(virtualFields(withClans)).join('\n')),
    'moved/stay column should only appear when the squad is divided');
});

// Same plan, but the virtual squad pulled nobody along: no ◇ anywhere in the report.
const noPulled = await build(withPlan(CLAN_MOVES, {
  virtualSquads: [{ teamID: '1', tag: '3DP', members: ['e1', 'e2', 'e6'], pulled: [] }]
}));
// And a plan without ELO data at all: no ★ anywhere.
const noElo = await build(withPlan(CLAN_MOVES, { virtualSquads: [VS_3DP] }),
  CLAN_PLAYERS, CLAN_SQUADS, null);

check('the legend covers every symbol actually used, and only those', () => {
  assert.strictEqual(withClans.footer?.text,
    '★ regular (10+ rounds) · ◆ clan member (virtual squad) · ◇ pulled with squad');
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
      { teamID: '1', tag: 'LONGCLANA', members: big.slice(0, 18).map((p) => p.eosID), pulled: [] },
      { teamID: '1', tag: 'LONGCLANB', members: big.slice(18).map((p) => p.eosID), pulled: [] }
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

// Sample output for eyeballing column alignment.
if (process.argv.includes('--print')) {
  for (const embed of [withClans, dividedClan]) {
    console.log('\n─── sample embed ───');
    for (const f of embed.fields) console.log(`\n${f.name}\n${f.value}`);
    if (embed.footer) console.log(`\n${embed.footer.text}`);
  }
}

console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
