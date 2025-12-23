# Team Balancer Plugin

**SquadJS Plugin for Fair Match Enforcement**

## Overview

Tracks dominant win streaks and rebalances teams using a squad-preserving scramble algorithm. Designed for Squad servers to avoid steamrolling, reduce churn, and maintain match fairness over time.

Scramble execution swaps entire squads or unassigned players, balancing team sizes while respecting the 50-player cap and preserving squad cohesion. Includes dry-run mode, configurable thresholds, and fallback logic for emergency  up squads in the worst case if needed.

## Core Features

* **Win Streak Tracking**: Automatically tracks dominant wins and triggers scrambles after a configurable streak.

* **Single-Round Scramble**: Optional "Mercy Rule" to scramble immediately after a single game with extreme ticket disparity.

* **Discord Integration**: Administer the plugin via Discord, mirror RCON broadcasts, and view detailed swap plans.

* **Multi-Mode Logic**: Distinct dominance thresholds for Standard (RAAS/AAS) and Invasion game modes.

* **Squad-Preserving Algorithm**: Calculates optimal moves to balance teams while keeping squads together.

* **Dry-Run & Diagnostics**: Run simulation scrambles and self-diagnostics to verify plugin health without affecting gameplay.

* **Reliable Execution**: Handles RCON command retries and timeouts to ensure players are moved successfully.

* **Customizable Messaging**: Options for RCON warnings, win streak broadcasts, and generic team naming.

## Scramble Algorithm

Operates in 5 stages using randomized backtracking:

1.  **Data Prep**: Normalizes squad data, converts lone players to pseudo-squads.

2.  **Target Calc**: Computes ideal player swap count from imbalance.

3.  **Backtracked Swaps**: Attempts multiple squad combinations with scoring.

4.  **Execution**: Performs mutual swaps with retry tracking.

5.  **Post-Fix**: Trims or breaks squads if over hard cap.

## Installation

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

...

{
  "plugin": "TeamBalancer",
  "enabled": true,
  "database": "sqlite",
  "enableWinStreakTracking": true,
  "maxWinStreak": 2,
  "enableSingleRoundScramble": false,
  "singleRoundScrambleThreshold": 250,
  "minTicketsToCountAsDominantWin": 150,
  "invasionAttackTeamThreshold": 300,
  "invasionDefenceTeamThreshold": 650,
  "scrambleAnnouncementDelay": 12,
  "scramblePercentage": 0.5,
  "changeTeamRetryInterval": 200,
  "maxScrambleCompletionTime": 15000,
  "showWinStreakMessages": true,
  "warnOnSwap": true,
  "useGenericTeamNamesInBroadcasts": false,
  "debugLogs": false,
  "discordClient": "discord",
  "discordChannelID": "",
  "discordAdminRoleID": "",
  "mirrorRconBroadcasts": true,
  "postScrambleDetails": true,
  "requireScrambleConfirmation": true,
  "scrambleConfirmationTimeout": 60,
  "devMode": false
},
```

**File Placement**: Move the project files into your SquadJS directory's squad-server folder

```
squad-server/
├── plugins/
│   └── team-balancer.js
├── utils/
│   ├── tb-scrambler.js
│   ├── tb-database.js
│   ├── tb-commands.js
│   ├── tb-diagnostics.js
│   ├── tb-discord-helpers.js
│   └── tb-swap-executor.js
└── testing/ (optional)
    ├── plugin-logic-test-runner.js
    ├── scrambler-test-runner.js
    └── mock-data-generator.js
```

## Commands

```text
Public Commands:
!teambalancer                  → View current win streak and status.

Admin Commands:
!teambalancer status           → View win streak and plugin status.
!teambalancer diag             → Run self-diagnostics (DB check + Live Scramble Sim).
!teambalancer on               → Enable win streak tracking.
!teambalancer off              → Disable win streak tracking.
!teambalancer debug on|off     → Enable/disable debug logging.
!teambalancer help             → List available commands.

!scramble                      → Manually trigger scramble with countdown.
!scramble now                  → Immediate scramble (no countdown).
!scramble dry                  → Dry-run scramble (simulation only).
!scramble confirm              → Confirm a pending scramble request.
!scramble cancel               → Cancel pending scramble countdown.
```

## Configuration Options

```text
Core Settings:
database                       - The Sequelize connector for persistent data storage.
enableWinStreakTracking        - Enable/disable automatic win streak tracking.
maxWinStreak                   - Number of dominant wins to trigger a scramble.
enableSingleRoundScramble      - Enable scramble if a single round ticket margin is huge.
singleRoundScrambleThreshold   - Ticket margin to trigger single-round scramble.
minTicketsToCountAsDominantWin - Min ticket diff for a dominant win (Standard).
invasionAttackTeamThreshold    - Ticket diff for Attackers to be dominant (Invasion).
invasionDefenceTeamThreshold   - Ticket diff for Defenders to be dominant (Invasion).

Scramble Execution:
scrambleAnnouncementDelay      - Seconds before scramble executes after announcement.
scramblePercentage             - % of players to move (0.0 - 1.0).
changeTeamRetryInterval        - Retry interval (ms) for player swaps.
maxScrambleCompletionTime      - Max time (ms) for all swaps to complete.
warnOnSwap                     - Warn players when swapped.

Messaging & Display:
showWinStreakMessages          - Broadcast win streak messages.
useGenericTeamNamesInBroadcasts - Use "Team 1"/"Team 2" instead of faction names.

Discord Integration:
discordClient                  - Discord connector for admin commands.
discordChannelID               - Channel ID for admin commands and logs.
discordAdminRoleID             - Role ID for admin permissions (empty = all in channel).
mirrorRconBroadcasts           - Mirror RCON broadcasts to Discord.
postScrambleDetails            - Post detailed swap plans to Discord.
requireScrambleConfirmation    - Require !scramble confirm before executing a scramble.
scrambleConfirmationTimeout    - Time in seconds to wait for scramble confirmation.

Debug & Dev:
debugLogs                      - Enable verbose console logging.
devMode                        - Enable dev mode.
```

## Game Mode Support

-   **RAAS / AAS**: Uses standard ticket diff threshold
-   **Invasion**: Uses separate thresholds for attackers and defenders
-   Mode-aware streak logic and messaging

## Developer Mode

Set `devMode = true` in the constructor to allow commands from all chat (not just admins).

## Diagnostics

`!teambalancer diag` provides:

-   **Self-Tests**: Database integrity check & live scramble simulation.
-   **Plugin Status**: Version, active state, and debug logging mode.
-   **Match Data**: Current win streak, game mode, and team names.
-   **Population**: Player/Squad counts, team balance, and unassigned players.
-   **Config Snapshot**: Active thresholds, scramble settings, and Discord options.

## Logging and Monitoring

The plugin provides comprehensive logging for debugging and monitoring:

-   **Debug Logs**: Enable with `debugLogs: true` for verbose output
-   **Console Output**: All major actions logged to server console
-   **Player Warnings**: Optional RCON warnings sent to swapped players
-   **Scramble Tracking**: Detailed retry attempts and completion status

### Debug Mode

Enable debug logging to see detailed scramble execution:

```json
{
  "debugLogs": true
}
```

This will show squad selection logic, player move attempts, and retry status in the console.

# Critical Server Configuration

For a scramble to be successful, **all team-swap commands must be completed before Faction Voting begins**. The Squad game engine blocks team changes once the faction voting phase starts.

Because the plugin's timers and the server's round-cycle timers run independently, you must ensure your server settings provide a large enough window for the scramble to finish.

## Required Server Settings

You must modify your server configuration to allow enough time for the announcement and the movement of players.

**File:** `SquadServer/SquadGame/ServerConfig/Server.cfg`

**Command:**
```cfg
// For how long end screen will be displayed before we move to voting
TimeBeforeVote=45
```

## Recommended Timing Logic

To ensure the scramble (30s announcement + 5s execution) finishes safely before faction voting locks the teams, we recommend the following balance:

* **Plugin Setting** (`scrambleAnnouncementDelay`): 30 (seconds)
* **Server Setting** (`TimeBeforeVote`): At least 45 (seconds)

## How the Timers Interact

All timings below are relative to the exact moment the round ends:

1. **T+0s (Round End)**: The server starts its internal `TimeBeforeVote` countdown. Simultaneously, TeamBalancer receives the "Round End" event and starts its own `scrambleAnnouncementDelay` timer.
2. **T+30s**: The plugin's delay expires and it begins executing the scramble. It takes roughly 4–8 seconds to process and send all RCON move commands.
3. **T+45s**: The server's `TimeBeforeVote` expires. The server transitions to the Map/Faction Voting screen. Team changes are now locked by the game engine.

> [!IMPORTANT]  
> If `TimeBeforeVote` is set too low (e.g., 20s), the plugin will still be mid-execution when the server hits the Faction Voting phase. Players will not be successfully swapped, rendering the team balancing ineffective for that round.

## Author

**Slacker**
```
Discord: `real_slacker`
Email: `mike.b.joyce@gmail.com`
```

---

*Built for SquadJS — Enhance match balance. Reduce churn. Keep players engaged.*

---
