
/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                      TEAM BALANCER PLUGIN                     ║
 * ║             SquadJS Plugin for Fair Match Enforcement         ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * OVERVIEW:
 * Tracks dominant win streaks and rebalances teams using a squad-preserving
 * scramble algorithm. Designed for Squad servers to avoid steamrolling,
 * reduce churn, and maintain match fairness over time.
 *
 * Scramble execution swaps entire squads or unassigned players, balancing
 * team sizes while respecting the 50-player cap and preserving squad cohesion.
 * Includes dry-run mode for safe simulation, configurable thresholds, and
 * fallback logic for emergency breaking if needed.
 *
 * CORE FEATURES:
 * - Detects dominant win streaks based on ticket difference thresholds.
 * - Triggers automatic or manual squad-preserving scrambles.
 * - Supports real-time diagnostics and dry-run simulation via chat.
 * - Sends warning messages to swapped players (optional).
 * - Logs all actions with verbose debug output (configurable).
 * - Reliable swap system with retry mechanism for failed moves.
 * - Option to use generic "Team 1" and "Team 2" names in broadcasts.
 *
 * SCRAMBLE STRATEGY:
 * - Uses randomized backtracking to select balanced swap sets.
 * - Applies swap actions through RCON using SquadJS interfaces.
 * - Tracks and retries failed swaps over configurable timeouts.
 * - Fills or trims teams after swaps to achieve near 50-player parity.
 * - Breaks squads only if necessary to enforce hard team caps.
 *
 * INSTALLATION:
 * Add this to your `config.json` plugins array:
 *

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
 *
 * ADMIN COMMANDS:
 * !teambalancer on|off           → Enable/disable win streak tracking system
 * !teambalancer status           → View win streak and plugin status
 * !teambalancer dryrun on|off    → Enable/disable dry-run (manual only)
 * !teambalancer debug on|off     → Enable/disable debug logging
 * !teambalancer diag             → Runs diagnostic with dry-run scrambles
 * !teambalancer scramble         → Manually trigger scramble with countdown
 * !teambalancer cancel           → Cancel pending scramble countdown
 * !scramble                      → Alias for manual scramble with countdown
 * !scramble now                  → Immediate scramble (no countdown)
 * !scramble cancel               → Cancel pending scramble countdown
 *
 * CHAT COMMANDS:
 * !teambalancer                  → Shows current win streak, last scramble, plugin status
 *
 * CONFIGURATION OPTIONS:
 *
 * enableWinStreakTracking        - Enables or disables the automatic win streak tracking system.
 * maxWinStreak                   - The number of dominant wins required for a team to trigger an automatic scramble.
 * minTicketsToCountAsDominantWin - The minimum ticket difference required for a win to be considered "dominant" in non-Invasion game modes.
 * invasionAttackTeamThreshold    - The ticket difference threshold for the attacking team to be considered "dominant" in Invasion game mode.
 * invasionDefenceTeamThreshold   - The ticket difference threshold for the defending team to be considered "dominant" in Invasion game mode.
 *
 * Scramble Execution & Messaging:
 * scrambleAnnouncementDelay      - The delay in seconds before a scramble executes after being announced.
 * scramblePercentage             - The percentage of total players the scramble algorithm will attempt to move to balance teams (0.0 to 1.0).
 * changeTeamRetryInterval        - The interval in milliseconds between retry attempts when moving players between teams.
 * maxScrambleCompletionTime      - The maximum total time in milliseconds allowed for all player swaps to complete during a scramble.
 * showWinStreakMessages          - Controls whether messages about win streaks are broadcast to the server.
 * warnOnSwap                     - Controls whether players receive a warning message when they are swapped between teams.
 * useGenericTeamNamesInBroadcasts - If true, broadcasts will use "Team 1" and "Team 2" instead of faction names.
 *
 * Debug & Simulation:
 * debugLogs                      - Enables verbose debug logging to the server console.
 * dryRunMode                     - If true, manual scrambles will only simulate the moves without actually executing them via RCON.
 *
 * DEV MODE:
 * Set devMode = true to enable command testing in all chat (not admin-only).
 *
 * AUTHOR:
 * Slacker (Discord: real_slacker)
 *
 * ════════════════════════════════════════════════════════════════
 */