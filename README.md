# Team Balancer Plugin

**SquadJS Plugin for Fair Match Enforcement**

## Overview

Tracks dominant win streaks and rebalances teams using a squad-preserving scramble algorithm. Designed for Squad servers to avoid steamrolling, reduce churn, and maintain match fairness over time.

Scramble execution swaps entire squads or unassigned players, balancing team sizes while respecting the 50-player cap and preserving squad cohesion. Includes dry-run mode, configurable thresholds, fallback logic, and a reliable retry system with comprehensive logging.

## Core Features

- **Win Streak Detection**: Detects dominant win streaks based on ticket margins  
- **Automatic/Manual Scrambling**: Triggers squad-preserving scrambles automatically or via admin command  
- **Multi-Mode Support**: Handles RAAS, AAS, and Invasion with separate logic  
- **Dry-Run Diagnostics**: Simulate scrambles without affecting players  
- **Player Notifications**: Sends RCON warnings to swapped players (optional)  
- **Reliable Swap System**: Retries failed swaps until timeout expires  
- **Emergency Enforcement**: Breaks squads only if needed to enforce 50-player cap  

## Scramble Algorithm

Operates in 5 stages using randomized backtracking:

1. **Data Prep**: Normalizes squad data, converts lone players to pseudo-squads  
2. **Target Calc**: Computes ideal player swap count from imbalance  
3. **Backtracked Swaps**: Attempts multiple squad combinations with scoring  
4. **Execution**: Performs mutual swaps with retry tracking  
5. **Post-Fix**: Trims or breaks squads if over hard cap  

## Installation

Add to your `config.json`:

```json
{
  "plugin": "TeamBalancer",
  "enabled": true,
  "options": {
    "enableWinStreakTracking": true,
    "maxWinStreak": 2,
    "minTicketsToCountAsDominantWin": 150,
    "invasionAttackTeamThreshold": 300,
    "invasionDefenceTeamThreshold": 650,
    "scrambleAnnouncementDelay": 12,
    "showWinStreakMessages": true,
    "warnOnSwap": true,
    "dryRunMode": true,
    "debugLogs": false,
    "changeTeamRetryInterval": 50,
    "maxScrambleCompletionTime": 15000
  }
}
```

## Commands

### Admin

| Command | Description |
|--------|-------------|
| `!teambalancer on\|off` | Enable/disable auto-tracking |
| `!teambalancer status` | Show plugin config, streak, and stats |
| `!teambalancer dryrun on\|off` | Toggle dry-run mode |
| `!teambalancer scramble` | Manual scramble with delay |
| `!teambalancer cancel` | Cancel countdown |
| `!teambalancer diag` | Run 3 dry-run simulations |
| `!scramble` | Alias for `!teambalancer scramble` |
| `!scramble now` | Immediate scramble (no delay) |
| `!scramble cancel` | Cancel pending countdown |

### Player

| Command | Description |
|---------|-------------|
| `!teambalancer` | Show win streak, last scramble, plugin state |

## Configuration Options

| Key | Description | Default |
|-----|-------------|---------|
| `enableWinStreakTracking` | Auto-scramble trigger system | `true` |
| `maxWinStreak` | Wins before scramble | `2` |
| `minTicketsToCountAsDominantWin` | Margin threshold (non-Invasion) | `175` |
| `invasionAttackTeamThreshold` | Margin for attackers | `300` |
| `invasionDefenceTeamThreshold` | Margin for defenders | `650` |
| `scrambleAnnouncementDelay` | Delay before scramble (s) | `12` |
| `dryRunMode` | Safe simulation mode | `true` |
| `showWinStreakMessages` | Broadcast streak messages | `true` |
| `warnOnSwap` | Notify swapped players | `true` |
| `debugLogs` | Enable debug logging | `false` |
| `scrambleRetryInterval` | Retry delay (ms) | `1000` |
| `scrambleCompletionTimeout` | Total retry timeout (ms) | `10000` |

### Notes

- `scrambleAnnouncementDelay` minimum: 10 sec  
- `scrambleRetryInterval` minimum: 500 ms  
- `scrambleCompletionTimeout` minimum: 5000 ms  
- All options validated on startup  

## Game Mode Support

- **RAAS / AAS**: Uses standard ticket diff threshold  
- **Invasion**: Uses separate thresholds for attackers and defenders  
- Mode-aware streak logic and messaging  

## Developer Mode

Set `devMode = true` in the constructor to allow commands from all chat (not just admins).

## Diagnostics

`!teambalancer diag` provides:

- Current plugin status  
- Team/squad distribution  
- 3 dry-run scramble simulations  
- Debug logs (if enabled)  

## Logging and Monitoring

The plugin provides comprehensive logging for debugging and monitoring:

- **Debug Logs**: Enable with `debugLogs: true` for verbose output
- **Console Output**: All major actions logged to server console
- **Player Warnings**: Optional RCON warnings sent to swapped players
- **Scramble Tracking**: Detailed retry attempts and completion status

## Troubleshooting

### Common Issues

- **Scramble not triggering**: Check if `enableWinStreakTracking` is true and plugin not manually disabled
- **Players not moving**: Verify RCON connection and check retry logs in console
- **Timeout errors**: Increase `scrambleCompletionTimeout` for slower servers

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
