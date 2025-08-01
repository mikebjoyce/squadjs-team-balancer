# Team Balancer Plugin

**SquadJS Plugin for Fair Match Enforcement**

## Overview

Tracks dominant win streaks and rebalances teams using a squad-preserving scramble algorithm. Designed for Squad servers to avoid steamrolling, reduce churn, and maintain match fairness over time.

Scramble execution swaps entire squads or unassigned players, balancing team sizes while respecting the 50-player cap and preserving squad cohesion. Includes dry-run mode, configurable thresholds, fallback logic, a reliable retry system, and optional Discord integration for real-time match notifications.

## Core Features

- **Win Streak Detection**: Detects dominant win streaks based on ticket margins  
- **Automatic/Manual Scrambling**: Triggers squad-preserving scrambles automatically or via admin command  
- **Multi-Mode Support**: Handles RAAS, AAS, and Invasion with separate logic  
- **Dry-Run Diagnostics**: Simulate scrambles without affecting players  
- **Player Notifications**: Sends RCON warnings to swapped players (optional)  
- **Discord Integration**: Broadcasts win streaks, scrambles, and admin messages  
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

### Admin

| Command | Description |
|--------|-------------|
| `!teambalancer on|off` | Enable/disable auto-tracking |
| `!teambalancer status` | Show plugin config, streak, and stats |
| `!teambalancer dryrun on|off` | Toggle dry-run mode |
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

## Discord Integration

Send win streaks, scramble announcements, and admin responses to Discord via embeds.

### Setup

1. **Create a Discord Bot** at [discord.com/developers](https://discord.com/developers/applications)  
2. Enable **MESSAGE CONTENT** intent  
3. Invite bot with:  
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2048&scope=bot
   ```

4. **Set environment token** before starting SquadJS:
   ```bash
   export DISCORD_BOT_TOKEN=your_token_here
   ```

5. **Update config.json**:

```json
{
  "discordEnabled": true,
  "discordChannelID": "PUBLIC_CHANNEL_ID",
  "discordAdminChannelID": "ADMIN_CHANNEL_ID",
  "discordEmbedColor": "#888888",
  "discordScrambleColor": "#E67E22",
  "discordWinStreakColor": "#3498DB",
  "discordIncludeServerName": true
}
```

### Discord Config Options

| Key | Description |
|-----|-------------|
| `discordEnabled` | Enable Discord output |
| `discordChannelID` | Channel for public posts |
| `discordAdminChannelID` | Channel for admin confirmations |
| `discordEmbedColor` | Default embed color |
| `discordScrambleColor` | Color for scramble notices |
| `discordWinStreakColor` | Color for streak notifications |
| `discordIncludeServerName` | Adds server name to embed title |

## Game Mode Support

- **RAAS / AAS**: Uses standard ticket diff threshold  
- **Invasion**: Uses separate thresholds for attackers and defenders  
- Mode-aware streak logic and messaging  

## Reliability

- Retries failed moves until `scrambleCompletionTimeout`  
- Handles player disconnects and locked squads  
- Breaks squads only as a last resort  

## Developer Mode

Set `devMode = true` in the constructor to allow commands from all chat (not just admins).

## Diagnostics

`!teambalancer diag` provides:

- Current plugin status  
- Team/squad distribution  
- 3 dry-run scramble simulations  
- Debug logs (if enabled)  

## Author

**Slacker**  
Discord: `real_slacker`  
Email: `mike.b.joyce@gmail.com`

---

*Built for SquadJS — Enhance match balance. Reduce churn. Keep players engaged.*
