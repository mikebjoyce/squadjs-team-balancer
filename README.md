# Team Balancer Plugin

**SquadJS Plugin for Fair Match Enforcement**

## Overview

Tracks dominant win streaks and rebalances teams using a squad-preserving scramble algorithm. Designed for Squad servers to avoid steamrolling, reduce churn, and maintain match fairness over time.

Scramble execution swaps entire squads or unassigned players, balancing team sizes while respecting the 50-player cap and preserving squad cohesion. Includes dry-run mode for safe simulation, configurable thresholds, fallback logic for emergency breaking, and a reliable 10-second retry system for failed player moves.

## Core Features

- **Win Streak Detection**: Detects dominant win streaks based on ticket difference thresholds
- **Automatic/Manual Scrambling**: Triggers squad-preserving scrambles automatically or on command
- **Multi-Mode Support**: Handles RAAS, AAS, and Invasion with separate logic per mode
- **Real-time Diagnostics**: Supports dry-run simulation and diagnostics via chat commands
- **Player Notifications**: Sends warning messages to swapped players (optional)
- **Comprehensive Logging**: Logs all actions with verbose debug output (configurable)
- **Reliable Swap System**: Tracks and retries failed swaps over configurable timeout period
- **Emergency Squad Breaking**: Fallback logic to enforce hard team caps when needed

## Scramble Algorithm

The plugin uses a sophisticated **squad-preserving team scramble** algorithm designed to balance teams while maintaining squad cohesion. The algorithm operates in five major phases:

### 1. Data Preparation
- Clones input data to avoid side effects
- Converts unassigned players into pseudo-squads of size 1
- Splits squads into team-based candidate pools
- Supports lobbies with only unassigned players

### 2. Swap Target Calculation
- Determines player imbalance using win streak team context
- Computes optimal number of players to swap for achieving parity
- Considers team size caps and current player distribution

### 3. Backtracked Squad Selection
- Randomizes candidate pools and runs multiple swap attempts (up to 25)
- Selects squad sets that approach the calculated swap target
- Scores swaps based on player imbalance and overshoot metrics
- Short-circuits once an acceptable swap score is found (≤2)

### 4. Mutual Swap Execution
- Swaps selected squads between teams simultaneously
- Applies player team changes using RCON callbacks with retry logic
- Preserves team ID sets for post-swap analysis
- Tracks swap progress with 10-second completion timeout

### 5. Emergency Trim/Break Phase
- If teams exceed hard caps after swaps:
  - Attempts to trim excess by breaking unlocked squads first
  - Falls back to breaking locked squads if necessary
  - Performs final safety checks to ensure cap enforcement

### Key Features
- **Squad Integrity**: Preserves full squad cohesion - no partial squad movement
- **Fallback Logic**: Robust handling of edge cases and invalid squad states
- **Team Size Caps**: Respects 50-player team limits with emergency breaking
- **Retry System**: Reliable player movement with configurable retry intervals
- **Dry-Run Compatible**: Supports simulation mode for safe testing

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
    "scrambleAnnouncementDelay": 12,
    "showWinStreakMessages": true,
    "warnOnSwap": true,
    "dryRunMode": true,
    "debugLogs": false,
    "scrambleRetryInterval": 1000,
    "scrambleCompletionTimeout": 10000
  }
}
```

## Commands

### Admin Commands

| Command | Description |
|---------|-------------|
| `!teambalancer on\|off` | Enable/disable win streak tracking system |
| `!teambalancer status` | View comprehensive win streak and plugin status |
| `!teambalancer dryrun on\|off` | Enable/disable dry-run mode (manual scrambles only) |
| `!teambalancer scramble` | Manually trigger scramble with countdown |
| `!teambalancer cancel` | Cancel pending scramble countdown |
| `!teambalancer diag` | Run diagnostic analysis with 3 dry-run simulations |
| `!scramble` | Shorthand for manual scramble with countdown |
| `!scramble now` | Immediate scramble execution (no countdown) |
| `!scramble cancel` | Cancel pending scramble countdown |

### Player Commands

| Command | Description |
|---------|-------------|
| `!teambalancer` | Shows current win streak, last scramble time, and plugin status |

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `enableWinStreakTracking` | Enable automatic scrambling logic | `true` |
| `maxWinStreak` | Dominant wins needed to trigger scramble | `2` |
| `minTicketsToCountAsDominantWin` | Required ticket difference (non-Invasion modes) | `175` |
| `invasionAttackTeamThreshold` | Threshold for attacking team (Invasion mode) | `300` |
| `invasionDefenceTeamThreshold` | Threshold for defending team (Invasion mode) | `650` |
| `scrambleAnnouncementDelay` | Countdown delay (seconds) before scramble executes | `12` |
| `dryRunMode` | Enable simulation mode for manual scrambles only | `true` |
| `showWinStreakMessages` | Broadcast win streak status messages | `true` |
| `warnOnSwap` | Send notifications to players who are team-swapped | `true` |
| `debugLogs` | Print verbose internal debug output to console | `false` |
| `scrambleRetryInterval` | Milliseconds between swap retry attempts | `1000` |
| `scrambleCompletionTimeout` | Total time to keep retrying swaps (milliseconds) | `10000` |

### Configuration Notes

- `scrambleAnnouncementDelay` minimum enforced at 10 seconds
- `scrambleRetryInterval` minimum enforced at 500ms  
- `scrambleCompletionTimeout` minimum enforced at 5000ms
- All thresholds are automatically validated on plugin startup

## Game Mode Support

### Standard Modes (RAAS/AAS)
- Uses `minTicketsToCountAsDominantWin` threshold (default: 175 tickets)
- Categorizes wins as: close, moderate, dominant, or stomp
- Different messaging for each win type

### Invasion Mode
- Separate thresholds for attacking vs defending teams
- Attackers need `invasionAttackTeamThreshold` tickets (default: 300)
- Defenders need `invasionDefenceTeamThreshold` tickets (default: 650)
- Specialized messaging for invasion scenarios

## Reliability Features

### Retry System
- Tracks all player moves during scrambles
- Retries failed moves every `scrambleRetryInterval` milliseconds
- Continues retrying until `scrambleCompletionTimeout` is reached
- Reports success/failure rates for each scramble session

### Error Handling
- Graceful handling of players leaving during scrambles
- Automatic cleanup of stale move requests
- Emergency squad breaking when team caps are exceeded
- Comprehensive logging of all edge cases

## Developer Mode

Set `devMode = true` in the constructor to enable command testing in all chat channels (not admin-only). Useful for testing and development environments.

## Diagnostics

The `!teambalancer diag` command provides:
- Current plugin status and configuration
- Team and squad distribution analysis  
- Active scramble system status
- Three dry-run scramble simulations
- Detailed console output for troubleshooting

## Technical Details

### Squad Preservation
- Never breaks squads during normal scrambling
- Only breaks squads in emergency situations (team size > 50)
- Prioritizes unlocked squads for emergency breaking
- Falls back to locked squads only when absolutely necessary

### Performance
- Efficient backtracking algorithm with early termination
- Randomized squad selection to avoid predictable patterns
- Configurable attempt limits to prevent excessive processing
- Memory-efficient cloning of game state for simulations

## Author

**Slacker** (Discord: real_slacker / mike.b.joyce@gmail.com)

---

*Built for SquadJS - Enhance your Squad server experience with fair and balanced matches*
