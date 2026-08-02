/**
 * Scramble-report embed formatting check.
 *
 * Standalone assertions for DiscordHelpers.createScrambleDetailsMessage: one row per moved
 * player, virtual-squad markers only when the scrambler reported virtual squads, and no
 * embed field over Discord's 1024-character limit.
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

const rowsOf = (embed) =>
  embed.fields
    .filter((f) => f.name.includes('➔'))
    .flatMap((f) => f.value.replace(/```text\n?|\n?```/g, '').split('\n'))
    .filter((l) => l.trim() && /^ {2}/.test(l)); // player rows are indented, headers are not

// ─── Fixture: 4 movers out of Alpha (T1), 2 of them a clan, 1 pulled along ───
const CLAN_PLAYERS = [
  player('e1', '[3DP] Sparrow', '1', '1'),
  player('e2', '[3DP] Kovacs', '1', '1'),
  player('e3', 'Halloway', '1', '1'),
  player('e4', 'Bennett', '1', '2'),
  player('e5', 'Ridley', '2', '3')
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
  ['e4', { mu: 27.35, roundsPlayed: 2 }],
  ['e5', { mu: 26.2, roundsPlayed: 50 }]
]);
const CLAN_MOVES = [
  { eosID: 'e1', targetTeamID: '2' },
  { eosID: 'e2', targetTeamID: '2' },
  { eosID: 'e3', targetTeamID: '2' },
  { eosID: 'e4', targetTeamID: '2' },
  { eosID: 'e5', targetTeamID: '1' }
];
const VIRTUAL_SQUADS = [{ teamID: '1', tag: '3DP', members: ['e1', 'e2'], pulled: ['e3'] }];

const build = (plan, players = CLAN_PLAYERS, squads = CLAN_SQUADS, elo = CLAN_ELO) =>
  DiscordHelpers.createScrambleDetailsMessage(plan, false, makeBalancer(players, squads), elo);

console.log('\nScramble report embed format\n');

const withClans = await build(withPlan(CLAN_MOVES, { virtualSquads: VIRTUAL_SQUADS }));

check('one row per moved player, no comma-packed lines', () => {
  const rows = rowsOf(withClans);
  assert.strictEqual(rows.length, CLAN_MOVES.length, `expected ${CLAN_MOVES.length} rows, got ${rows.length}`);
  for (const name of ['Sparrow', 'Kovacs', 'Halloway', 'Bennett', 'Ridley']) {
    assert.strictEqual(rows.filter((r) => r.includes(name)).length, 1, `${name} not on exactly one row`);
  }
});

check('rows are sorted by mu descending within a squad', () => {
  const alpha = rowsOf(withClans).filter((r) => /Sparrow|Kovacs|Halloway/.test(r));
  const mus = alpha.map((r) => parseFloat(r.trim()));
  assert.deepStrictEqual(mus, [...mus].sort((a, b) => b - a), `not descending: ${mus}`);
});

check('◆ marks clan members, ◇ marks pulled players, others unmarked', () => {
  const rows = rowsOf(withClans);
  const rowFor = (name) => rows.find((r) => r.includes(name));
  assert.ok(rowFor('Sparrow').includes('◆'), 'Sparrow (clan member) missing ◆');
  assert.ok(rowFor('Kovacs').includes('◆'), 'Kovacs (clan member) missing ◆');
  assert.ok(rowFor('Halloway').includes('◇'), 'Halloway (pulled) missing ◇');
  assert.ok(!/[◆◇]/.test(rowFor('Bennett')), 'Bennett wrongly marked');
  assert.ok(!/[◆◇]/.test(rowFor('Ridley')), 'Ridley wrongly marked');
});

check('clan grouping field lists the group and its split status', () => {
  const field = withClans.fields.find((f) => f.name.includes('Clan Grouping'));
  assert.ok(field, 'Clan Grouping field missing');
  assert.ok(field.value.includes('[3DP]'), 'tag missing');
  assert.ok(field.value.includes('2 members (+1 pulled)'), `size wrong: ${field.value}`);
  assert.ok(field.value.includes('moved together'), `both members move to team 2: ${field.value}`);
  assert.ok(withClans.footer?.text.includes('◆'), 'legend footer missing');
});

const splitClan = await build(withPlan(
  [{ eosID: 'e1', targetTeamID: '2' }],
  { virtualSquads: [{ teamID: '1', tag: '3DP', members: ['e1', 'e2'], pulled: [] }] }
));

check('a clan split across teams reports split n/m', () => {
  const field = splitClan.fields.find((f) => f.name.includes('Clan Grouping'));
  assert.ok(field.value.includes('split 1/1'), `expected split 1/1, got: ${field.value}`);
});

// A clan that exists but has nobody in the swap plan: reported, but no markers to explain.
const untouchedClan = await build(withPlan(
  [{ eosID: 'e5', targetTeamID: '1' }],
  { virtualSquads: [{ teamID: '1', tag: '3DP', members: ['e1', 'e2'], pulled: ['e3'] }] }
));

check('an untouched clan reads "not moved" and gets no dangling legend', () => {
  const field = untouchedClan.fields.find((f) => f.name.includes('Clan Grouping'));
  assert.ok(field.value.includes('not moved'), `expected "not moved", got: ${field.value}`);
  assert.ok(!/[◆◇]/.test(rowsOf(untouchedClan).join('\n')), 'no marked player should be listed');
  assert.ok(!untouchedClan.footer, 'legend must not appear when no marker is rendered');
});

const noClans = await build(withPlan(CLAN_MOVES));

check('no virtual squads: no clan field, no markers, no legend', () => {
  assert.ok(!noClans.fields.some((f) => f.name.includes('Clan Grouping')), 'clan field should be absent');
  assert.ok(!noClans.footer, 'legend footer should be absent');
  assert.ok(!/[◆◇]/.test(JSON.stringify(noClans)), 'markers should be absent');
});

// 40 squadless players all land under the single UNASSIGNED key.
const many = Array.from({ length: 40 }, (_, i) =>
  player(`u${i}`, `UnassignedPlayerWithALongName${i}`, '1', null)
);
const bigBlock = await build(
  withPlan(many.map((p) => ({ eosID: p.eosID, targetTeamID: '2' }))),
  many,
  [],
  new Map(many.map((p, i) => [p.eosID, { mu: 20 + i * 0.5, roundsPlayed: i }]))
);

check('every field stays within Discord limits, even for one huge block', () => {
  const embed = bigBlock;
  const listFields = embed.fields.filter((f) => f.name.includes('➔'));
  assert.ok(listFields.length > 1, 'expected the block to be split across multiple fields');
  for (const f of listFields) {
    assert.ok(f.value.length <= 1024, `field "${f.name}" is ${f.value.length} chars`);
  }
  assert.strictEqual(rowsOf(embed).length, 40, 'lost players while chunking');
});

// Sample output for eyeballing column alignment.
if (process.argv.includes('--print')) {
  console.log('\n─── sample embed ───');
  for (const f of withClans.fields) console.log(`\n${f.name}\n${f.value}`);
  if (withClans.footer) console.log(`\n${withClans.footer.text}`);
}

console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
