# Team Balancer Plugin

**SquadJS Plugin for Fair Match Enforcement**

## Overview

Tracks dominant win streaks and rebalances teams using a squad-preserving scramble algorithm. Designed for Squad servers to avoid steamrolling, reduce churn, and maintain match fairness over time [cite: uploaded:team-balancer.js].

Scramble execution swaps entire squads or unassigned players, balancing team sizes while respecting the 50-player cap and preserving squad cohesion [cite: uploaded:team-balancer.js]. Includes dry-run mode, configurable thresholds, and fallback logic for emergency breaking if needed [cite: uploaded:team-balancer.js].

## Core Features

* **Win Streak Detection**: Detects dominant win streaks based on ticket difference thresholds [cite: uploaded:team-balancer.js].

* **Automatic/Manual Scrambling**: Triggers squad-preserving scrambles automatically or via admin command [cite: uploaded:team-balancer.js].

* **Multi-Mode Support**: Handles RAAS, AAS, and Invasion with separate logic.

* **Dry-Run Diagnostics**: Simulate scrambles without affecting players via chat commands [cite: uploaded:team-balancer.js].

* **Player Notifications**: Sends RCON warnings to swapped players (optional) [cite: uploaded:team-balancer.js].

* **Reliable Swap System**: Retries failed swaps until timeout expires [cite: uploaded:team-balancer.js].

* **Emergency Enforcement**: Breaks squads only if needed to enforce 50-player cap [cite: uploaded:team-balancer.js].

* **Generic Team Names**: Option to use "Team 1" / "Team 2" instead of faction names in broadcasts [cite: uploaded:team-balancer.js].

## Scramble Algorithm

Operates in 5 stages using randomized backtracking [cite: uploaded:team-balancer.js]:

1.  **Data Prep**: Normalizes squad data, converts lone players to pseudo-squads [cite: uploaded:team-balancer.js].

2.  **Target Calc**: Computes ideal player swap count from imbalance.

3.  **Backtracked Swaps**: Attempts multiple squad combinations with scoring [cite: uploaded:team-balancer.js].

4.  **Execution**: Performs mutual swaps with retry tracking [cite: uploaded:team-balancer.js].

5.  **Post-Fix**: Trims or breaks squads if over hard cap [cite: uploaded:team-balancer.js].

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
    "scramblePercentage": 0.5,
    "changeTeamRetryInterval": 200,
    "maxScrambleCompletionTime": 15000,
    "showWinStreakMessages": true,
    "warnOnSwap": true,
    "useGenericTeamNamesInBroadcasts": true,
    "debugLogs": false,
    "dryRunMode": true
  }
}
```

## Commands

### Admin

| Command | Description |
|---|---|
| `!teambalancer on|off` | Enable/disable auto-tracking [cite: uploaded:team-balancer.js]|
| `!teambalancer status` | Show plugin config, streak, and stats [cite: uploaded:team-balancer.js]|
| `!teambalancer debug on|off` | Enable/disable debug logging [cite: uploaded:team-balancer.js]|
| `!teambalancer diag` | Run 3 dry-run simulations [cite: uploaded:team-balancer.js]|
| `!teambalancer scramble` | Manual scramble with delay [cite: uploaded:team-balancer.js]|
| `!teambalancer cancel` | Cancel countdown [cite: uploaded:team-balancer.js]|
| `!scramble` | Alias for `!teambalancer scramble` [cite: uploaded:team-balancer.js]|
| `!scramble now` | Immediate scramble (no delay) [cite: uploaded:team-balancer.js]|
| `!scramble cancel` | Cancel pending countdown [cite: uploaded:team-balancer.js]|

### Player

| Command | Description |
|---|---|
| `!teambalancer` | Show win streak, last scramble, plugin state [cite: uploaded:team-balancer.js]|

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
| `useGenericTeamNamesInBroadcasts` | If true, broadcasts will use "Team 1" and "Team 2" instead of faction names. | `true` |
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

`!teambalancer diag` provides [cite: uploaded:team-balancer.js]:

-   Current plugin status
-   Team/squad distribution
-   3 dry-run scramble simulations
-   Debug logs (if enabled)

## Logging and Monitoring

The plugin provides comprehensive logging for debugging and monitoring [cite: uploaded:team-balancer.js]:

-   **Debug Logs**: Enable with `debugLogs: true` for verbose output
-   **Console Output**: All major actions logged to server console
-   **Player Warnings**: Optional RCON warnings sent to swapped players
-   **Scramble Tracking**: Detailed retry attempts and completion status

## Troubleshooting

### Common Issues

-   **Scramble not triggering**: Check if `enableWinStreakTracking` is true and plugin not manually disabled
-   **Players not moving**: Verify RCON connection and check retry logs in console
-   **Timeout errors**: Increase `maxScrambleCompletionTime` for slower servers

### Debug Mode

Enable debug logging to see detailed scramble execution [cite: uploaded:team-balancer.js]:

```json
{
  "debugLogs": true
}
```

This will show squad selection logic, player move attempts, and retry status in the console [cite: uploaded:team-balancer.js].

## Author

**Slacker**
Discord: `real_slacker`
Email: `mike.b.joyce@gmail.com`

---

*Built for SquadJS — Enhance match balance. Reduce churn. Keep players engaged.*

---
