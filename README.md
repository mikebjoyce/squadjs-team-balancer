# Team Balancer Plugin v3.1.1

**SquadJS Plugin for Fair Match Enforcement**

## Overview

Tracks dominant win streaks and rebalances teams using a squad-preserving scramble algorithm. Designed for Squad servers to avoid steamrolling, reduce churn, and maintain match fairness over time.

Scramble execution swaps entire squads or unassigned players, balancing team sizes while respecting the 50-player cap and preserving squad cohesion. Includes dry-run mode, configurable thresholds, and fallback logic for emergency breakup squads in the worst case if needed.

---

## Core Features

* **Dual Win Streak Tracking**:
  - **Dominant Win Streaks**: Tracks wins that meet ticket margin thresholds (default: 150+ tickets). Triggers scramble after X dominant wins (default: 2).
  - **Consecutive Win Streaks**: Tracks ANY consecutive wins regardless of margin. Optional secondary trigger (default: disabled). Useful for preventing prolonged one-sided matches even when margins are close.

* **Single-Round Scramble**: Optional "Mercy Rule" to scramble immediately after a single game with extreme ticket disparity.

* **Seed Auto-Scramble**: Automatically scrambles teams at the end of a Seed round, ensuring balanced teams as the server fills up.

* **ELO-Weighted Balancing**: Optional integration with EloTracker. When `useEloForBalance` is enabled, the scoring function switches to an ELO-weighted branch: a composite penalty (50% Mean ELO diff + 50% Top-15 ELO diff) + veteran parity penalty + numerical balance. The standard heuristic penalties (churn, anchor, cohesion, infantry overload) are replaced entirely, not supplemented.

* **Discord Integration**: Administer the plugin via Discord, mirror RCON broadcasts, and view detailed swap plans.

* **Multi-Mode Logic**: Distinct dominance thresholds for Standard (RAAS/AAS) and Invasion game modes.

* **Squad-Preserving Algorithm**: Calculates optimal moves to balance teams while keeping squads together.

* **Dry-Run & Diagnostics**: Run simulation scrambles and self-diagnostics to verify plugin health without affecting gameplay.

* **Reliable Execution**: Handles RCON command retries and timeouts to ensure players are moved successfully.

* **Customizable Messaging**: Options for RCON warnings, win streak broadcasts, and generic team naming.

* **Switch Plugin Integration**: Fires `TEAM_BALANCER_SCRAMBLE_EXECUTED` event for integration with compatible plugins.

---

## Recommended Plugins

### EloTracker

**[squadjs-elo-tracker](https://github.com/mikebjoyce/squadjs-elo-tracker)**

Tracks per-player TrueSkill ratings (μ/σ) across rounds. When `useEloForBalance` is enabled, its scoring function switches to an ELO-weighted branch. It pulls live mu ratings and regular player counts from EloTracker at scramble time, evaluating a composite ELO difference (Mean and Top-15 players), veteran parity, and numerical balance (replacing its standard heuristic penalties). This prevents skill stacks from reforming after a scramble.

**Why this matters**: Numerical balance alone can still produce lopsided matches if high-skill players cluster on one side. ELO-aware balancing distributes skill more evenly alongside headcount.

**Setup**: Install EloTracker alongside TeamBalancer and set `"useEloForBalance": true`. No additional wiring is needed — TeamBalancer finds the EloTracker instance automatically at runtime. If EloTracker is absent or its cache is empty, TeamBalancer falls back to pure numerical balance silently.

---

### Switch Plugin (TeamBalancer-Aware Fork)

**[squadjs-switch-teambalancer-aware](https://github.com/mikebjoyce/squadjs-switch-teambalancer-aware)**

Prevents players from changing teams immediately after a scramble. When TeamBalancer executes a scramble, it fires the `TEAM_BALANCER_SCRAMBLE_EXECUTED` event. The Switch plugin listens for this event and automatically locks all players from switching teams for a configurable duration (default: 20 minutes).

**Why this matters**: Without this plugin, players moved during a scramble can immediately switch back to their original team, defeating the purpose of team balancing.

**Setup**: Install the Switch plugin alongside TeamBalancer. No additional configuration needed — the event integration is automatic.

---

## Scramble Algorithm (Optimal Exhaustive Search)

Operates using a four-phase dynamic escalation system to ensure perfect numerical parity while protecting the core identity and cohesion of existing teams.

* **Data Prep**: Normalizes squad snapshots and treats unassigned players as individual "pseudo-squads" for maximum movement flexibility.

* **Target Calc**: Computes ideal player swap targets (default 50% churn) adjusted by current team population deltas.

* **Tiered Optimization (2000 Iterations)**:
  * **Phase 1 (Pure Swaps)**: Focuses exclusively on whole-squad moves to maximize friend-group cohesion.
  * **Phase 2 (Surgical Unlocked)**: Dynamically shatters one random unlocked squad if balance remains poor to provide precision adjustments.
  * **Phase 3 (Surgical Locked)**: A late-stage fallback that allows breaking a single locked squad to resolve extreme parity issues.
  * **Phase 4 (Nuclear Option)**: A final resort that decomposes all squads to achieve maximum numerical balance. Runs for the last 5 iterations.
  * **With Clan Tag Grouping enabled**: same-team clan members are folded into "virtual squads" anchored on the squad with the most clan members; Phase 1 swaps them as one unit, and Phases 2/3 only shatter a virtual squad when no non-clan squad is eligible.

* **ELO Integration (Optional)**: When ELO data is available, the scrambler uses a dedicated ELO-weighted scoring branch (composite Mean/Top-15 ELO diff + veteran parity + numerical balance). Standard heuristic penalties like churn, anchor rules, and cohesion weights are disabled in favor of ELO parity.

* **Identity Preservation**: In heuristic (non-ELO) mode, a penalty discourages moving more than 2 large infantry squads from a single team per scramble.

* **Cap Enforcement**: A final corrective pass trims overages in priority order: Unassigned → Unlocked Squad Members. Locked players are never moved during cap enforcement.

### Performance Benchmarks
* **Execution Time**: ~70–95ms per search (exhaustive 2000-attempt pass).
* **Balance Success**: 99.9% rate of achieving a team differential of ≤ 2 players.
* **Cohesion**: Locked squads are preserved during Phases 1–2. Phase 3 may split one locked squad as a late-stage fallback. Phase 4 decomposes all squads.

### Clan Tag Grouping (Optional)

When `enableClanTagGrouping` is on, the scrambler keeps players who share a clan tag (e.g. `[ABC]`) and are already on the same team together when shuffling.

**How it works**:

* **Tag detection**: Player names are scanned for a leading clan tag via a five-strategy detector (ported from [squadjs-elo-tracker](https://github.com/mikebjoyce/squadjs-elo-tracker)), tried in order: bracket pairs (`[TAG]`, `【TAG】`, `╔TAG╗`), explicit separators (`TAG | Name`, `TAG // Name`), 2+ space gap, short ASCII ALL-CAPS (`KM Lookout`), and a bare-prefix fallback for Unicode/mixed-case prefixes (`KΛZ Korven`). Names with no visible tag/name boundary (e.g. `ABCJohnSmith`) yield no group.
* **Matching**: Case-sensitive by default. Set `clanTagCaseSensitive: false` to normalize via NFD-decompose, lookalike mapping (`λ`→`a`, `я`→`r`, …), and uppercase, collapsing variants like `[Café]` / `[CAFE]` / `[CΛFE]`. Tags within `clanTagMaxEditDistance` Levenshtein distance are iteratively merged so transitive matches (`[AAA] ↔ [AAB] ↔ [ABB]`) collapse into one group.
* **Virtual squads**: Per team, clan members are folded into a virtual squad anchored on the squad already holding the most clan members (tiebreak: larger size, lower ID). `clanGroupingPullEntireSquads` toggles whether non-clan teammates travel along (default: only clan members are pulled).
* **Phase behavior**: Phase 1 swaps virtual squads atomically. Phases 2/3 prefer non-clan victims and only break a virtual squad when no other option exists; a soft scoring penalty further discourages re-splitting once decomposition begins.

**Cross-team clans are intentionally not consolidated** — if a clan starts split across teams, each side is treated independently.

Add to your `config.json`:

```json
"connectors": {
  "sqlite": {
    "dialect": "sqlite",
    "storage": "squad-server.sqlite"
  },
  "discord": {
    "connector": "discord",
    "token": "YOUR_BOT_TOKEN"
  }
},

{
  "plugin": "TeamBalancer",
  "enabled": true,
  "database": "sqlite",
  "enableWinStreakTracking": true,
  "ignoredGameModes": ["Seed", "Jensen"],
  "enableSeedAutoScramble": true,
  "maxWinStreak": 2,
  "maxConsecutiveWinsWithoutThreshold": 0,
  "enableSingleRoundScramble": false,
  "singleRoundScrambleThreshold": 250,
  "minTicketsToCountAsDominantWin": 150,
  "invasionAttackTeamThreshold": 300,
  "invasionDefenceTeamThreshold": 650,
  "scrambleAnnouncementDelay": 12,
  "scramblePercentage": 0.5,
  "enableClanTagGrouping": false,
  "minClanGroupSize": 2,
  "maxClanGroupSize": 18,
  "clanTagMaxEditDistance": 1,
  "clanTagCaseSensitive": true,
  "clanGroupingPullEntireSquads": false,
  "changeTeamRetryInterval": 150,
  "maxScrambleCompletionTime": 15000,
  "showWinStreakMessages": true,
  "warnOnSwap": true,
  "useGenericTeamNamesInBroadcasts": false,
  "requireScrambleConfirmation": true,
  "scrambleConfirmationTimeout": 60,
  "discordClient": "discord",
  "discordAdminChannelID": "",
  "discordReportChannelID": "",
  "discordAdminRoleIDs": [],
  "mirrorRconBroadcasts": true,
  "postScrambleDetails": true,
  "useEloForBalance": false,
  "devMode": false,
  "reportLogPath": "team-balancer-reports.jsonl"
}
```

**File Placement**: Move the project files into your SquadJS directory's squad-server folder.

```
squad-server/
├── plugins/
│   └── team-balancer.js
├── utils/
│   ├── tb-scrambler.js
│   ├── tb-clan-grouping.js
│   ├── tb-database.js
│   ├── tb-commands.js
│   ├── tb-diagnostics.js
│   ├── tb-discord-helpers.js
│   └── tb-swap-executor.js
└── testing/ (optional)
    ├── scrambler-test-runner.js
    ├── historical-scramble-test.js
    ├── historical-elo-backbone-test.js
    ├── plugin-logic-test-runner.js
    ├── elo-integration-test.js
    └── mock-data-generator.js
```

---

## Commands

```text
Public Commands:
!teambalancer                  → View current win streak and status.

Admin Commands:
!teambalancer status           → View win streak and plugin status.
!teambalancer diag             → Run self-diagnostics (DB check + live scramble sim).
!teambalancer on               → Enable win streak tracking.
!teambalancer off              → Disable win streak tracking.
!teambalancer export           → Export the round reports JSONL file.
!teambalancer clear            → Clear the round reports log file.
!teambalancer help             → List available commands.

!scramble                      → Manually trigger scramble with countdown.
!scramble now                  → Immediate scramble (no countdown).
!scramble dry                  → Dry-run scramble (simulation only).
!scramble confirm              → Confirm a pending scramble request.
!scramble cancel               → Cancel pending scramble countdown.
```

---

## Configuration Options

```text
Core Settings:
database                            - Sequelize/SQLite connector for persistent storage.
enableWinStreakTracking              - Enable/disable automatic win streak tracking.
ignoredGameModes                    - Game modes or map names excluded from win streak tracking (default: ["Seed", "Jensen"]).
enableSeedAutoScramble              - Auto-scramble teams at the end of a Seed round (default: true).

Win Streak:
maxWinStreak                        - Dominant wins in a row to trigger scramble (default: 2).
maxConsecutiveWinsWithoutThreshold  - Any consecutive wins to trigger scramble; 0 = disabled (default: 0).
enableSingleRoundScramble           - Scramble after a single round with extreme ticket margin.
singleRoundScrambleThreshold        - Ticket margin for single-round trigger (default: 250).
minTicketsToCountAsDominantWin      - Min ticket diff for a dominant win in Standard modes (default: 150).
invasionAttackTeamThreshold         - Ticket diff for Invasion attackers to count as dominant (default: 300).
invasionDefenceTeamThreshold        - Ticket diff for Invasion defenders to count as dominant (default: 650).

Scramble Execution:
scrambleAnnouncementDelay           - Seconds before scramble executes after announcement (default: 12).
scramblePercentage                  - Fraction of players to move (default: 0.5).
changeTeamRetryInterval             - RCON retry interval in ms (default: 150).
maxScrambleCompletionTime           - Max time in ms for all swaps to complete (default: 15000).
warnOnSwap                          - RCON warn players when swapped.
requireScrambleConfirmation         - Require !scramble confirm before executing manual scrambles.
scrambleConfirmationTimeout         - Seconds to wait for confirmation (default: 60).

Messaging & Display:
showWinStreakMessages                - Broadcast win streak updates after each round.
useGenericTeamNamesInBroadcasts     - Use "Team 1"/"Team 2" instead of faction names.

Discord Integration:
discordClient                       - Discord connector name.
discordAdminChannelID               - Channel for admin commands.
discordReportChannelID              - Channel for automated reports (win streaks, scramble plans, errors). Defaults to admin channel if unset.
discordAdminRoleIDs                 - Array of Role IDs required for Discord admin commands (empty = all in channel).
mirrorRconBroadcasts                - Mirror RCON broadcasts to Discord.
postScrambleDetails                 - Post detailed swap plan to Discord after scramble.

Clan Tag Grouping:
enableClanTagGrouping               - Keep players sharing a clan tag (e.g. [ABC]) together when they are on the same team during a scramble (default: false).
minClanGroupSize                    - Min total members of a clan tag to be considered for grouping (default: 2).
maxClanGroupSize                    - Max total members of a clan tag to be considered for grouping; larger clans are ignored (default: 18).
clanTagMaxEditDistance              - Max Levenshtein edit distance to merge similar clan tags (e.g. [CLAN]+[CLAM] at distance 1). 0 = exact match only (default: 1).
clanTagCaseSensitive                - When true (default), tags are grouped by the raw extracted prefix verbatim ([CLAN] and [clan] are different). When false, tags are normalized via NFD + gamer-character map (λ→a, я→r, etc.) + non-alphanumeric strip + uppercase, so [Café]/[CAFE]/[CΛFE] all collapse into one group.
clanGroupingPullEntireSquads        - When true, contributing squads merge wholesale into the virtual clan squad (non-clan teammates travel with their clan members). When false (default), only clan members are pulled into the anchor squad.

Advanced:
useEloForBalance                    - Weight scrambles by EloTracker mu ratings. Requires EloTracker plugin. Falls back to numerical balance if EloTracker is absent.

Dev:
devMode                             - Allow commands from any player regardless of admin status.
reportLogPath                       - Path to the JSONL log file for round reports (default: 'team-balancer-reports.jsonl').
```

---

## Game Mode Support

- **RAAS / AAS**: Uses `minTicketsToCountAsDominantWin` threshold.
- **Invasion**: Uses separate thresholds for attackers (`invasionAttackTeamThreshold`) and defenders (`invasionDefenceTeamThreshold`).
- **Seed**: Excluded from win streak tracking. Optional auto-scramble at round end via `enableSeedAutoScramble`.
- Other modes and map names can be excluded via `ignoredGameModes`.

---

## Win Tracking Systems

The plugin operates two independent win tracking systems that can each trigger scrambles:

### Dominant Win Streaks (Primary)
Tracks wins where the victor exceeded configured ticket margin thresholds:
- **Standard modes (RAAS/AAS)**: `minTicketsToCountAsDominantWin` (default: 150)
- **Invasion mode**: Separate thresholds for attackers (`invasionAttackTeamThreshold`: 300) and defenders (`invasionDefenceTeamThreshold`: 650)

A scramble triggers when one team achieves `maxWinStreak` dominant victories in a row (default: 2).

**Use case**: Prevents sustained one-sided stomps where skill or strategy gap is clear.

### Consecutive Win Streaks (Secondary — Optional)
Tracks ANY consecutive wins regardless of ticket margin. Controlled via `maxConsecutiveWinsWithoutThreshold`:
- **Set to 0** (default): Feature disabled.
- **Set to X > 0**: Triggers scramble after X consecutive wins, even if margins were close.

**Use case**: Prevents prolonged one-sided outcomes across matches with consistent but narrow victories.

**Independence**: Both systems track simultaneously. Either can trigger a scramble independently. Resets are also independent — a dominant streak can reset while the consecutive streak continues, and vice versa.

**Example**:
```json
"maxWinStreak": 2,
"maxConsecutiveWinsWithoutThreshold": 5,
"minTicketsToCountAsDominantWin": 150
```
Scrambles trigger if one team either wins 2 rounds with 150+ ticket margins, or wins 5 rounds in a row at any margin.

---

## Diagnostics

`!teambalancer diag` runs and reports:

- **DB Connectivity**: Read/write/restore cycle against the live database.
- **DB Concurrency**: Parallel write stress test — runs 5 simultaneous increments and verifies the final count matches committed transactions.
- **Live Scramble Sim**: Dry-run scramble against the current server population.
- **Plugin Status**: Version, ready state, and active configuration.
- **Population Snapshot**: Player and squad counts, team sizes, unassigned players.

---

## Logging and Monitoring

- **Console Output**: All major actions logged via SquadJS Logger.
- **Player Warnings**: Optional RCON warnings sent to swapped players.
- **Discord Output**: Win streak updates, scramble plans, execution summaries, and error reports.

---

## Critical Server Configuration

For a scramble to succeed, **all team-swap calculations and RCON commands must complete before Faction Voting begins**. The game engine blocks team changes once faction voting starts.

**File:** `SquadServer/SquadGame/ServerConfig/Server.cfg`

```cfg
// How long the scoreboard displays before moving to map voting
TimeBeforeVote=45
```

### Recommended Timing

| Setting | Value |
|---|---|
| `scrambleAnnouncementDelay` | 30s |
| `TimeBeforeVote` | 45s (minimum) |

**How the phases and timers interact:**

1. **T+0s** — Round ends. The Scoreboard appears. The server starts the `TimeBeforeVote` countdown. TeamBalancer starts the `scrambleAnnouncementDelay` timer.
2. **T+30s** — Plugin delay expires. TeamBalancer runs its scramble calculations and executes RCON moves (this process is fast, but not instant). *This 30-second delay exists intentionally to give players time to debrief with their squad and give commendations before being moved.*
3. **T+45s** — `TimeBeforeVote` expires. Map Voting begins on the scoreboard. **Players can still be safely swapped during Map Voting.**
4. **T+X** — Map Voting ends and Faction Voting begins. **Team changes are now locked by the game engine.**

> [!IMPORTANT]
> Ensure your `scrambleAnnouncementDelay` gives the plugin enough time to calculate and execute all swaps before the Map Voting phase concludes. If the plugin is still executing when Faction Voting begins, the remaining players will not be swapped successfully.

---

## Author

**Slacker**
```
Discord: `real_slacker`
GitHub:  https://github.com/mikebjoyce
```

---

*Built for SquadJS*
