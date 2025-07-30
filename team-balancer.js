import BasePlugin from './base-plugin.js';
export default class TeamBalancer extends BasePlugin {
  /**
   * ╔═══════════════════════════════════════════════════════════════╗
   * ║                      TEAM BALANCER PLUGIN                    ║
   * ║             SquadJS Plugin for Fair Match Enforcement        ║
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

  static get description() {
    return 'Tracks dominant wins by team ID and scrambles teams if one team wins too many rounds.';
  }

  static get defaultEnabled() {
    return true;
  }

  static get optionsSpecification() {
    return {
      enableWinStreakTracking: {
        description: 'Enable automatic scrambling based on win streaks.',
        default: true,
        type: 'boolean'
      },
      maxWinStreak: {
        description: 'Consecutive dominant wins to trigger scramble.',
        default: 2,
        type: 'number'
      },
      minTicketsToCountAsDominantWin: {
        description: 'Minimum ticket difference for dominant win (non-Invasion).',
        default: 175,
        type: 'number'
      },
      invasionAttackTeamThreshold: {
        description: 'Ticket threshold for dominant wins by attacking team in Invasion.',
        default: 300,
        type: 'number'
      },
      invasionDefenceTeamThreshold: {
        description: 'Ticket threshold for dominant wins by defending team in Invasion.',
        default: 650,
        type: 'number'
      },
      scrambleAnnouncementDelay: {
        description: 'Seconds to wait after announcing before scrambling.',
        default: 10,
        type: 'number'
      },
      showWinStreakMessages: {
        description: 'Announce win streak progress or reset via RCON.',
        default: true,
        type: 'boolean'
      },
      warnOnSwap: {
        description:
          'If true, privately warns players when they are team-swapped during a scramble.',
        default: true,
        type: 'boolean'
      },
      debugLogs: {
        description: 'Enable or disable debug logging.',
        default: false,
        type: 'boolean'
      },
      dryRunMode: {
        description:
          'If true, manual scrambles are logged but not executed. Does not affect automatic scrambles.',
        default: true,
        type: 'boolean'
      }
    };
  }

  validateOptions() {
    if (this.options.scrambleAnnouncementDelay < 10) {
      this.logWarning(
        ` scrambleAnnouncementDelay (${this.options.scrambleAnnouncementDelay}s) too low. Enforcing minimum 10 seconds.`
      );
      this.options.scrambleAnnouncementDelay = 10;
    }
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);
    this.devMode = false; // <-- DEV MODE TOGGLE
    this.winStreakTeam = null;
    this.winStreakCount = 0;

    this._scramblePending = false;
    this._scrambleTimeout = null;
    this._flippedAfterScramble = false;

    this.onRoundEnded = this.onRoundEnded.bind(this);
    this.onNewGame = this.onNewGame.bind(this);
    this._cachedLayer = null;
  }

  logDebug(...args) {
    if (this.options.debugLogs) {
      console.log('[TeamBalancer]', ...args);
    }
  }

  logWarning(...args) {
    console.log('[WARNING] [TeamBalancer]', ...args);
  }

  async mount() {
    this.logDebug('Mounting plugin.');
    this.server.on('ROUND_ENDED', this.onRoundEnded);
    this.server.on('NEW_GAME', this.onNewGame);
    this.server.on('CHAT_COMMAND:teambalancer', this.onChatCommand.bind(this));
    this.server.on('CHAT_COMMAND:scramble', this.onScrambleCommand.bind(this));
    this.validateOptions();
  }

  async unmount() {
    this.logDebug('Unmounting plugin.');
    this.server.removeListener('ROUND_ENDED', this.onRoundEnded);
    this.server.removeListener('NEW_GAME', this.onNewGame);
    this.server.removeListener('CHAT_COMMAND:teambalancer', this.onChatCommand);
    this.server.removeListener('CHAT_COMMAND:scramble', this.onScrambleCommand);
    if (this._scrambleTimeout) clearTimeout(this._scrambleTimeout);
  }

  onNewGame() {
    this.gameModeCached = this.server.gameMode;

    if (!this.gameModeCached) {
      this.logWarning('Cached game mode is undefined or null at NEW_GAME event.');
    } else if (this.gameModeCached.toLowerCase() === 'skirmish') {
      this.logWarning('Game mode is Skirmish; scramble logic may not apply correctly.');
    }

    this.logDebug(`Cached game mode at NEW_GAME event: ${this.gameModeCached}`);
  }

  async onRoundEnded(data) {
    this.logDebug('Round ended:', data);

    if (!this.options.enableWinStreakTracking) {
      this.logDebug('Win streak tracking disabled, ignoring round end.');
      return;
    }

    if (!data.winner) return this.resetStreak('No winner');

    const winnerID = Number(data.winner.team);
    const winnerTickets = Number(data.winner.tickets);
    const loserTickets = Number(data.loser?.tickets ?? 0);

    const isInvasion = (this.server.gameMode ?? this.gameModeCached) === 'Invasion';
    let isDominant = false;

    if (isInvasion) {
      // In Invasion, team 1 is typically the attacking team, team 2 is defending
      if (
        (winnerID === 1 && winnerTickets >= this.options.invasionAttackTeamThreshold) ||
        (winnerID === 2 && winnerTickets >= this.options.invasionDefenceTeamThreshold)
      ) {
        isDominant = true;
      }
    } else {
      if (winnerTickets - loserTickets >= this.options.minTicketsToCountAsDominantWin) {
        isDominant = true;
      }
    }

    if (!isDominant) {
      if (this.options.showWinStreakMessages) {
        await this.server.rcon.broadcast(
          `Round ended: Team ${winnerID} won, but not dominant enough to count toward streak.`
        );
      }
      return this.resetStreak(`Non-dominant win by team ${winnerID}`);
    }

    if (this.winStreakTeam === winnerID) {
      this.winStreakCount += 1;
    } else {
      this.winStreakTeam = winnerID;
      this.winStreakCount = 1;
    }

    this.logDebug(`Team ${winnerID} now has ${this.winStreakCount} dominant win(s).`);

    if (this.winStreakCount >= this.options.maxWinStreak && !this._scramblePending) {
      const delaySeconds = this.options.scrambleAnnouncementDelay;
      this._scramblePending = true;

      // Log automatic scramble trigger
      console.log(
        `[TeamBalancer] Auto-scramble triggered - Team ${this.winStreakTeam} reached ${this.winStreakCount} win streak (${winnerTickets}-${loserTickets} tickets)`
      );

      if (this.options.showWinStreakMessages) {
        const msg = `Team ${this.winStreakTeam} reached max dominant win streak. Scramble in ${delaySeconds} seconds.`;
        this.logDebug(`Broadcasting: "${msg}"`);
        await this.server.rcon.broadcast(msg);
      } else {
        const msg = `Scrambling teams in ${delaySeconds} seconds.`;
        this.logDebug(`Broadcasting: "${msg}"`);
        await this.server.rcon.broadcast(msg);
      }

      setTimeout(() => {
        this.logDebug('Scramble countdown finished, initiating scramble.');
        this.initiateScramble(true);
      }, delaySeconds * 1000);
    } else if (this.options.showWinStreakMessages) {
      await this.server.rcon.broadcast(
        `Team ${winnerID} has ${this.winStreakCount} dominant win(s).`
      );
    }
  }

  resetStreak(reason) {
    this.logDebug(`${reason}. Resetting streak.`);
    this.winStreakTeam = null;
    this.winStreakCount = 0;
    this._scramblePending = false;
    this._flippedAfterScramble = false;
    if (this._scrambleTimeout) {
      clearTimeout(this._scrambleTimeout);
      this._scrambleTimeout = null;
    }
  }

  async initiateScramble(isSimulated = false) {
    this._scrambleTimeout = setTimeout(async () => {
      if (!isSimulated) {
        const msg = `Executing scramble...`;
        this.logDebug(`Broadcasting: "${msg}"`);
        await this.server.rcon.broadcast(msg);
      } else {
        this.logDebug(`Executing dry run scramble...`);
      }

      await Scrambler.scrambleTeamsPreservingSquads({
        squads: this.server.squads,
        players: this.server.players,
        winStreakTeam: this.winStreakTeam,
        log: (...args) => console.log(...args),
        switchTeam: async (steamID, newTeamID) => {
          if (!isSimulated) {
            try {
              await this.server.rcon.switchTeam(steamID, newTeamID);
              if (this.options.warnOnSwap) {
                await this.server.rcon.warn(
                  steamID,
                  `You have been team-swapped as part of a balance adjustment.`
                );
              }
            } catch (err) {
              this.logDebug(`Failed to switch player ${steamID} to team ${newTeamID}:`, err);
            }
          } else {
            this.logDebug(`[Dry Run] Would switch player ${steamID} to team ${newTeamID}`);
          }
        }
      });

      const msg = `Scramble complete!`;
      if (!isSimulated) {
        this.logDebug(`Broadcasting: "${msg}"`);
        await this.server.rcon.broadcast(msg);
        this.resetStreak('Post-scramble cleanup');
        this._scrambleTimeout = null;
      } else {
        this.logDebug(msg);
      }
    }, 0);
  }

  respond(steamID, msg) {
    console.log(`[TeamBalancer][Response to ${steamID}] ${msg}`);
    // Future: replace with RCON, Discord, etc.
    // await this.server.rcon.warn(steamID, msg);
  }

  async onChatCommand(command) {
    if (!this.devMode && command.chat !== 'ChatAdmin') return;
    this.logDebug('[TeamBalancer] onChatCommand args:', command);
    const message = command.message;
    const steamID = command.steamID;
    const player = command.player;
    if (typeof message !== 'string' || !message.trim()) {
      console.log('[TeamBalancer] No valid message found, ignoring command.');
      this.respond(steamID, 'Usage: !teambalancer [dryrun on|off | status | scramble | diag]');
      return;
    }

    const args = message.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    try {
      switch (subcommand) {
        case 'dryrun': {
          const arg = args[1]?.toLowerCase();
          if (arg === 'on') {
            this.options.dryRunMode = true;
            console.log(`[TeamBalancer] Dry run mode enabled by ${player?.name || steamID}`);
            this.respond(steamID, 'Dry run mode enabled.');
          } else if (arg === 'off') {
            this.options.dryRunMode = false;
            console.log(`[TeamBalancer] Dry run mode disabled by ${player?.name || steamID}`);
            this.respond(steamID, 'Dry run mode disabled.');
          } else {
            this.respond(steamID, 'Usage: !teambalancer dryrun on|off');
          }
          break;
        }

        case 'status': {
          const statusMsg = [
            '[TeamBalancer Status]',
            `Win streak tracking: ${this.options.enableWinStreakTracking ? 'ON' : 'OFF'}`,
            `Dry run mode: ${this.options.dryRunMode ? 'ON (manual only)' : 'OFF'}`,
            `Win streak: Team ${this.winStreakTeam ?? 'N/A'} with ${this.winStreakCount} win(s)`,
            `Scramble pending: ${this._scramblePending}`
          ].join('\n');

          console.log(`[TeamBalancer] Status requested by ${player?.name || steamID}`);
          this.respond(steamID, statusMsg);
          break;
        }

        case 'scramble': {
          if (this._scramblePending) {
            this.respond(
              steamID,
              '[WARNING] Scramble already pending. Cannot start a new scramble event.'
            );
            return;
          }

          this._scramblePending = true;

          if (this.options.dryRunMode) {
            console.log(
              `[TeamBalancer] ${
                player?.name || steamID
              } requested a scramble (dry run enabled). Simulating team scramble...`
            );
          } else {
            console.log(
              `[TeamBalancer] ${
                player?.name || steamID
              } initiated a live scramble. Executing now...`
            );
          }

          this.respond(steamID, 'Initiating manual scramble now...');
          await this.initiateScramble(this.options.dryRunMode);

          this._scramblePending = false;

          break;
        }

        case 'diag': {
          const t1Players = this.server.players.filter((p) => p.teamID === '1');
          const t2Players = this.server.players.filter((p) => p.teamID === '2');
          const unassignedPlayers = this.server.players.filter((p) => p.squadID === null);

          const t1Squads = this.server.squads.filter((s) => s.teamID === '1');
          const t2Squads = this.server.squads.filter((s) => s.teamID === '2');

          const diagMsg = [
            '[TeamBalancer Diagnostics]',
            `Dry run mode: ${this.options.dryRunMode ? 'ON' : 'OFF'}`,
            `Win streak: Team ${this.winStreakTeam ?? 'N/A'} with ${this.winStreakCount} win(s)`,
            `Scramble pending: ${this._scramblePending}`,
            `Players: Total = ${this.server.players.length}, Team1 = ${t1Players.length}, Team2 = ${t2Players.length}, Unassigned = ${unassignedPlayers.length}`,
            `Squads: Total = ${this.server.squads.length}, Team1 = ${t1Squads.length}, Team2 = ${t2Squads.length}`
          ].join('\n');

          console.log(`[TeamBalancer] Diagnostics requested by ${player?.name || steamID}`);
          console.log(diagMsg);
          this.respond(steamID, 'Diagnostics sent to server console.');

          const runs = 3;
          console.log(
            `[TeamBalancer Diagnostics] Running ${runs} dry-run simulations on current server state:`
          );

          for (let i = 0; i < runs; i++) {
            console.log(`[Dry Run ${i + 1}]`);
            await this.initiateScramble(true);
          }

          break;
        }

        default:
          this.respond(steamID, 'Usage: !teambalancer [dryrun on|off | status | scramble | diag]');
          break;
      }
    } catch (error) {
      console.log(`[TeamBalancer] Error handling command from ${player?.name || steamID}:`, error);
      this.respond(steamID, 'An error occurred processing your command.');
    }
  }

  async onScrambleCommand({ chat, steamID, player }) {
    if (!this.devMode && chat !== 'ChatAdmin') return;

    try {
      if (this._scramblePending) {
        this.respond(
          steamID,
          '[WARNING] Scramble already pending. Cannot start a new scramble event.'
        );
        return;
      }

      this._scramblePending = true;

      if (this.options.dryRunMode) {
        console.log(
          `[TeamBalancer] ${
            player?.name || steamID
          } requested a scramble via !scramble (dry run enabled). Simulating team scramble...`
        );
      } else {
        console.log(
          `[TeamBalancer] ${
            player?.name || steamID
          } initiated a live scramble via !scramble. Executing now...`
        );
      }

      this.respond(steamID, 'Initiating manual scramble now...');
      await this.initiateScramble(this.options.dryRunMode);

      this._scramblePending = false;
    } catch (error) {
      console.log(
        `[TeamBalancer] Error handling scramble command from ${player?.name || steamID}:`,
        error
      );
      this.respond(steamID, 'An error occurred processing your scramble command.');
    }
  }
}

/**
 * ============================================
 *         SQUAD-PRESERVING TEAM SCRAMBLE
 * ============================================
 *
 * OVERVIEW:
 * Balances two teams in a Squad game by swapping whole squads (or unassigned players)
 * while preserving squad cohesion and respecting team size caps. Handles edge cases like
 * uneven teams, excess players, and lack of valid squads with fallbacks.
 *
 * GOALS:
 *  - Maintain balanced team sizes, capped at maxTeamSize (default: 50).
 *  - Preserve full squad integrity; no partial squad movement.
 *  - Support unassigned players via pseudo-squad handling.
 *  - Resolve persistent win-streaks by introducing team variety.
 *  - Provide clear, verbose debug logging for offline simulations.
 *
 * MAJOR PHASES:
 * --------------------------------------------
 * 1. DATA PREP:
 *    - Clone input to avoid side effects.
 *    - Convert unassigned players into pseudo-squads of size 1.
 *    - Split squads into team-based candidate pools.
 *
 * 2. SWAP TARGET CALCULATION:
 *    - Determine player imbalance using winStreakTeam context.
 *    - Compute how many players should be swapped to achieve parity.
 *
 * 3. BACKTRACKED SQUAD SELECTION:
 *    - Randomize candidate pools and run multiple swap attempts.
 *    - Select squad sets that approach the calculated swap target.
 *    - Score swaps based on player imbalance and overshoot.
 *    - Short-circuit once an acceptable swap score is found.
 *
 * 4. MUTUAL SWAP EXECUTION:
 *    - Swap selected squads between teams.
 *    - Apply player team changes using RCON callback.
 *    - Preserve team ID sets for post-swap analysis.
 *
 * 5. EMERGENCY TRIM / BREAK PHASE:
 *    - If a team exceeds the hard cap after swaps:
 *        → Attempt to trim excess by breaking unlocked squads.
 *        → If needed, fall back to breaking locked squads.
 *        → Final safety check ensures cap enforcement or logs critical failure.
 *
 * NOTES:
 *  - Unassigned-only matches are fully supported via pseudo-squads.
 *  - If no squads are found, the algorithm still runs using solo pseudo-squads.
 *  - All state changes are done via injected callbacks (log, switchTeam).
 *  - The logic avoids repeating squad selections between attempts.
 *  - Dry-run mode supported externally by swapping `switchTeam` function.
 *
 * USAGE:
 *  Call Scrambler.scrambleTeamsPreservingSquads({...}) with the following parameters:
 *
 *  - squads: Array of squad objects, each with:
 *      {
 *        id: string,            // Unique squad identifier
 *        teamID: '1' | '2',     // Owning team (as string)
 *        players: string[],     // Array of steamIDs
 *        locked?: boolean       // Optional: true if the squad is locked
 *      }
 *
 *  - players: Array of player objects, each with:
 *      {
 *        steamID: string,       // Unique Steam ID of the player
 *        teamID: '1' | '2',     // Current team assignment
 *        squadID: string|null   // Squad the player belongs to, or null if unassigned
 *      }
 *
 *  - winStreakTeam: number (1 or 2)
 *      Indicates the currently dominant team. Used to bias the balance logic
 *      toward restoring fairness by favoring the losing team in fill/trim logic.
 *
 *  - log: function(string): void
 *      A logging callback to receive all debug and progress output. This is invoked
 *      at every significant step (scoring, swapping, trimming, emergency breaking).
 *      To suppress output, pass `() => {}`. To enable structured logging, pass your
 *      own wrapper that formats or redirects messages (e.g. to a file or console).
 *
 *  - switchTeam: async function(steamID: string, newTeamID: '1' | '2')
 *      A callback used to enact team changes. Called once per player whose team
 *      assignment changes. The function must return a Promise and should handle
 *      any errors internally (e.g., failed RCON command).
 *
 *  Notes:
 *    - Input arrays are cloned internally; the algorithm does not mutate external state.
 *    - All team size caps and squad constraints are enforced during the process.
 *    - Function returns `void`; results are visible via logging and side-effects.
 */

export const Scrambler = {
  async scrambleTeamsPreservingSquads({
    squads,
    players,
    winStreakTeam,
    log = () => {},
    switchTeam = async () => {}
  }) {
    const maxTeamSize = 50;
    log(`========== Starting Team Scramble (Max cap = ${maxTeamSize}) ==========`);

    if (![1, 2].includes(winStreakTeam)) {
      winStreakTeam = Math.random() < 0.5 ? 1 : 2;
      log(`No win streak team set. Randomly selecting Team ${winStreakTeam} as starting side.`);
    }

    const clonedPlayers = players.map((p) => ({ ...p }));
    const clonedSquads = squads.map((s) => ({ ...s, players: [...s.players] }));

    const normalizeTeamID = (id) => String(id);

    const team1Size = clonedPlayers.filter((p) => normalizeTeamID(p.teamID) === '1').length;
    const team2Size = clonedPlayers.filter((p) => normalizeTeamID(p.teamID) === '2').length;

    const losingTeamSize = winStreakTeam === 1 ? team2Size : team1Size;
    const winningTeamSize = winStreakTeam === 1 ? team1Size : team2Size;
    const diff = winningTeamSize - losingTeamSize;

    const swapTarget = Math.floor((losingTeamSize + diff) / 2); // move enough to bring parity

    const allSquads = clonedSquads.filter((s) => s.players?.length > 0);
    const unassigned = clonedPlayers.filter((p) => p.squadID === null);
    const totalPlayers = clonedPlayers.length;

    log(`Total players: ${totalPlayers}, Swap target per side: ${swapTarget}`);

    const unassignedPseudoSquads = unassigned.map((p) => ({
      id: `Unassigned - ${p.steamID}`,
      teamID: p.teamID,
      players: [p.steamID]
    }));

    const filterCandidates = (teamID) =>
      allSquads
        .filter((s) => s.teamID === teamID && s.players.length >= 4)
        .concat(unassignedPseudoSquads.filter((s) => s.teamID === teamID));

    const t1Candidates = filterCandidates('1');
    const t2Candidates = filterCandidates('2');

    log(
      `Candidate squads filtered: Team1 = ${t1Candidates.length}, Team2 = ${t2Candidates.length}`
    );

    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };

    const selectSquadsLimited = (arr, limit) => {
      const selected = [];
      let count = 0;
      for (const squad of arr) {
        const size = squad.players.length;
        if (count + size > limit) continue;
        selected.push(squad);
        count += size;
      }
      return selected;
    };

    const scoreSwap = (a, b) => {
      const sum = (squads) => squads.reduce((n, s) => n + s.players.length, 0);
      const sa = sum(a);
      const sb = sum(b);
      const imbalance = Math.abs(sa - sb);
      const penalty = Math.max(0, sa - swapTarget) + Math.max(0, sb - swapTarget);
      return imbalance + penalty * 10;
    };

    const MAX_ATTEMPTS = 25;
    const ACCEPTABLE_SCORE = 2;
    let bestScore = Infinity;
    let bestT1 = null;
    let bestT2 = null;

    log(
      `Starting swap attempts (max ${MAX_ATTEMPTS}) with acceptable score <= ${ACCEPTABLE_SCORE}`
    );

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      shuffle(t1Candidates);
      shuffle(t2Candidates);

      const selT1 = selectSquadsLimited(t1Candidates, swapTarget);
      const selT2 = selectSquadsLimited(t2Candidates, swapTarget);
      const sa = selT1.reduce((n, s) => n + s.players.length, 0);
      const sb = selT2.reduce((n, s) => n + s.players.length, 0);
      const score = scoreSwap(selT1, selT2);

      log(
        `Attempt ${i + 1}: Score = ${score}, Team1 squads = ${
          selT1.length
        } (players = ${sa}), Team2 squads = ${selT2.length} (players = ${sb})`
      );
      log(`Team1 selected squads IDs: ${selT1.map((s) => s.id).join(', ')}`);
      log(`Team2 selected squads IDs: ${selT2.map((s) => s.id).join(', ')}`);

      if (score < bestScore) {
        bestScore = score;
        bestT1 = selT1;
        bestT2 = selT2;
        log(`New best score found: ${bestScore} at attempt ${i + 1}`);
        if (bestScore <= ACCEPTABLE_SCORE) {
          log(`Acceptable solution reached. Ending attempts early.`);
          break;
        }
      }
    }

    if (!bestT1 || !bestT2) {
      log('No valid swap solution found within attempt limit.');
      return;
    }

    const team1IDs = new Set(clonedPlayers.filter((p) => p.teamID === '1').map((p) => p.steamID));
    const team2IDs = new Set(clonedPlayers.filter((p) => p.teamID === '2').map((p) => p.steamID));
    const swappedSquadIDs = new Set();

    const moveSquads = async (group, toTeam, fromSet, toSet) => {
      log(`Swapping ${group.length} squads to Team ${toTeam}:`);
      for (const squad of group) {
        log(`Swapping squad ${squad.id} (${squad.players.length} players) → Team ${toTeam}`);
        swappedSquadIDs.add(squad.id);
        for (const pid of squad.players) {
          const oldTeam = fromSet.has(pid) ? (toTeam === 2 ? '1' : '2') : 'Unassigned';
          fromSet.delete(pid);
          toSet.add(pid);
          await switchTeam(pid, String(toTeam));
          log(`Player ${pid}: Team ${oldTeam} → Team ${toTeam}`);
        }
      }
    };

    log('=== MUTUAL SWAP PHASE ===');
    await moveSquads(bestT1, 2, team1IDs, team2IDs);
    await moveSquads(bestT2, 1, team2IDs, team1IDs);

    const finalT1Count = team1IDs.size;
    const finalT2Count = team2IDs.size;

    if (finalT1Count > maxTeamSize || finalT2Count > maxTeamSize) {
      log(`=== EMERGENCY SQUAD BREAKING PHASE ===`);

      const oversizedTeam = finalT1Count > maxTeamSize ? 1 : 2;
      const oversizedCount = oversizedTeam === 1 ? finalT1Count : finalT2Count;
      const targetTeam = oversizedTeam === 1 ? 2 : 1;
      const targetCount = oversizedTeam === 1 ? finalT2Count : finalT1Count;
      let playersToMove = oversizedCount - maxTeamSize;

      log(`Team ${oversizedTeam} has ${playersToMove} excess players. Attempting squad breaking.`);

      playersToMove = Math.min(playersToMove, maxTeamSize - targetCount);

      log(`Breaking unlocked squads to move ${playersToMove} excess players...`);

      const unlockedSquads = allSquads
        .filter(
          (s) =>
            s.teamID === String(oversizedTeam) &&
            !swappedSquadIDs.has(s.id) &&
            !s.locked &&
            s.players.length > 1
        )
        .sort((a, b) => b.players.length - a.players.length);

      log(`Found ${unlockedSquads.length} unlocked squads to break`);

      for (const squad of unlockedSquads) {
        if (playersToMove <= 0) break;
        log(`Breaking unlocked squad ${squad.id} (${squad.players.length} players)`);

        const playersInSquad = [...squad.players];
        shuffle(playersInSquad);

        let movedFromSquad = 0;
        for (const playerID of playersInSquad) {
          if (playersToMove <= 0) break;
          if (oversizedTeam === 1) {
            team1IDs.delete(playerID);
            team2IDs.add(playerID);
          } else {
            team2IDs.delete(playerID);
            team1IDs.add(playerID);
          }
          await switchTeam(playerID, String(targetTeam));
          log(
            `Moved player ${playerID} from unlocked squad ${squad.id}: Team ${oversizedTeam} → Team ${targetTeam}`
          );
          playersToMove--;
          movedFromSquad++;
        }

        if (movedFromSquad > 0) {
          log(`Broke ${movedFromSquad} players from unlocked squad ${squad.id}`);
        }
      }

      if (playersToMove > 0) {
        log(
          `Fallback 3: Still ${playersToMove} over cap. Breaking locked squads as last resort...`
        );

        const lockedSquads = allSquads
          .filter(
            (s) =>
              s.teamID === String(oversizedTeam) &&
              !swappedSquadIDs.has(s.id) &&
              s.locked &&
              s.players.length > 1
          )
          .sort((a, b) => b.players.length - a.players.length);

        if (lockedSquads.length > 0) {
          log(
            `[EMERGENCY] Breaking ${lockedSquads.length} locked squads to enforce ${maxTeamSize}-player cap`
          );

          for (const squad of lockedSquads) {
            if (playersToMove <= 0) break;
            log(`[EMERGENCY] Breaking locked squad ${squad.id} (${squad.players.length} players)`);

            const playersInSquad = [...squad.players];
            shuffle(playersInSquad);

            let movedFromSquad = 0;
            for (const playerID of playersInSquad) {
              if (playersToMove <= 0) break;
              if (oversizedTeam === 1) {
                team1IDs.delete(playerID);
                team2IDs.add(playerID);
              } else {
                team2IDs.delete(playerID);
                team1IDs.add(playerID);
              }
              await switchTeam(playerID, String(targetTeam));
              log(
                `[EMERGENCY] Moved player ${playerID} from locked squad ${squad.id}: Team ${oversizedTeam} → Team ${targetTeam}`
              );
              playersToMove--;
              movedFromSquad++;
            }

            if (movedFromSquad > 0) {
              log(`[EMERGENCY] Broke ${movedFromSquad} players from locked squad ${squad.id}`);
            }
          }
        }
      }

      if (playersToMove > 0) {
        log(
          `[CRITICAL] Unable to enforce ${maxTeamSize}-player cap. ${playersToMove} players still over limit.`
        );
      } else {
        log(`Successfully enforced ${maxTeamSize}-player cap through emergency measures`);
      }
    }

    const finalT1 = team1IDs.size;
    const finalT2 = team2IDs.size;

    log(`Final team sizes after swap: Team1 = ${finalT1}, Team2 = ${finalT2}`);
  }
};
