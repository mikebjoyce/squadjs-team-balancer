# Team Balancer Plugin

**SquadJS Plugin for Fair Match Enforcement**

## Overview

Tracks dominant win streaks and rebalances teams using a squad-preserving scramble algorithm. Designed for Squad servers to avoid steamrolling, reduce churn, and maintain match fairness over time.

Scramble execution swaps entire squads or unassigned players, balancing team sizes while respecting the 50-player cap and preserving squad cohesion. Includes dry-run mode, configurable thresholds, and fallback logic for emergency breaking if needed.

## Core Features

* **Win Streak Detection**: Detects dominant win streaks based on ticket difference thresholds.

* **Automatic/Manual Scrambling**: Triggers squad-preserving scrambles automatically or via admin command.

* **Multi-Mode Support**: Handles RAAS, AAS, and Invasion with separate logic.

* **Dry-Run Diagnostics**: Simulate scrambles without affecting players via chat commands.

* **Player Notifications**: Sends RCON warnings to swapped players (optional).

* **Reliable Swap System**: Retries failed swaps until timeout expires.

* **Emergency Enforcement**: Breaks squads only if needed to enforce 50-player cap.

* **Generic Team Names**: Option to use "Team 1" / "Team 2" instead of faction names in broadcasts.

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
  "dryRunMode": true
},
```

**File Placement**: Move the project files into your SquadJS directory's squad-server folder

/squad-server
  /plugins
    /teambalancer
      team-balancer.js
  /utils
    tb-scrambler.js
    tb-database.js
    tb-commands.js
    tb-diagnostics.js
    tb-discord-helpers.js
    tb-swap-executor.js
  /tests (optional)
    plugin-logic-test-runner.js
    scrambler-test-runner.js
    mock-data-generator.js

## Commands

```text
Public Commands:
!teambalancer                  → View current win streak and status.

Admin Commands:
!teambalancer status           → View win streak and plugin status.
!teambalancer diag             → Run self-diagnostics (DB check + Live Scramble Sim + Discord Check).
!teambalancer on               → Enable win streak tracking.
!teambalancer off              → Disable win streak tracking.
!teambalancer debug on|off     → Enable/disable debug logging.
!teambalancer help             → List available commands.

!scramble                      → Manually trigger scramble with countdown.
!scramble now                  → Immediate scramble (no countdown).
!scramble dry                  → Dry-run scramble (simulation only).
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

-   Current plugin status
-   Team/squad distribution
-   3 dry-run scramble simulations
-   Debug logs (if enabled)

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

## Author

**Slacker**
Discord: `real_slacker`
Email: `mike.b.joyce@gmail.com`

---

*Built for SquadJS — Enhance match balance. Reduce churn. Keep players engaged.*

---
