# Testing

Standalone scripts for testing and validating TeamBalancer behaviour.

These are **not part of the plugin** and are **not maintained** alongside it. They were written during development and vary in their current state — some work standalone, some require a live SquadJS server environment, and some are deprecated. They are provided as-is with no support.

All scripts assume a SquadJS-style directory layout (`squad-server/plugins/...` so `../../core/logger.js` resolves correctly). Run them with a local Node install from the `testing/` directory; running them outside that layout will require path adjustments.

---

## Scripts

### `scrambler-test-runner.js`

Stress-tests the Scrambler algorithm using mock data. Standalone — no server required.

**Coverage:**
- Standard scenarios: 50/50, imbalances (45/55, 20/80, etc.), low pop, max capacity, seeding mode
- Squad-structure edge cases: All-locked, David-vs-Goliath
- ELO balancing: pro-stack detection scenario
- **Clan tag grouping** (when `enableClanTagGrouping` is on):
  - Same-team clan in multiple squads (default vs `pullEntireSquads: true`)
  - Cross-team clan (each side cohesive, no forced cross-team consolidation)
  - Sub-min clan ignored
  - Similarity merging at edit distances 0 and 1
  - Case sensitivity: case-fold alone (`caseSensitive: false`, edit=0), case-fold + similarity (`caseSensitive: false`, edit=1), case-sensitive default (`caseSensitive: true`, edit=0)
- Bulk regression: 2,500 randomized runs (general) + 500 randomized runs (clan grouping with `caseSensitive` and `pullEntireSquads` randomized per run)

```bash
node scrambler-test-runner.js
```

### `mock-data-generator.js`

Helper module imported by `scrambler-test-runner.js`. Generates mock player and squad data with configurable team ratios, lock rates, and squad size distributions. Provides:
- `generateMockPlayers`, `generateMockSquads`, `transformForScrambler` — base mock data
- `injectClanTags` — prefixes a chosen subset of mock players with `[TAG]` for clan-grouping tests
- Scenario builders: `generateScenario_AllLocked`, `generateScenario_DavidGoliath`, `generateScenario_ClanGrouping`, `generateScenario_ClanSplitAcrossTeams`, `generateScenario_ClanSimilarity`, `generateScenario_ClanBelowMin`

Not a runnable script.

### `plugin-logic-test-runner.js`

Tests win streak logic, dominant win detection, and scramble triggering using a mock SquadJS environment. Does not require a live server, but the mock server harness may drift from the real SquadJS API over time.

```bash
node plugin-logic-test-runner.js
```

### `elo-integration-test.js`

Tests ELO-weighted scramble behaviour against a constructed scenario (15-man pro stack vs average team). Has a known broken import (`../core/logger.js`) — fix the path before running.

```bash
node elo-integration-test.js
```

### `historical-scramble-test.js`

Replays historical match data from an EloTracker DB backup and a JSONL match log through the Scrambler. Reports balance outcomes against real round snapshots. Requires EloTracker output files.

```bash
node historical-scramble-test.js <elodb.json> [matches.jsonl]
```

### `historical-elo-backbone-test.js`

Validates the "Top 15" Backbone ELO logic against a real EloTracker dataset. Mocks `Logger.verbose` so it runs standalone.

```bash
node historical-elo-backbone-test.js <elodb.json>
```
