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
  * - Handles RAAS, AAS, and Invasion with separate logic per mode.
  * - Supports real-time diagnostics and dry-run simulation via chat.
  * - Sends warning messages to swapped players (optional).
  * - Logs all actions with verbose debug output (configurable).
  *
  * SCRAMBLE STRATEGY:
  * - Uses randomized backtracking to select balanced swap sets.
  * - Applies swap actions through RCON using SquadJS interfaces.
  * - Fills or trims teams after swap to achieve 50-player parity.
  * - Breaks squads only if necessary to enforce hard team caps.
  * - Fully supports lobbies with only unassigned players.
  *
  * INSTALLATION:
  * Add this to your `config.json` plugins array:
  *
  * {
  *   "plugin": "TeamBalancer",
  *   "enabled": true,
  *   "options": {
  *     "enableWinStreakTracking": true,
  *     "maxWinStreak": 2,
  *     "minTicketsToCountAsDominantWin": 175,
  *     "invasionAttackTeamThreshold": 300,
  *     "invasionDefenceTeamThreshold": 650,
  *     "scrambleAnnouncementDelay": 10,
  *     "showWinStreakMessages": true,
  *     "warnOnSwap": true,
  *     "dryRunMode": false,
  *     "debugLogs": false
  *   }
  * }
  *
  * ADMIN COMMANDS:
  *   !teambalancer status           → View win streak and plugin status
  *   !teambalancer dryrun on|off    → Enable/disable dry-run (manual only)
  *   !teambalancer scramble         → Manually trigger scramble
  *   !scramble                      → Shorthand for manual scramble
  *
  * CONFIGURATION OPTIONS:
  *   enableWinStreakTracking        → Enable automatic scrambling logic
  *   maxWinStreak                   → Wins needed to trigger scramble
  *   minTicketsToCountAsDominantWin→ Required ticket diff (non-Invasion)
  *   invasionAttackTeamThreshold    → Threshold for attackers (Invasion)
  *   invasionDefenceTeamThreshold   → Threshold for defenders (Invasion)
  *   scrambleAnnouncementDelay      → Delay (sec) before scramble executes
  *   dryRunMode                     → Manual scramble simulation toggle
  *   showWinStreakMessages          → Broadcast win streak status
  *   warnOnSwap                     → Notify players who are team-swapped
  *   debugLogs                      → Print verbose internal debug output
  *
  * DEV MODE:
  *   Set devMode = true to enable command testing in all chat (not admin-only).
  *
  * AUTHOR:
  *   Slacker (Discord: real_slacker)
  *
  * ════════════════════════════════════════════════════════════════
  */
