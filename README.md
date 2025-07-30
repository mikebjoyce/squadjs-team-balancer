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

## Scramble Algorithm

The plugin uses a sophisticated **squad-preserving team scramble** algorithm designed to balance teams while maintaining squad cohesion. The algorithm operates in five major phases:

### 1. Data Preparation
- Clones input data to avoid side effects
- Converts unassigned players into pseudo-squads of size 1
- Splits squads into team-based candidate pools

### 2. Swap Target Calculation
- Determines player imbalance using win streak team context
- Computes optimal number of players to swap for achieving parity

### 3. Backtracked Squad Selection
- Randomizes candidate pools and runs multiple swap attempts
- Selects squad sets that approach the calculated swap target
- Scores swaps based on player imbalance and overshoot metrics
- Short-circuits once an acceptable swap score is found

### 4. Mutual Swap Execution
- Swaps selected squads between teams
- Applies player team changes using RCON callbacks
- Preserves team ID sets for post-swap analysis

### 5. Emergency Trim/Break Phase
- If teams exceed hard caps after swaps:
  - Attempts to trim excess by breaking unlocked squads first
  - Falls back to breaking locked squads if necessary
  - Performs final safety checks to ensure cap enforcement

### Key Features
- **Squad Integrity**: Preserves full squad cohesion - no partial squad movement
- **Fallback Logic**: Robust handling of edge cases and invalid squad states
- **Team Size Caps**: Respects 50-player team limits with emergency breaking
- **Dry-Run Compatible**: Supports simulation mode for safe testing

## Installation

Add this to your `config.txt` plugins array:

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

## Commands

### Admin Commands

| Command | Description |
|---------|-------------|
| `!teambalancer on\|off` | Enable/disable win streak tracking system |
| `!teambalancer status` | View win streak and plugin status |
| `!teambalancer dryrun on\|off` | Enable/disable dry-run (manual only) |
| `!teambalancer scramble` | Manually trigger scramble |
| `!teambalancer diag` | Run diagnostic analysis with 3 dry-run simulations |
| `!scramble` | Shorthand for manual scramble |

### Player Commands

| Command | Description |
|---------|-------------|
| `!teambalancer` | Shows current win streak, last scramble, and plugin status |

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

**Slacker** (Discord: real_slacker / mike.b.joyce@gmail.com)

---

*Built for SquadJS - Enhance your Squad server experience with fair and balanced matches*
