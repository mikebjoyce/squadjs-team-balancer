# Team Balancer Plugin

**SquadJS Plugin for Fair Match Enforcement**

## Overview

Tracks dominant win streaks and rebalances teams using a squad-preserving scramble algorithm. Designed for Squad servers to avoid steamrolling, reduce churn, and maintain match fairness over time.

Scramble execution swaps entire squads or unassigned players, balancing team sizes while respecting the 50-player cap and preserving squad cohesion. Includes dry-run mode for safe simulation, configurable thresholds, and fallback logic for emergency breaking if needed.

## Core Features

- **Win Streak Detection**: Detects dominant win streaks based on ticket difference thresholds
- **Automatic/Manual Scrambling**: Triggers squad-preserving scrambles automatically or on command
- **Multi-Mode Support**: Handles RAAS, AAS, and Invasion with separate logic per mode
- **Real-time Diagnostics**: Supports dry-run simulation and diagnostics via chat commands
- **Player Notifications**: Sends warning messages to swapped players (optional)
- **Comprehensive Logging**: Logs all actions with verbose debug output (configurable)

## Scramble Strategy

- Uses randomized backtracking to select balanced swap sets
- Applies swap actions through RCON using SquadJS interfaces
- Fills or trims teams after swap to achieve 50-player parity
- Breaks squads only if necessary to enforce hard team caps
- Fully supports lobbies with only unassigned players

## Installation

Add this to your `config.json` plugins array:

```json
{
  "plugin": "TeamBalancer",
  "enabled": true,
  "options": {
    "enableWinStreakTracking": true,
    "maxWinStreak": 2,
    "minTicketsToCountAsDominantWin": 175,
    "invasionAttackTeamThreshold": 300,
    "invasionDefenceTeamThreshold": 650,
    "scrambleAnnouncementDelay": 10,
    "showWinStreakMessages": true,
    "warnOnSwap": true,
    "dryRunMode": false,
    "debugLogs": false
  }
}
```

## Admin Commands

| Command | Description |
|---------|-------------|
| `!teambalancer status` | View win streak and plugin status |
| `!teambalancer dryrun on\|off` | Enable/disable dry-run (manual only) |
| `!teambalancer scramble` | Manually trigger scramble |
| `!scramble` | Shorthand for manual scramble |

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `enableWinStreakTracking` | Enable automatic scrambling logic | `true` |
| `maxWinStreak` | Wins needed to trigger scramble | `2` |
| `minTicketsToCountAsDominantWin` | Required ticket diff (non-Invasion) | `175` |
| `invasionAttackTeamThreshold` | Threshold for attackers (Invasion) | `300` |
| `invasionDefenceTeamThreshold` | Threshold for defenders (Invasion) | `650` |
| `scrambleAnnouncementDelay` | Delay (sec) before scramble executes | `10` |
| `dryRunMode` | Manual scramble simulation toggle | `false` |
| `showWinStreakMessages` | Broadcast win streak status | `true` |
| `warnOnSwap` | Notify players who are team-swapped | `true` |
| `debugLogs` | Print verbose internal debug output | `false` |

## Developer Mode

Set `devMode = true` to enable command testing in all chat (not admin-only).

## Author

**Slacker** (Discord: real_slacker) 
Michael Joyuce (mike.b.joyce@gmail.com)
---

*Built for SquadJS - Enhance your Squad server experience with fair and balanced matches*
