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

## Commands

### Admin

| Command | Description |
|---|---|
| `!teambalancer on\|off` | Enable/disable auto-tracking |
| `!teambalancer status` | Show plugin config, streak, and stats |
| `!teambalancer debug on\|off` | Enable/disable debug logging |
| `!teambalancer diag` | Run 3 dry-run simulations |
| `!teambalancer scramble` | Manual scramble with delay |
| `!teambalancer cancel` | Cancel countdown |
| `!scramble` | Alias for `!teambalancer scramble` |
| `!scramble now` | Immediate scramble (no delay) |
| `!scramble cancel` | Cancel pending countdown |

### Player

| Command | Description |
|---|---|
| `!teambalancer` | Show win streak, last scramble, plugin state |

## Configuration Options

| Key | Description | Default |
|---|---|---|
| `enableWinStreakTracking` | Enables or disables the automatic win streak tracking system. | `true` |
| `maxWinStreak` | The number of dominant wins required for a team to trigger an automatic scramble. | `2` |
| `minTicketsToCountAsDominantWin` | The minimum ticket difference required for a win to be considered "dominant" in non-Invasion game modes. | `150` |
| `invasionAttackTeamThreshold` | The ticket difference threshold for the attacking team to be considered "dominant" in Invasion game mode. | `300` |
| `invasionDefenceTeamThreshold` | The ticket difference threshold for the defending team to be considered "dominant" in Invasion game mode. | `650` |
| `scrambleAnnouncementDelay` | The delay in seconds before a scramble executes after being announced. | `12` |
| `scramblePercentage` | The percentage of total players the scramble algorithm will attempt to move to balance teams (0.0 to 1.0). | `0.5` |
| `changeTeamRetryInterval` | The interval in milliseconds between retry attempts when moving players between teams. | `200` |
| `maxScrambleCompletionTime` | The maximum total time in milliseconds allowed for all player swaps to complete during a scramble. | `15000` |
| `showWinStreakMessages` | Controls whether messages about win streaks are broadcast to the server. | `true` |
| `warnOnSwap` | Controls whether players receive a warning message when they are swapped between teams. | `true` |
| `useGenericTeamNamesInBroadcasts` | If true, broadcasts will use "Team 1" and "Team 2" instead of faction names. | `false` |
| `debugLogs` | Enables verbose debug logging to the server console. | `false` |
| `dryRunMode` | If true, manual scrambles will only simulate the moves without actually executing them via RCON. | `true` |

### Notes

- `scrambleAnnouncementDelay` minimum: 10 sec
- `scramblePercentage` must be a value between 0.0 and 1.0.
- `changeTeamRetryInterval` minimum: 200 ms
- `maxScrambleCompletionTime` minimum: 5000 ms
- All options validated on startup

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
