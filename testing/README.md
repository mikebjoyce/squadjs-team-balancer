# Testing

Standalone scripts for testing and validating TeamBalancer behaviour.

These are **not part of the plugin** and are **not maintained** alongside it. They were written during development and vary in their current state — some work standalone, some require a live SquadJS server environment, and some are deprecated. They are provided as-is with no support.

---

## Scripts

**`scrambler-test-runner.js`**
Stress-tests the Scrambler algorithm using mock data. Runs multiple scenarios (standard, all-locked, David vs Goliath) and reports balance outcomes and cohesion metrics. Standalone — no server required.
```
node scrambler-test-runner.js
```

**`mock-data-generator.js`**
Helper module used by `scrambler-test-runner.js`. Generates mock player and squad data with configurable team ratios, lock rates, and squad size distributions. Not a runnable script — imported by other test files.

**`historical-scramble-test.js`**
Replays historical match data from an EloTracker DB backup and JSONL match log through the Scrambler. Reports balance outcomes against real round snapshots. Requires EloTracker output files.
```
node historical-scramble-test.js <elodb.json> [merged.jsonl]
```

**`plugin-logic-test-runner.js`**
Tests win streak logic, dominant win detection, and scramble triggering using a mock SquadJS environment. Does not require a live server, but the mock server harness may drift from the real SquadJS API over time.
```
node plugin-logic-test-runner.js
```

**`elo-integration-test.js`**
Tests ELO-weighted scramble behaviour against a constructed scenario (pro stack vs average team). Requires a live SquadJS environment for Logger — will error if run standalone without mocking Logger first.
```
node elo-integration-test.js
```

---

> **Note:** Some of these scripts use relative imports that assume a specific directory layout within a SquadJS installation. Running them outside that context will require path adjustments.
