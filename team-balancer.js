import BasePlugin from './base-plugin.js';

export default class TeamBalancer extends BasePlugin {
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
     * - Reliable swap system with retry mechanism for failed moves.
     * - Option to use generic "Team 1" and "Team 2" names in broadcasts.
     *
     * SCRAMBLE STRATEGY:
     * - Uses randomized backtracking to select balanced swap sets.
     * - Applies swap actions through RCON using SquadJS interfaces.
     * - Tracks and retries failed swaps over configurable timeouts.
     * - Fills or trims teams after swaps to achieve near 50-player parity.
     * - Breaks squads only if necessary to enforce hard team caps.
     * - Fully supports lobbies with only unassigned players.
     *
     * INSTALLATION:
     * Add this to your `config.json` plugins array:
     *
     * {
     * "plugin": "TeamBalancer",
     * "enabled": true,
     * "options": {
     * "enableWinStreakTracking": true,
     * "maxWinStreak": 2,
     * "minTicketsToCountAsDominantWin": 150,
     * "invasionAttackTeamThreshold": 300,
     * "invasionDefenceTeamThreshold": 650,
     * "scrambleAnnouncementDelay": 12,
     * "showWinStreakMessages": true,
     * "warnOnSwap": true,
     * "dryRunMode": true,
     * "debugLogs": false,
     * "changeTeamRetryInterval ": 200,
     * "maxScrambleCompletionTime": 15000,
     * "useGenericTeamNamesInBroadcasts": false
     * }
     * }
     *
     * ADMIN COMMANDS:
     * !teambalancer on|off           → Enable/disable win streak tracking system
     * !teambalancer status           → View win streak and plugin status
     * !teambalancer dryrun on|off    → Enable/disable dry-run (manual only)
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
     * Core Settings:
     * enableWinStreakTracking        Enable automatic scrambling logic
     * maxWinStreak                   Wins needed to trigger scramble
     * minTicketsToCountAsDominantWin Required ticket diff (non-Invasion)
     * invasionAttackTeamThreshold    Threshold for attackers (Invasion)
     * invasionDefenceTeamThreshold   Threshold for defenders (Invasion)
     * scrambleAnnouncementDelay      Delay (sec) before scramble executes
     * dryRunMode                     Manual scramble simulation toggle
     * showWinStreakMessages          Broadcast win streak status
     * warnOnSwap                     Notify players who are swapped
     * debugLogs                      Verbose debug output toggle
     * changeTeamRetryInterval        Milliseconds between swap retry attempts
     * maxScrambleCompletionTime      Total time to retry swaps (ms)
     * useGenericTeamNamesInBroadcasts Use "Team 1" / "Team 2" instead of faction names
     *
     * DEV MODE:
     * Set devMode = true to enable command testing in all chat (not admin-only).
     *
     * AUTHOR:
     * Slacker (Discord: real_slacker)
     *
     * ════════════════════════════════════════════════════════════════
     */

    /**
     * ============================================
     * SETUP & INIT
     * ============================================
     *
     * This section defines plugin metadata, default options,
     * lifecycle hooks, and constructor logic for TeamBalancer.
     * It handles event bindings, state setup, and config validation.
     *
     * CONTENTS:
     * - Plugin description and SquadJS registration metadata
     * - Option schema and default values
     * - Validation logic for critical thresholds
     * - Constructor: initializes state and registers command handlers
     * - mount() / unmount(): attach and detach event listeners
     */
    static get description() {
        return 'Tracks dominant wins by team ID and scrambles teams if one team wins too many rounds.';
    }

    static get defaultEnabled() {
        return true;
    }

    static get optionsSpecification() {
        return {
            // Core TeamBalancer Options
            enableWinStreakTracking: {
                default: true,
                type: 'boolean'
            },
            maxWinStreak: {
                default: 2,
                type: 'number'
            },
            minTicketsToCountAsDominantWin: {
                default: 150,
                type: 'number'
            },
            invasionAttackTeamThreshold: {
                default: 300,
                type: 'number'
            },
            invasionDefenceTeamThreshold: {
                default: 650,
                type: 'number'
            },
            scrambleAnnouncementDelay: {
                default: 12,
                type: 'number'
            },
            showWinStreakMessages: {
                default: true,
                type: 'boolean'
            },
            warnOnSwap: {
                default: true,
                type: 'boolean'
            },
            debugLogs: {
                default: false,
                type: 'boolean'
            },
            dryRunMode: {
                default: true,
                type: 'boolean'
            },
            changeTeamRetryInterval: {
                default: 200,
                type: 'number'
            },
            maxScrambleCompletionTime: {
                default: 15000,
                type: 'number'
            },
            useGenericTeamNamesInBroadcasts: {
                default: true,
                type: 'boolean'
            }
        };
    }

    validateOptions() {
        // if scrambleAnnouncementDelay is less than 10s, (1) admins have no time to react & (2) the rcon broadcast will overlap in game.
        if (this.options.scrambleAnnouncementDelay < 10) {
            this.logWarning(
                ` scrambleAnnouncementDelay (${this.options.scrambleAnnouncementDelay}s) too low. Enforcing minimum 10 seconds.`
            );
            this.options.scrambleAnnouncementDelay = 10;
        }

        // if changeTeamRetryInterval  is less than 50ms then we are probably spamming the server too quickly and it'll time out
        if (this.options.changeTeamRetryInterval < 50) {
            this.logWarning(
                ` changeTeamRetryInterval  (${this.options.changeTeamRetryInterval}ms) too low. Enforcing minimum 50ms.`
            );
            this.options.changeTeamRetryInterval = 50;
        }

        // if maxScrambleCompletionTime is too short then we won't have enough time to swap all the players
        if (this.options.maxScrambleCompletionTime < 5000) {
            this.logWarning(
                ` maxScrambleCompletionTime (${this.options.maxScrambleCompletionTime}ms) too low. Enforcing minimum 5000ms.`
            );
            this.options.maxScrambleCompletionTime = 5000;
        }
    }

    constructor(server, options, connectors) {
        super(server, options, connectors);
        this.devMode = false; // <-- DEV MODE TOGGLE
        CommandHandlers.register(this);
        this.winStreakTeam = null;
        this.winStreakCount = 0;
        this.manuallyDisabled = false;

        this._scramblePending = false;
        this._scrambleTimeout = null;
        this._scrambleCountdownTimeout = null;
        this._flippedAfterScramble = false;
        this.lastScrambleTime = null;

        this.pendingPlayerMoves = new Map();
        this.scrambleRetryTimer = null;
        this.activeScrambleSession = null;
        this._scrambleInProgress = false;

        // A single place to store bound listeners for easy cleanup
        this.listeners = {};

        // Bind methods once for consistent reference
        this.listeners.onRoundEnded = this.onRoundEnded.bind(this);
        this.listeners.onNewGame = this.onNewGame.bind(this);
        this.listeners.onChatCommand = this.onChatCommand.bind(this);
        this.listeners.onScrambleCommand = this.onScrambleCommand.bind(this);
        this.listeners.onChatMessage = this.onChatMessage.bind(this);

        this._cachedLayer = null;
        this._layerInfoPollingInterval = null; // New variable to hold the polling timer
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
        this.logDebug('Mounting plugin and adding listeners.');
        this.server.on('ROUND_ENDED', this.listeners.onRoundEnded);
        this.server.on('NEW_GAME', this.listeners.onNewGame);
        this.server.on('CHAT_COMMAND:teambalancer', this.listeners.onChatCommand);
        this.server.on('CHAT_COMMAND:scramble', this.listeners.onScrambleCommand);
        this.server.on('CHAT_MESSAGE', this.listeners.onChatMessage);
        this.startLayerInfoPolling();
        this.validateOptions();
    }

    async unmount() {
        this.logDebug('Unmounting plugin and removing listeners.');
        this.server.removeListener('ROUND_ENDED', this.listeners.onRoundEnded);
        this.server.removeListener('NEW_GAME', this.listeners.onNewGame);
        this.server.removeListener('CHAT_COMMAND:teambalancer', this.listeners.onChatCommand);
        this.server.removeListener('CHAT_COMMAND:scramble', this.listeners.onScrambleCommand);
        this.server.removeListener('CHAT_MESSAGE', this.listeners.onChatMessage);

        if (this._scrambleTimeout) clearTimeout(this._scrambleTimeout);
        if (this._scrambleCountdownTimeout) clearTimeout(this._scrambleCountdownTimeout);
        this.cleanupScrambleTracking();
        this.stopLayerInfoPolling(); // Stop polling on unmount
        this._scrambleInProgress = false;
    }

    // ╔═══════════════════════════════════════╗
    // ║         ROUND EVENT HANDLERS          ║
    // ╚═══════════════════════════════════════╝

    async onNewGame() {
        this.logDebug('[onNewGame] Event triggered');

        // Reset cached game and team info
        this.gameModeCached = null;
        this.cachedTeam1Name = null;
        this.cachedTeam2Name = null;

        // Start polling for layer info until valid data is found
        this.startLayerInfoPolling();

        this._scrambleInProgress = false;
        this._scramblePending = false;

        // >>>> NOTE: winStreakTeam flipping MUST be preserved <<<<
        // Squad servers swap sides between games, so winning team IDs flip.
        // This flip maintains streak continuity and prevents incorrect resets.
        // Removing this breaks streak tracking and scramble triggers.
        if (this.winStreakTeam === 1) {
            this.winStreakTeam = 2;
        } else if (this.winStreakTeam === 2) {
            this.winStreakTeam = 1;
        }
    }

    async onRoundEnded(data) {
        this.logDebug(`Round ended event received: ${JSON.stringify(data)}`);

        // Stop polling for layer info after a round ends.
        this.stopLayerInfoPolling();

        const winnerID = parseInt(data?.winner?.team);
        const winnerTickets = parseInt(data?.winner?.tickets);
        const loserTickets = parseInt(data?.loser?.tickets);
        const margin = winnerTickets - loserTickets;

        if (isNaN(winnerID) || isNaN(winnerTickets) || isNaN(loserTickets)) {
            this.logWarning('Could not parse round end data, skipping evaluation.');
            return;
        }

        this.logDebug(
            `Parsed winnerID=${winnerID}, winnerTickets=${winnerTickets}, loserTickets=${loserTickets}, margin=${margin}`
        );

        const isInvasion = this.gameModeCached?.toLowerCase().includes('invasion') ?? false;
        const dominantThreshold = this.options.minTicketsToCountAsDominantWin ?? 175;
        const stompThreshold = Math.floor(dominantThreshold * 1.5);
        const closeGameMargin = Math.floor(dominantThreshold * 0.34);
        const moderateWinThreshold = Math.floor((dominantThreshold + closeGameMargin) / 2);

        this.logDebug(`Thresholds computed: {
  gameMode: ${this.gameModeCached},
  isInvasion: ${isInvasion},
  dominantThreshold: ${dominantThreshold},
  stompThreshold: ${stompThreshold},
  closeGameMargin: ${closeGameMargin},
  moderateWinThreshold: ${moderateWinThreshold}
}`);

        // Invasion-specific dominant thresholds
        const invasionAttackThreshold = this.options.invasionAttackTeamThreshold ?? 300;
        const invasionDefenceThreshold = this.options.invasionDefenceTeamThreshold ?? 650;

        // Determine dominance state
        let isDominant = false;
        let isStomp = false;

        if (isInvasion) {
            if (
                (winnerID === 1 && margin >= invasionAttackThreshold) ||
                (winnerID === 2 && margin >= invasionDefenceThreshold)
            ) {
                isDominant = true;
                isStomp = true; // Treat invasion dominant as stomp for messaging
            }
        } else {
            isDominant = margin >= dominantThreshold;
            isStomp = margin >= stompThreshold;
        }

        const nextStreakCount = this.winStreakTeam === winnerID ? this.winStreakCount + 1 : 1;
        const maxStreakReached = nextStreakCount >= this.options.maxWinStreak;

        const winnerName = (this.options.useGenericTeamNamesInBroadcasts
            ? `Team ${winnerID}`
            : (await this.getTeamName(winnerID))) || `Team ${winnerID}`;
        const loserName = (this.options.useGenericTeamNamesInBroadcasts
            ? `Team ${3 - winnerID}`
            : (await this.getTeamName(3 - winnerID))) || `Team ${3 - winnerID}`;

        // The prefixing logic below is only applicable when using faction names
        // and should be skipped for generic team names.
        let broadcastWinnerName = winnerName;
        let broadcastLoserName = loserName;
        if (!this.options.useGenericTeamNamesInBroadcasts) {
            if (!/^The\s+/i.test(winnerName) && !winnerName.startsWith('Team ')) {
                broadcastWinnerName = 'The ' + winnerName;
            }
            if (!/^The\s+/i.test(loserName) && !loserName.startsWith('Team ')) {
                broadcastLoserName = 'The ' + loserName;
            }
        }

        const teamNames = { winnerName: broadcastWinnerName, loserName: broadcastLoserName };

        if (!isDominant && !maxStreakReached) {
            this.logDebug('Handling non-dominant win branch.');
            if (this.options.showWinStreakMessages) {
                let template;

                if (this.winStreakTeam && this.winStreakTeam !== winnerID) {
                    template = this.RconMessages.nonDominant.streakBroken;
                } else if (isInvasion) {
                    template =
                        winnerID === 1
                            ? this.RconMessages.nonDominant.invasionAttackWin
                            : this.RconMessages.nonDominant.invasionDefendWin;
                } else {
                    const threshold = this.options.minTicketsToCountAsDominantWin ?? 175;

                    const veryCloseCutoff = Math.floor(threshold * 0.11);
                    const closeCutoff = Math.floor(threshold * 0.45);
                    const tacticalCutoff = Math.floor(threshold * 0.68);

                    if (margin < veryCloseCutoff) {
                        template = this.RconMessages.nonDominant.narrowVictory;
                    } else if (margin < closeCutoff) {
                        template = this.RconMessages.nonDominant.marginalVictory;
                    } else if (margin < tacticalCutoff) {
                        template = this.RconMessages.nonDominant.tacticalAdvantage;
                    } else {
                        template = this.RconMessages.nonDominant.operationalSuperiority;
                    }
                }

                const message = `${this.RconMessages.prefix} ${this.formatMessage(template, {
                    team: teamNames.winnerName,
                    loser: teamNames.loserName,
                    margin
                })}`;
                this.logDebug(`Broadcasting non-dominant message: ${message}`);
                await this.server.rcon.broadcast(message);
            }
            return this.resetStreak(`Non-dominant win by team ${winnerID}`);
        }

        this.logDebug('Dominant win detected under standard mode.');
        this.logDebug(
            `Current streak: winStreakTeam=${this.winStreakTeam}, winStreakCount=${this.winStreakCount}`
        );

        const streakBroken = this.winStreakTeam && this.winStreakTeam !== winnerID;
        if (streakBroken) {
            this.logDebug(`Streak broken. Previous streak team: ${this.winStreakTeam}`);
            this.resetStreak('Streak broken by opposing team');
        }

        this.winStreakTeam = winnerID;
        this.winStreakCount = nextStreakCount;
        this.logDebug(
            `New win streak started: team ${this.winStreakTeam}, count ${this.winStreakCount}`
        );

        const scrambleComing = this.winStreakCount >= this.options.maxWinStreak;

        if (this.options.showWinStreakMessages && !scrambleComing) {
            let template;

            if (isInvasion) {
                template =
                    winnerID === 1
                        ? this.RconMessages.dominant.invasionAttackStomp
                        : this.RconMessages.dominant.invasionDefendStomp;
            } else if (isStomp) {
                template = this.RconMessages.dominant.stomped;
            } else {
                template = this.RconMessages.dominant.steamrolled;
            }

            const message = `${this.RconMessages.prefix} ${this.formatMessage(template, {
                team: teamNames.winnerName,
                loser: teamNames.loserName,
                margin
            })}`;
            this.logDebug(`Broadcasting dominant win message: ${message}`);
            await this.server.rcon.broadcast(message);
        }

        this.logDebug(
            `Evaluating scramble trigger: streakCount=${this.winStreakCount}, streakTeam=${this.winStreakTeam}, margin=${margin}`
        );
        this.logDebug(
            `_scramblePending=${this._scramblePending}, _scrambleInProgress=${this._scrambleInProgress}`
        );

        if (this._scramblePending || this._scrambleInProgress) return;

        if (this.winStreakCount >= this.options.maxWinStreak) {
            const message = this.formatMessage(this.RconMessages.scrambleAnnouncement, {
                team: teamNames.winnerName,
                count: this.winStreakCount,
                margin,
                delay: this.options.scrambleAnnouncementDelay
            });
            await this.server.rcon.broadcast(`${this.RconMessages.prefix} ${message}`);
            this.initiateScramble(false, false);
        }
    }

    resetStreak(reason = 'unspecified') {
        this.logDebug(`Resetting streak: ${reason}`);
        this.winStreakTeam = null;
        this.winStreakCount = 0;
        this._scramblePending = false;
    }

    async getTeamName(teamID) {
        if (teamID === 1 && this.cachedTeam1Name) return this.cachedTeam1Name;
        if (teamID === 2 && this.cachedTeam2Name) return this.cachedTeam2Name;

        try {
            const layer = await this.server.currentLayer;
            if (layer?.teams?.[teamID - 1]?.name) {
                const name = layer.teams[teamID - 1].name;
                if (teamID === 1) this.cachedTeam1Name = name;
                if (teamID === 2) this.cachedTeam2Name = name;
                return name;
            }
            if (layer?.teams?.[teamID - 1]?.faction) {
                const faction = layer.teams[teamID - 1].faction;
                if (teamID === 1) this.cachedTeam1Name = faction;
                if (teamID === 2) this.cachedTeam2Name = faction;
                return faction;
            }
        } catch (err) {
            this.logDebug(`Error getting team name for team ${teamID}: ${err.message}`);
        }

        return `Team ${teamID}`;
    }

    // New polling mechanism to replace loadLayerInfoWithRetry
    async startLayerInfoPolling() {
        if (this._layerInfoPollingInterval) {
            this.logDebug('Polling interval already running, cancelling old one.');
            clearInterval(this._layerInfoPollingInterval);
        }

        this.logDebug('Starting periodic polling for layer information every 60s.');

        // Immediately call the function once to get initial data quickly
        await this.pollLayerInfo();

        this._layerInfoPollingInterval = setInterval(async () => {
            await this.pollLayerInfo();
        }, 60000); // Poll every 60 seconds
    }

    stopLayerInfoPolling() {
        if (this._layerInfoPollingInterval) {
            this.logDebug('Stopping layer info polling.');
            clearInterval(this._layerInfoPollingInterval);
            this._layerInfoPollingInterval = null;
        }
    }

    async pollLayerInfo() {
        try {
            const layer = await this.server.currentLayer;
            if (!layer || !layer.gamemode) {
                this.logDebug('[TeamBalancer] Polling: Layer info is still invalid, continuing to poll.');
                return;
            }

            // Successfully got valid layer info, so cache it and stop polling
            this.logDebug(`[TeamBalancer] Polling: Successfully retrieved layer info. Gamemode: ${layer.gamemode}`);
            this.gameModeCached = layer.gamemode;
            this.cachedTeam1Name = layer.teams?.[0]?.name || layer.teams?.[0]?.faction || null;
            this.cachedTeam2Name = layer.teams?.[1]?.name || layer.teams?.[1]?.faction || null;

            this.logDebug(`[TeamBalancer] Cached info updated. Gamemode: ${this.gameModeCached}, T1: ${this.cachedTeam1Name}, T2: ${this.cachedTeam2Name}`);
            this.stopLayerInfoPolling();

        } catch (err) {
            this.logWarning(`[TeamBalancer] Polling: Error fetching layer info:`, err.message);
        }
    }


    // ╔═══════════════════════════════════════╗
    // ║        SCRAMBLE EXECUTION FLOW        ║
    // ╚═══════════════════════════════════════╝

    async initiateScramble(isSimulated = false, immediate = false, steamID = null, player = null) {
        if (this._scramblePending || this._scrambleInProgress) {
            this.logDebug('Scramble initiation blocked: scramble already pending or in progress.');
            return false;
        }
        if (!immediate && !isSimulated) {
            const delaySeconds = this.options.scrambleAnnouncementDelay;
            this._scramblePending = true;
            const adminName = player?.name || (steamID ? `admin ${steamID}` : 'system');
            console.log(`[TeamBalancer] Manual scramble countdown started by ${adminName}`);

            // Broadcast manual scramble announcement if this is a manual scramble
            if ((steamID || player) && !this.options.dryRunMode) {
                const message = `${this.RconMessages.prefix} ${this.formatMessage(
                    this.RconMessages.manualScrambleAnnouncement,
                    {
                        delay: delaySeconds
                    }
                )}`;
                this.logDebug(`Broadcasting manual scramble announcement: ${message}`);
                try {
                    await this.server.rcon.broadcast(message);
                    console.log('[TeamBalancer] Manual scramble announcement broadcast successful.');
                } catch (err) {
                    console.error('[TeamBalancer] Error broadcasting manual scramble announcement:', err);
                }
            }

            this._scrambleCountdownTimeout = setTimeout(async () => {
                this.logDebug('Manual scramble countdown finished, executing scramble.');
                await this.executeScramble(isSimulated);
            }, delaySeconds * 1000);
            return true;
        }
        await this.executeScramble(isSimulated, steamID, player);
        return true;
    }

    transformSquadJSData(squads, players) {
        this.logDebug('Transforming SquadJS data for scrambler...');

        // Normalize and validate input
        const normalizedSquads = (squads || []).filter(
            (squad) =>
                squad &&
                squad.squadID &&
                squad.teamID &&
                typeof squad.squadID !== 'undefined' &&
                typeof squad.teamID !== 'undefined'
        );

        const normalizedPlayers = (players || []).filter(
            (player) =>
                player &&
                player.steamID &&
                player.teamID &&
                typeof player.steamID === 'string' &&
                typeof player.teamID !== 'undefined'
        );

        this.logDebug(
            `Input validation: ${normalizedSquads.length} valid squads, ${normalizedPlayers.length} valid players`
        );

        // Create a map of squadID -> array of player steamIDs
        const squadPlayerMap = new Map();

        for (const player of normalizedPlayers) {
            if (player.squadID) {
                const squadKey = String(player.squadID);
                if (!squadPlayerMap.has(squadKey)) {
                    squadPlayerMap.set(squadKey, []);
                }
                squadPlayerMap.get(squadKey).push(player.steamID);
            }
        }

        this.logDebug(`Squad-player mapping created for ${squadPlayerMap.size} squads`);

        // Transform squads to expected format
        const transformedSquads = normalizedSquads.map((squad) => {
            const squadKey = String(squad.squadID);
            const playersInSquad = squadPlayerMap.get(squadKey) || [];

            const transformed = {
                id: squadKey,
                teamID: String(squad.teamID), // Ensure string format
                players: playersInSquad,
                locked: squad.locked === 'True' || squad.locked === true // Handle both string and boolean
            };

            this.logDebug(
                `Transformed squad ${squadKey}: ${playersInSquad.length} players, team ${transformed.teamID}, locked: ${transformed.locked}`
            );

            return transformed;
        });

        // Transform players to expected format
        const transformedPlayers = normalizedPlayers.map((player) => ({
            steamID: player.steamID,
            teamID: String(player.teamID), // Ensure string format
            squadID: player.squadID ? String(player.squadID) : null
        }));

        this.logDebug(
            `Transformation complete: ${transformedSquads.length} squads, ${transformedPlayers.length} players`
        );

        // Log sample data for debugging
        if (transformedSquads.length > 0) {
            this.logDebug(`Sample transformed squad:`, JSON.stringify(transformedSquads[0], null, 2));
        }
        if (transformedPlayers.length > 0) {
            this.logDebug(`Sample transformed player:`, JSON.stringify(transformedPlayers[0], null, 2));
        }

        return {
            squads: transformedSquads,
            players: transformedPlayers
        };
    }

    async executeScramble(isSimulated = false, steamID = null, player = null) {
        if (this._scrambleInProgress) {
            this.logWarning('Scramble already in progress.');
            return false;
        }

        this._scrambleInProgress = true;
        const adminName = player?.name || (steamID ? `admin ${steamID}` : 'system');
        this.logDebug(`Scramble started by ${adminName}`);

        try {
            if (!isSimulated) {
                const msg = `${this.RconMessages.prefix
                    } ${this.RconMessages.executeScrambleMessage.trim()}`;
                this.logDebug(`Broadcasting: "${msg}"`);
                await this.server.rcon.broadcast(msg);
                console.log(`[TeamBalancer] Executing scramble initiated by ${adminName}`);
            } else {
                this.logDebug(`Executing dry run scramble initiated by ${adminName}`);
            }

            // Transform SquadJS data to expected format
            const { squads: transformedSquads, players: transformedPlayers } = this.transformSquadJSData(
                this.server.squads,
                this.server.players
            );

            this.logDebug(
                `Calling scrambler with ${transformedSquads.length} squads and ${transformedPlayers.length} players`
            );

            await Scrambler.scrambleTeamsPreservingSquads({
                squads: transformedSquads,
                players: transformedPlayers,
                winStreakTeam: this.winStreakTeam,
                log: (...args) => console.log(...args),
                switchTeam: async (steamID, newTeamID) => {
                    await this.reliablePlayerMove(steamID, newTeamID, isSimulated);
                }
            });

            const msg = `${this.RconMessages.prefix} ${this.RconMessages.scrambleCompleteMessage.trim()}`;
            if (!isSimulated) {
                this.logDebug(`Broadcasting: "${msg}"`);
                await this.server.rcon.broadcast(msg);
                this.lastScrambleTime = Date.now();
                this.resetStreak('Post-scramble cleanup');
            } else {
                this.logDebug(msg);
            }

            return true;
        } catch (error) {
            console.log(`[TeamBalancer] Error during scramble execution:`, error);
            // Log additional debugging info on error
            this.logDebug(`Squad data at error:`, JSON.stringify(this.server.squads, null, 2));
            this.logDebug(`Player data at error:`, JSON.stringify(this.server.players, null, 2));
            return false;
        } finally {
            this._scrambleInProgress = false;
            this.logDebug('Scramble finished');
        }
    }

    async cancelPendingScramble(steamID, player = null, isAutomatic = false) {
        if (!this._scramblePending) {
            return false;
        }

        if (this._scrambleInProgress) {
            if (!isAutomatic) {
                const adminName = player?.name || steamID;
                console.log(
                    `[TeamBalancer] ${adminName} attempted to cancel scramble, but it's already executing`
                );
            }
            return false;
        }

        if (this._scrambleCountdownTimeout) {
            clearTimeout(this._scrambleCountdownTimeout);
            this._scrambleCountdownTimeout = null;
        }

        this._scramblePending = false;

        const adminName = player?.name || steamID;
        const cancelReason = isAutomatic ? 'automatically' : `by admin ${adminName}`;

        console.log(`[TeamBalancer] Scramble countdown cancelled ${cancelReason}`);

        if (!isAutomatic) {
            const msg = `Scramble cancelled by admin.`;
            this.logDebug(`Broadcasting: "${msg}"`);
            await this.server.rcon.broadcast(msg);
        }

        return true;
    }

    async waitForScrambleToFinish(timeoutMs = 10000, intervalMs = 100) {
        const start = Date.now();

        while (this._scrambleInProgress) {
            if (Date.now() - start > timeoutMs) {
                throw new Error('Timeout waiting for scramble to finish.');
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }

    // ╔═══════════════════════════════════════╗
    // ║      RELIABLE PLAYER MOVE SYSTEM      ║
    // ╚═══════════════════════════════════════╝

    async reliablePlayerMove(steamID, targetTeamID, isSimulated = false) {
        if (isSimulated) {
            this.logDebug(`[Dry Run] Would queue player move for ${steamID} to team ${targetTeamID}`);
            return;
        }

        this.pendingPlayerMoves.set(steamID, {
            targetTeamID: targetTeamID,
            attempts: 0,
            startTime: Date.now()
        });

        this.logDebug(`Queued player move for ${steamID} to team ${targetTeamID}`);

        if (!this.scrambleRetryTimer) {
            this.startScrambleMonitoring();
        }
    }

    startScrambleMonitoring() {
        this.logDebug('Starting scramble monitoring system');
        this.activeScrambleSession = {
            startTime: Date.now(),
            totalMoves: this.pendingPlayerMoves.size,
            completedMoves: 0,
            failedMoves: 0
        };

        this.scrambleRetryTimer = setInterval(async () => {
            await this.processScrambleRetries();
        }, this.options.changeTeamRetryInterval);

        setTimeout(() => {
            this.completeScrambleSession();
        }, this.options.maxScrambleCompletionTime);
    }

    async processScrambleRetries() {
        const now = Date.now();
        const playersToRemove = [];

        for (const [steamID, moveData] of this.pendingPlayerMoves.entries()) {
            if (now - moveData.startTime > this.options.maxScrambleCompletionTime) {
                this.logWarning(
                    `Player move timeout exceeded for ${steamID} after ${this.options.maxScrambleCompletionTime}ms, giving up`
                );
                this.logDebug(
                    `Player ${steamID} move history: ${moveData.attempts} attempts, target team ${moveData.targetTeamID}`
                );
                this.activeScrambleSession.failedMoves++;
                playersToRemove.push(steamID);
                continue;
            }

            const player = this.server.players.find((p) => p.steamID === steamID);
            if (!player) {
                this.logDebug(
                    `Player ${steamID} no longer on server, removing from move queue (was targeting team ${moveData.targetTeamID})`
                );
                playersToRemove.push(steamID);
                continue;
            }

            if (player.teamID === moveData.targetTeamID) {
                this.logDebug(
                    `✓ Player ${steamID} (${player.name}) successfully moved to team ${moveData.targetTeamID} after ${moveData.attempts} attempts`
                );
                this.activeScrambleSession.completedMoves++;
                playersToRemove.push(steamID);

                if (this.options.warnOnSwap) {
                    try {
                        await this.server.rcon.warn(
                            steamID,
                            `You have been team-swapped as part of a balance adjustment.`
                        );
                    } catch (err) {
                        this.logDebug(`Failed to send move warning to ${steamID} (${player.name}):`, err);
                    }
                }
                continue;
            }

            moveData.attempts++;
            this.logDebug(
                `Attempting move for ${steamID} (${player.name}) from team ${player.teamID} to team ${moveData.targetTeamID} (attempt ${moveData.attempts}/5)`
            );

            try {
                await this.server.rcon.switchTeam(steamID, moveData.targetTeamID);
                this.logDebug(
                    `RCON switchTeam command sent for ${steamID} (${player.name}) to team ${moveData.targetTeamID}`
                );
            } catch (err) {
                this.logWarning(
                    `✗ Move attempt ${moveData.attempts}/5 failed for player ${steamID} (${player.name}) to team ${moveData.targetTeamID}:`,
                    err.message || err
                );

                if (moveData.attempts >= 5) {
                    this.logWarning(
                        `✗ FINAL FAILURE: Player ${steamID} (${player.name}) could not be moved to team ${moveData.targetTeamID} after 5 attempts`
                    );
                    this.logDebug(
                        `Failed player details: Currently on team ${player.teamID}, squad ${player.squadID}, role ${player.role}`
                    );
                    this.activeScrambleSession.failedMoves++;
                    playersToRemove.push(steamID);
                }
            }
        }

        playersToRemove.forEach((steamID) => {
            this.pendingPlayerMoves.delete(steamID);
        });

        if (this.pendingPlayerMoves.size === 0) {
            this.logDebug('All player moves completed, finishing scramble session immediately');
            this.completeScrambleSession();
        }
    }

    completeScrambleSession() {
        if (!this.activeScrambleSession) return;

        const duration = Date.now() - this.activeScrambleSession.startTime;
        const { totalMoves, completedMoves, failedMoves } = this.activeScrambleSession;

        if (this.scrambleRetryTimer) {
            clearInterval(this.scrambleRetryTimer);
            this.scrambleRetryTimer = null;
        }

        const successRate = totalMoves > 0 ? Math.round((completedMoves / totalMoves) * 100) : 100;
        const completionReason =
            this.pendingPlayerMoves.size === 0 ? 'all moves completed' : 'timeout reached';

        // Trimmed this log for conciseness
        console.log(
            `[TeamBalancer] Scramble session completed in ${duration}ms: ` +
            `${completedMoves}/${totalMoves} successful moves (${successRate}%), ${failedMoves} failed`
        );

        if (failedMoves > 0) {
            this.logWarning(
                `${failedMoves} players could not be moved during scramble. They may need manual intervention.`
            );
        }

        this.cleanupScrambleTracking();
    }

    cleanupScrambleTracking() {
        if (this.scrambleRetryTimer) {
            clearInterval(this.scrambleRetryTimer);
            this.scrambleRetryTimer = null;
        }
        this.pendingPlayerMoves.clear();
        this.activeScrambleSession = null;
        this._scrambleInProgress = false;
    }
}

/**
 * ============================================
 * PLAYER COMMAND & RESPONSE LOGIC
 * ============================================
 */

const CommandHandlers = {
    register(tb) {
        tb.respond = function (steamID, msg) {
            console.log(`[TeamBalancer][Response to ${steamID}] ${msg}`);
            // Future: replace with RCON, Discord, etc.
            // await this.server.rcon.warn(steamID, msg); etc
        };

        tb.formatMessage = (template, values) => {
            for (const key in values) {
                template = template.split(`{${key}}`).join(values[key]);
            }
            return template;
        };

        tb.RconMessages = {
            prefix: '[TeamBalancer]',

            nonDominant: {
                streakBroken: "{team} ended {loser}'s domination streak | ({margin} tickets)",

                narrowVictory: '{team} narrowly defeated {loser} | ({margin} tickets)',
                marginalVictory: '{team} gained ground on {loser} | ({margin} tickets)',
                tacticalAdvantage: '{team} pushed through {loser} | ({margin} tickets)',
                operationalSuperiority: '{team} outmaneuvered {loser} | ({margin} tickets)',

                invasionAttackWin: '{team} overran the defenders | ({margin} tickets)',
                invasionDefendWin: '{team} held firm | ({margin} tickets)'
            },

            dominant: {
                steamrolled: '{team} steamrolled {loser} | ({margin} tickets)',
                stomped: '{team} stomped {loser} | ({margin} tickets)',
                dominantVictory: '{team} dominated {loser} | ({margin} tickets)',
                invasionAttackStomp: '{team} crushed defenders with force | ({margin} tickets)',
                invasionDefendStomp: '{team} decisively repelled attackers | ({margin} tickets)'
            },

            scrambleAnnouncement:
                '{team} has reached {count} dominant wins ({margin} tickets) | Scrambling in {delay}s...',
            manualScrambleAnnouncement:
                'Manual team balance triggered by admin | Scramble in {delay}s...',
            immediateManualScramble: 'Manual team balance triggered by admin | Scrambling teams...',
            executeScrambleMessage: ' Scrambling...',
            scrambleCompleteMessage: ' Balance has been restored.',

            system: {
                trackingEnabled: 'Team Balancer has been enabled.',
                trackingDisabled: 'Team Balancer has been disabled.'
            }
        };

        tb.onChatMessage = async function (info) {
            const message = info.message?.trim();
            if (!message || !message.startsWith('!teambalancer')) return;
            if (message !== '!teambalancer') return;
            const steamID = info.steamID;
            const playerName = info.player?.name || 'Unknown';

            // TRIMMED: Replaced verbose args dump with a concise message
            this.logDebug(`General teambalancer info requested by ${playerName} (${steamID})`);

            const now = Date.now();
            const lastScrambleText = this.lastScrambleTime ? `${Math.floor((now - this.lastScrambleTime) / 60000)} minutes ago` : 'Never';
            const statusText = this.manuallyDisabled ? 'Manually disabled' : this.options.enableWinStreakTracking ? 'Active' : 'Disabled in config';
            const winStreakText = this.winStreakCount > 0 ? `Team ${this.winStreakTeam} has ${this.winStreakCount} dominant win(s)` : 'No current win streak';
            const infoMsg = [
                '[TeamBalancer Info]',
                `Status: ${statusText}`,
                `Current streak: ${winStreakText}`,
                `Last scramble: ${lastScrambleText}`,
                `Max streak before scramble: ${this.options.maxWinStreak} wins`
            ].join('\n');

            // TRIMMED: Replaced verbose console log with a concise message
            console.log(
                `[TeamBalancer] Info response sent to ${playerName}: ${infoMsg.replace(/\n/g, ' | ')}`
            );

            try {
                await this.server.rcon.warn(steamID, infoMsg);
            } catch (err) {
                this.logDebug(`Failed to send info message to ${steamID}:`, err);
            }
        };

        tb.onChatCommand = async function (command) {
            // TRIMMED: Replaced verbose args dump with a concise message
            this.logDebug(`Chat command received: !teambalancer ${command.message}`);

            if (!this.devMode && command.chat !== 'ChatAdmin') return;
            const message = command.message;
            const steamID = command.steamID;
            const player = command.player;

            if (typeof message !== 'string' || !message.trim()) {
                console.log('[TeamBalancer] No valid message found, ignoring command.');
                this.respond(
                    steamID,
                    'Usage: !teambalancer [on|off | dryrun on|off | status | scramble | cancel | diag]'
                );
                return;
            }

            const args = message.trim().split(/\s+/);
            const subcommand = args[0]?.toLowerCase();

            try {
                switch (subcommand) {
                    case 'on': {
                        if (!this.manuallyDisabled) {
                            this.respond(steamID, 'Win streak tracking is already enabled.');
                            return;
                        }
                        this.manuallyDisabled = false;
                        console.log(`[TeamBalancer] Win streak tracking enabled by ${player?.name || steamID}`);
                        this.respond(steamID, 'Win streak tracking enabled.');
                        await this.server.rcon.broadcast(
                            `${this.RconMessages.prefix} ${this.RconMessages.system.trackingEnabled}`
                        );
                        break;
                    }
                    case 'off': {
                        if (this.manuallyDisabled) {
                            this.respond(steamID, 'Win streak tracking is already disabled.');
                            return;
                        }
                        this.manuallyDisabled = true;
                        console.log(
                            `[TeamBalancer] Win streak tracking disabled by ${player?.name || steamID}`
                        );
                        this.respond(steamID, 'Win streak tracking disabled.');
                        this.resetStreak('Manual disable');
                        await this.server.rcon.broadcast(
                            `${this.RconMessages.prefix} ${this.RconMessages.system.trackingDisabled}`
                        );
                        break;
                    }
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
                        const effectiveStatus = this.manuallyDisabled ? 'DISABLED (manual)' : this.options.enableWinStreakTracking ? 'ENABLED' : 'DISABLED (config)';
                        const lastScrambleText = this.lastScrambleTime ? new Date(this.lastScrambleTime).toLocaleString() : 'Never';
                        const scrambleInfo = this.pendingPlayerMoves.size > 0 ? `${this.pendingPlayerMoves.size} pending player moves` : 'No active scramble';
                        const statusMsg = [
                            '[TeamBalancer Status]',
                            `Win streak tracking: ${effectiveStatus}`,
                            `Dry run mode: ${this.options.dryRunMode ? 'ON (manual only)' : 'OFF'}`,
                            `Win streak: Team ${this.winStreakTeam ?? 'N/A'} with ${this.winStreakCount} win(s)`,
                            `Scramble pending: ${this._scramblePending}`,
                            `Scramble in progress: ${this._scrambleInProgress}`,
                            `Last scramble: ${lastScrambleText}`,
                            `Scramble system: ${scrambleInfo}`
                        ].join('\n');
                        // TRIMMED: Replaced verbose console log with a concise message
                        console.log(`[TeamBalancer] Status requested by ${player?.name || steamID}`);
                        this.respond(steamID, statusMsg);
                        break;
                    }
                    case 'cancel': {
                        const cancelled = await this.cancelPendingScramble(steamID, player, false);
                        if (cancelled) {
                            console.log(`[TeamBalancer] Scramble cancelled by ${player?.name || steamID}`);
                            this.respond(steamID, 'Pending scramble cancelled.');
                        } else if (this._scrambleInProgress) {
                            this.respond(steamID, 'Cannot cancel scramble - it is already executing.');
                        } else {
                            this.respond(steamID, 'No pending scramble to cancel.');
                        }
                        break;
                    }
                    case 'scramble': {
                        if (this._scramblePending || this._scrambleInProgress) {
                            const status = this._scrambleInProgress ? 'executing' : 'pending';
                            this.respond(
                                steamID,
                                `[WARNING] Scramble already ${status}. Use "!teambalancer cancel" to cancel pending scrambles.`
                            );
                            return;
                        }
                        console.log(
                            `[TeamBalancer] ${player?.name || steamID} initiated a manual scramble with countdown`
                        );
                        this.respond(steamID, 'Initiating manual scramble with countdown...');
                        const success = await this.initiateScramble(
                            this.options.dryRunMode,
                            false,
                            steamID,
                            player
                        );
                        if (!success) {
                            this.respond(
                                steamID,
                                'Failed to initiate scramble - another scramble may be in progress.'
                            );
                        }
                        break;
                    }
                    case 'diag': {
                        this.logDebug('[TeamBalancer] Diagnostics command received.');
                        const players = this.server.players;
                        const squads = this.server.squads;

                        // Defensive sanity checks
                        const t1Players = players.filter((p) => p.teamID === 1);
                        const t2Players = players.filter((p) => p.teamID === 2);
                        const unassignedPlayers = players.filter((p) => p.teamID !== 1 && p.teamID !== 2);
                        const t1Squads = squads.filter((s) => s.teamID === 1);
                        const t2Squads = squads.filter((s) => s.teamID === 2);

                        const scrambleInfo = this.pendingPlayerMoves.size > 0 ? `${this.pendingPlayerMoves.size} pending player moves` : 'No active scramble';

                        // Fetch the most current layer information for the diagnostic
                        const currentServerLayer = await this.server.currentLayer;
                        const gameModeFromLayer = currentServerLayer?.gamemode || 'N/A';
                        const mapNameFromLayer = currentServerLayer?.map?.name || 'N/A';
                        const layerName = currentServerLayer?.layer || 'N/A';
                        const team1NameFromLayer = currentServerLayer?.teams?.[0]?.name || currentServerLayer?.teams?.[0]?.faction || 'N/A';
                        const team2NameFromLayer = currentServerLayer?.teams?.[1]?.name || currentServerLayer?.teams?.[1]?.faction || 'N/A';

                        const cachedGameMode = this.gameModeCached || 'N/A';
                        const cachedTeam1Name = this.cachedTeam1Name || 'N/A';
                        const cachedTeam2Name = this.cachedTeam2Name || 'N/A';


                        const diagMsg = [
                            '[TeamBalancer Diagnostics]',
                            `Admin: ${player?.name || steamID}`,
                            '----- CORE STATUS -----',
                            `Win streak tracking: ${this.manuallyDisabled ? 'DISABLED (Manual override)' : this.options.enableWinStreakTracking ? 'ENABLED' : 'DISABLED (Config)'}`,
                            `Win streak: Team ${this.winStreakTeam || 'N/A'} with ${this.winStreakCount} win(s)`,
                            `Max win streak threshold: ${this.options.maxWinStreak} wins`,
                            `Dry run mode: ${this.options.dryRunMode ? 'ON' : 'OFF'}`,
                            `Scramble pending: ${this._scramblePending}`,
                            `Scramble in progress: ${this._scrambleInProgress}`,
                            `Scramble system: ${scrambleInfo}`,
                            '----- ROUND/LAYER INFO -----',
                            `Current Layer: ${layerName}`,
                            `Game Mode: ${gameModeFromLayer} (Cached: ${cachedGameMode})`,
                            `Team 1 Name: ${team1NameFromLayer} (Cached: ${cachedTeam1Name})`,
                            `Team 2 Name: ${team2NameFromLayer} (Cached: ${cachedTeam2Name})`,
                            '----- PLAYER/SQUAD INFO -----',
                            `Total Players: ${players.length}`,
                            `Team 1 Players: ${t1Players.length} / Team 2 Players: ${t2Players.length}`,
                            `Unassigned Players: ${unassignedPlayers.length}`,
                            `Total Squads: ${squads.length}`,
                            `Team 1 Squads: ${t1Squads.length} / Team 2 Squads: ${t2Squads.length}`,
                            '----- CONFIGURATION -----',
                            `Min Tickets for Dominant Win: ${this.options.minTicketsToCountAsDominantWin}`,
                            `Invasion Attack/Defence Thresholds: ${this.options.invasionAttackTeamThreshold} / ${this.options.invasionDefenceTeamThreshold}`,
                            `Scramble Announcement Delay: ${this.options.scrambleAnnouncementDelay}s`,
                            `Player Swap Retry Interval: ${this.options.changeTeamRetryInterval}ms`,
                            `Max Scramble Time: ${this.options.maxScrambleCompletionTime}ms`,
                            `Use Generic Team Names: ${this.options.useGenericTeamNamesInBroadcasts ? 'YES' : 'NO'}`
                        ].join('\n');
                        this.respond(steamID, diagMsg);
                        this.logDebug(diagMsg); // Logs the full diagnostic info to the server console
                        break;
                    }
                    default: {
                        this.respond(
                            steamID,
                            'Invalid command. Usage: !teambalancer [on|off | dryrun on|off | status | scramble | cancel | diag]'
                        );
                    }
                }
            } catch (err) {
                console.error(`[TeamBalancer] Error processing chat command:`, err);
                this.respond(steamID, `Error processing command: ${err.message}`);
            }
        };

        tb.onScrambleCommand = async function (command) {
            // TRIMMED: Replaced verbose args dump with a concise message
            this.logDebug(`Scramble command received: !scramble ${command.message}`);
            if (!this.devMode && command.chat !== 'ChatAdmin') return;

            const message = command.message;
            const steamID = command.steamID;
            const player = command.player;

            const subcommand = message?.trim().toLowerCase();

            try {
                if (subcommand === 'now') {
                    if (this._scrambleInProgress) {
                        this.respond(steamID, 'A scramble is already in progress.');
                        return;
                    }
                    if (this._scramblePending) {
                        await this.cancelPendingScramble(steamID, player, true); // Automatically cancel pending one first
                    }
                    this.respond(steamID, 'Initiating immediate scramble...');
                    const success = await this.initiateScramble(
                        this.options.dryRunMode,
                        true,
                        steamID,
                        player
                    );
                    if (!success) {
                        this.respond(steamID, 'Failed to initiate immediate scramble.');
                    }
                } else if (subcommand === 'cancel') {
                    const cancelled = await this.cancelPendingScramble(steamID, player, false);
                    if (cancelled) {
                        this.respond(steamID, 'Pending scramble cancelled.');
                    } else if (this._scrambleInProgress) {
                        this.respond(steamID, 'Cannot cancel scramble - it is already executing.');
                    } else {
                        this.respond(steamID, 'No pending scramble to cancel.');
                    }
                } else {
                    if (this._scramblePending || this._scrambleInProgress) {
                        const status = this._scrambleInProgress ? 'executing' : 'pending';
                        this.respond(
                            steamID,
                            `[WARNING] Scramble already ${status}. Use "!scramble cancel" to cancel pending scrambles.`
                        );
                        return;
                    }
                    this.respond(steamID, 'Initiating manual scramble with countdown...');
                    const success = await this.initiateScramble(
                        this.options.dryRunMode,
                        false,
                        steamID,
                        player
                    );
                    if (!success) {
                        this.respond(
                            steamID,
                            'Failed to initiate scramble - another scramble may be in progress.'
                        );
                    }
                }
            } catch (err) {
                console.error(`[TeamBalancer] Error processing scramble command:`, err);
                this.respond(steamID, `Error processing command: ${err.message}`);
            }
        };
    }
};

/**
 * ============================================
 * SQUAD-PRESERVING TEAM SCRAMBLE
 * ============================================
 *
 * OVERVIEW:
 * Balances two teams in a Squad game by swapping whole squads (or unassigned players)
 * while preserving squad cohesion and respecting team size caps. Handles edge cases like
 * uneven teams, excess players, and lack of valid squads with fallbacks.
 *
 * GOALS:
 * - Maintain balanced team sizes, capped at maxTeamSize (default: 50).
 * - Preserve full squad integrity; no partial squad movement.
 * - Support unassigned players via pseudo-squad handling.
 * - Resolve persistent win-streaks by introducing team variety.
 * - Provide clear, verbose debug logging for offline simulations.
 *
 * MAJOR PHASES:
 * --------------------------------------------
 * 1. DATA PREP:
 * - Clone input to avoid side effects.
 * - Convert unassigned players into pseudo-squads of size 1.
 * - Split squads into team-based candidate pools.
 *
 * 2. SWAP TARGET CALCULATION:
 * - Determine player imbalance using winStreakTeam context.
 * - Compute how many players should be swapped to achieve parity.
 *
 * 3. BACKTRACKED SQUAD SELECTION:
 * - Randomize candidate pools and run multiple swap attempts.
 * - Select squad sets that approach the calculated swap target.
 * - Score swaps based on player imbalance and overshoot.
 * - Short-circuit once an acceptable swap score is found.
 *
 * 4. MUTUAL SWAP EXECUTION:
 * - Swap selected squads between teams.
 * - Apply player team changes using RCON callback.
 * - Preserve team ID sets for post-swap analysis.
 *
 * 5. EMERGENCY TRIM / BREAK PHASE:
 * - If a team exceeds the hard cap after swaps:
 * → Attempt to trim excess by breaking unlocked squads.
 * → If needed, fall back to breaking locked squads.
 * → Final safety check ensures cap enforcement or logs critical failure.
 *
 * NOTES:
 * - Unassigned-only matches are fully supported via pseudo-squads.
 * - If no squads are found, the algorithm still runs using solo pseudo-squads.
 * - All state changes are done via injected callbacks (log, switchTeam).
 * - The logic avoids repeating squad selections between attempts.
 * - Dry-run mode supported externally by swapping `switchTeam` function.
 *
 * USAGE:
 * Call Scrambler.scrambleTeamsPreservingSquads({...}) with the following parameters:
 *
 * - squads: Array of squad objects, each with:
 * {
 * id: string,            // Unique squad identifier
 * teamID: '1' | '2',     // Owning team (as string)
 * players: string[],     // Array of steamIDs
 * locked?: boolean       // Optional: true if the squad is locked
 * }
 *
 * - players: Array of player objects, each with:
 * {
 * steamID: string,       // Unique Steam ID of the player
 * teamID: '1' | '2',     // Current team assignment
 * squadID: string|null   // Squad the player belongs to, or null if unassigned
 * }
 *
 * - winStreakTeam: number (1 or 2)
 * Indicates the currently dominant team. Used to bias the balance logic
 * toward restoring fairness by favoring the losing team in fill/trim logic.
 *
 * - log: function(string): void
 * A logging callback to receive all debug and progress output. This is invoked
 * at every significant step (scoring, swapping, trimming, emergency breaking).
 * To suppress output, pass `() => {}`. To enable structured logging, pass your
 * own wrapper that formats or redirects messages (e.g. to a file or console).
 *
 * - switchTeam: async function(steamID: string, newTeamID: '1' | '2')
 * A callback used to enact team changes. Called once per player whose team
 * assignment changes. The function must return a Promise and should handle
 * any errors internally (e.g., failed RCON command).
 *
 * Notes:
 * - Input arrays are cloned internally; the algorithm does not mutate external state.
 * - All team size caps and squad constraints are enforced during the process.
 * - Function returns `void`; results are visible via logging and side-effects.
 */

export const Scrambler = {
    async scrambleTeamsPreservingSquads({
        squads,
        players,
        winStreakTeam,
        log = () => { },
        switchTeam = async () => { }
    }) {
        const maxTeamSize = 50;
        const maxTotalPlayers = maxTeamSize * 2; // 100 players max

        log(
            `========== Starting Team Scramble (Max cap = ${maxTeamSize}, Total cap = ${maxTotalPlayers}) ==========`
        );

        // EARLY VALIDATION: Check if scramble is even possible
        const totalPlayers = players.length;
        if (totalPlayers > maxTotalPlayers) {
            log(
                `CRITICAL: Server has ${totalPlayers} players, exceeding maximum capacity of ${maxTotalPlayers}`
            );
            log(`Cannot scramble with current player count. Consider removing excess players first.`);
            return;
        }

        if (![1, 2].includes(winStreakTeam)) {
            winStreakTeam = Math.random() < 0.5 ? 1 : 2;
            log(`No win streak team set. Randomly selecting Team ${winStreakTeam} as starting side.`);
        }

        // Create working copy with normalized team IDs
        const workingPlayers = players.map((p) => ({
            ...p,
            teamID: String(p.teamID)
        }));
        const workingSquads = squads.map((s) => ({
            ...s,
            teamID: String(s.teamID),
            players: [...s.players]
        }));

        // Helper function to update player team assignments consistently
        const updatePlayerTeam = (steamID, newTeamID) => {
            const player = workingPlayers.find((p) => p.steamID === steamID);
            if (player) {
                player.teamID = String(newTeamID);
            }
        };

        // Helper function to get current team counts
        const getCurrentTeamCounts = () => {
            const team1Count = workingPlayers.filter((p) => p.teamID === '1').length;
            const team2Count = workingPlayers.filter((p) => p.teamID === '2').length;
            const unassignedCount = workingPlayers.filter((p) => !['1', '2'].includes(p.teamID)).length;
            return { team1Count, team2Count, unassignedCount };
        };

        const initialCounts = getCurrentTeamCounts();
        log(
            `Initial team sizes: Team1 = ${initialCounts.team1Count}, Team2 = ${initialCounts.team2Count}, Unassigned = ${initialCounts.unassignedCount}`
        );

        // FIXED: Smart swap target that respects total player constraints
        const calculateSwapTarget = (totalPlayers, maxPerTeam) => {
            const idealPerTeam = Math.floor(totalPlayers / 2);

            if (idealPerTeam <= maxPerTeam) {
                return idealPerTeam;
            }

            log(
                `WARNING: ${totalPlayers} total players cannot be perfectly balanced with ${maxPerTeam} per team cap`
            );
            return Math.min(idealPerTeam, maxPerTeam);
        };

        const swapTarget = calculateSwapTarget(totalPlayers, maxTeamSize);

        const allSquads = workingSquads.filter((s) => s.players?.length > 0);
        const unassigned = workingPlayers.filter((p) => p.squadID === null);

        log(
            `Total players: ${totalPlayers}, Swap target per side: ${swapTarget}, Max per team: ${maxTeamSize}`
        );

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

        // FIXED: Prevent duplicate squad selection
        const selectUniqueSquads = (t1Cands, t2Cands, limit) => {
            const usedSquadIds = new Set();

            const selectFromCandidates = (candidates, targetLimit) => {
                const selected = [];
                let count = 0;

                for (const squad of candidates) {
                    if (usedSquadIds.has(squad.id)) {
                        log(`Skipping squad ${squad.id} - already selected for opposite team`);
                        continue;
                    }

                    const size = squad.players.length;
                    if (count + size > targetLimit) continue;

                    selected.push(squad);
                    usedSquadIds.add(squad.id);
                    count += size;
                }

                return selected;
            };

            shuffle(t1Cands);
            shuffle(t2Cands);

            const selT1 = selectFromCandidates(t1Cands, limit);
            const selT2 = selectFromCandidates(t2Cands, limit);

            return { selT1, selT2 };
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
            const { selT1, selT2 } = selectUniqueSquads([...t1Candidates], [...t2Candidates], swapTarget);

            const sa = selT1.reduce((n, s) => n + s.players.length, 0);
            const sb = selT2.reduce((n, s) => n + s.players.length, 0);
            const score = scoreSwap(selT1, selT2);

            log(
                `Attempt ${i + 1}: Score = ${score}, Team1 squads = ${selT1.length
                } (players = ${sa}), Team2 squads = ${selT2.length} (players = ${sb})`
            );
            log(`Team1 selected squads IDs: ${selT1.map((s) => s.id).join(', ')}`);
            log(`Team2 selected squads IDs: ${selT2.map((s) => s.id).join(', ')}`);

            // VALIDATION: Ensure no duplicate squad selections
            const t1Ids = new Set(selT1.map((s) => s.id));
            const t2Ids = new Set(selT2.map((s) => s.id));
            const intersection = [...t1Ids].filter((id) => t2Ids.has(id));

            if (intersection.length > 0) {
                log(
                    `WARNING: Duplicate squad selection detected: ${intersection.join(
                        ', '
                    )} - skipping attempt ${i + 1}`
                );
                continue;
            }

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

        // FINAL VALIDATION: Double-check no duplicates in best solution
        const finalT1Ids = new Set(bestT1.map((s) => s.id));
        const finalT2Ids = new Set(bestT2.map((s) => s.id));
        const finalIntersection = [...finalT1Ids].filter((id) => finalT2Ids.has(id));

        if (finalIntersection.length > 0) {
            log(`CRITICAL ERROR: Final solution has duplicate squads: ${finalIntersection.join(', ')}`);
            log('Aborting scramble to prevent team count corruption.');
            return;
        }

        const preSwapCounts = getCurrentTeamCounts();
        log(
            `Pre-swap team sizes: Team1 = ${preSwapCounts.team1Count}, Team2 = ${preSwapCounts.team2Count}`
        );

        const swappedSquadIDs = new Set();

        const moveSquads = async (group, toTeam, description) => {
            log(`${description} ${group.length} squads to Team ${toTeam}:`);

            // Collect all players that need to be moved
            const playersToMove = [];
            for (const squad of group) {
                log(`Preparing squad ${squad.id} (${squad.players.length} players) for Team ${toTeam}`);
                swappedSquadIDs.add(squad.id);

                for (const steamID of squad.players) {
                    const currentPlayer = workingPlayers.find((p) => p.steamID === steamID);
                    const oldTeam = currentPlayer ? currentPlayer.teamID : 'Unknown';

                    playersToMove.push({
                        steamID,
                        oldTeam,
                        newTeam: toTeam,
                        squadId: squad.id
                    });
                }
            }

            return playersToMove;
        };

        const executeAlternatingSwaps = async (team1Players, team2Players) => {
            log(`=== ALTERNATING SWAP EXECUTION ===`);
            log(`Team1→2 players: ${team1Players.length}, Team2→1 players: ${team2Players.length}`);

            const maxLength = Math.max(team1Players.length, team2Players.length);
            const swapResults = {
                successful: 0,
                failed: 0,
                details: []
            };

            // Helper function to verify a player swap was successful
            const verifySwap = async (steamID, expectedTeam, maxRetries = 3, retryDelay = 500) => {
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    // Wait a bit for the server to process the move
                    if (attempt > 1) {
                        await new Promise((resolve) => setTimeout(resolve, retryDelay));
                    }

                    // Check current player state on server
                    const currentPlayer = workingPlayers.find((p) => p.steamID === steamID);
                    if (currentPlayer && currentPlayer.teamID === String(expectedTeam)) {
                        log(
                            `✅ Swap verified: Player ${steamID} successfully moved to Team ${expectedTeam} (attempt ${attempt})`
                        );
                        return true;
                    }

                    log(
                        `⏳ Verification attempt ${attempt}/${maxRetries}: Player ${steamID} not yet on Team ${expectedTeam}`
                    );
                }

                log(
                    `❌ Swap verification failed: Player ${steamID} did not reach Team ${expectedTeam} after ${maxRetries} attempts`
                );
                return false;
            };

            // Execute swaps alternating between teams
            for (let i = 0; i < maxLength; i++) {
                const team1Player = team1Players[i];
                const team2Player = team2Players[i];

                // Swap Team1 player to Team2 (if available)
                if (team1Player) {
                    try {
                        log(
                            `Swapping player ${team1Player.steamID} (Squad: ${team1Player.squadId}): Team ${team1Player.oldTeam} → Team ${team1Player.newTeam}`
                        );

                        // Execute the swap
                        await switchTeam(team1Player.steamID, String(team1Player.newTeam));

                        // Update our working data immediately
                        updatePlayerTeam(team1Player.steamID, team1Player.newTeam);

                        // Verify the swap was successful
                        const verified = await verifySwap(team1Player.steamID, team1Player.newTeam);

                        if (verified) {
                            swapResults.successful++;
                            swapResults.details.push({
                                steamID: team1Player.steamID,
                                from: team1Player.oldTeam,
                                to: team1Player.newTeam,
                                status: 'success',
                                squad: team1Player.squadId
                            });
                        } else {
                            swapResults.failed++;
                            swapResults.details.push({
                                steamID: team1Player.steamID,
                                from: team1Player.oldTeam,
                                to: team1Player.newTeam,
                                status: 'failed_verification',
                                squad: team1Player.squadId
                            });

                            // Revert our working data if verification failed
                            updatePlayerTeam(team1Player.steamID, team1Player.oldTeam);
                        }
                    } catch (error) {
                        log(`❌ Swap failed for player ${team1Player.steamID}: ${error.message}`);
                        swapResults.failed++;
                        swapResults.details.push({
                            steamID: team1Player.steamID,
                            from: team1Player.oldTeam,
                            to: team1Player.newTeam,
                            status: 'failed_execution',
                            error: error.message,
                            squad: team1Player.squadId
                        });
                    }
                }

                // Swap Team2 player to Team1 (if available)
                if (team2Player) {
                    try {
                        log(
                            `Swapping player ${team2Player.steamID} (Squad: ${team2Player.squadId}): Team ${team2Player.oldTeam} → Team ${team2Player.newTeam}`
                        );

                        // Execute the swap
                        await switchTeam(team2Player.steamID, String(team2Player.newTeam));

                        // Update our working data immediately
                        updatePlayerTeam(team2Player.steamID, team2Player.newTeam);

                        // Verify the swap was successful
                        const verified = await verifySwap(team2Player.steamID, team2Player.newTeam);

                        if (verified) {
                            swapResults.successful++;
                            swapResults.details.push({
                                steamID: team2Player.steamID,
                                from: team2Player.oldTeam,
                                to: team2Player.newTeam,
                                status: 'success',
                                squad: team2Player.squadId
                            });
                        } else {
                            swapResults.failed++;
                            swapResults.details.push({
                                steamID: team2Player.steamID,
                                from: team2Player.oldTeam,
                                to: team2Player.newTeam,
                                status: 'failed_verification',
                                squad: team2Player.squadId
                            });

                            // Revert our working data if verification failed
                            updatePlayerTeam(team2Player.steamID, team2Player.oldTeam);
                        }
                    } catch (error) {
                        log(`❌ Swap failed for player ${team2Player.steamID}: ${error.message}`);
                        swapResults.failed++;
                        swapResults.details.push({
                            steamID: team2Player.steamID,
                            from: team2Player.oldTeam,
                            to: team2Player.newTeam,
                            status: 'failed_execution',
                            error: error.message,
                            squad: team2Player.squadId
                        });
                    }
                }

                // Add a small delay between swaps to avoid overwhelming the server
                if (i < maxLength - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 250));
                }
            }

            // Log swap summary
            log(`=== SWAP SUMMARY ===`);
            log(`Total players processed: ${swapResults.successful + swapResults.failed}`);
            log(`Successful swaps: ${swapResults.successful}`);
            log(`Failed swaps: ${swapResults.failed}`);

            if (swapResults.failed > 0) {
                log(`Failed swap details:`);
                swapResults.details
                    .filter((d) => d.status !== 'success')
                    .forEach((detail) => {
                        log(
                            `  - Player ${detail.steamID} (${detail.squad}): ${detail.from}→${detail.to} - ${detail.status
                            }${detail.error ? ': ' + detail.error : ''}`
                        );
                    });
            }

            return swapResults;
        };

        log('=== MUTUAL SWAP PHASE ===');

        // Prepare player lists for both teams
        const team1PlayersToMove = await moveSquads(bestT1, 2, 'Preparing Team1 squads for swap to');
        const team2PlayersToMove = await moveSquads(bestT2, 1, 'Preparing Team2 squads for swap to');

        // Execute alternating swaps with verification
        const swapResults = await executeAlternatingSwaps(team1PlayersToMove, team2PlayersToMove);

        // Update counts based on actual successful swaps
        const postSwapCounts = getCurrentTeamCounts();
        log(
            `Post-swap team sizes: Team1 = ${postSwapCounts.team1Count}, Team2 = ${postSwapCounts.team2Count}`
        );

        // If we had significant swap failures, log a warning
        if (swapResults.failed > 0) {
            const failureRate =
                (swapResults.failed / (swapResults.successful + swapResults.failed)) * 100;
            log(`WARNING: ${failureRate.toFixed(1)}% of swaps failed. Team balance may not be optimal.`);
        }

        if (postSwapCounts.team1Count > maxTeamSize || postSwapCounts.team2Count > maxTeamSize) {
            log(`=== EMERGENCY SQUAD BREAKING PHASE ===`);

            // Calculate emergency targets that respect both caps and total player constraints
            const calculateEmergencyTargets = (t1Count, t2Count, maxSize) => {
                const totalAssigned = t1Count + t2Count;

                if (totalAssigned > maxSize * 2) {
                    log(
                        `CRITICAL: ${totalAssigned} assigned players exceeds maximum capacity of ${maxSize * 2}`
                    );
                    return {
                        t1Target: maxSize,
                        t2Target: maxSize,
                        needsPlayerRemoval: totalAssigned - maxSize * 2
                    };
                }

                // Calculate balanced targets
                const idealPerTeam = Math.floor(totalAssigned / 2);
                const remainder = totalAssigned % 2;

                let t1Target = idealPerTeam + (remainder && t1Count >= t2Count ? 1 : 0);
                let t2Target = idealPerTeam + (remainder && t2Count > t1Count ? 1 : 0);

                // Adjust if either exceeds cap
                if (t1Target > maxSize) {
                    const excess = t1Target - maxSize;
                    t1Target = maxSize;
                    t2Target = Math.min(t2Target + excess, maxSize);
                }
                if (t2Target > maxSize) {
                    const excess = t2Target - maxSize;
                    t2Target = maxSize;
                    t1Target = Math.min(t1Target + excess, maxSize);
                }

                return { t1Target, t2Target, needsPlayerRemoval: 0 };
            };

            const { t1Target, t2Target, needsPlayerRemoval } = calculateEmergencyTargets(
                postSwapCounts.team1Count,
                postSwapCounts.team2Count,
                maxTeamSize
            );

            if (needsPlayerRemoval > 0) {
                log(
                    `WARNING: ${needsPlayerRemoval} players exceed server capacity and may need to be removed`
                );
            }

            const t1MovesNeeded = postSwapCounts.team1Count - t1Target;
            const t2MovesNeeded = postSwapCounts.team2Count - t2Target;

            log(
                `Emergency targets: Team1: ${postSwapCounts.team1Count} → ${t1Target} (${t1MovesNeeded > 0 ? 'move out' : 'receive'
                } ${Math.abs(t1MovesNeeded)})`
            );
            log(
                `Emergency targets: Team2: ${postSwapCounts.team2Count} → ${t2Target} (${t2MovesNeeded > 0 ? 'move out' : 'receive'
                } ${Math.abs(t2MovesNeeded)})`
            );

            // Helper function to move individual players between teams
            const movePlayersFromTeam = async (fromTeam, toTeam, count, reason) => {
                if (count <= 0) return;

                log(`${reason}: Moving ${count} players from Team ${fromTeam} to Team ${toTeam}`);

                // Get players from the source team, prioritizing unassigned players from swapped squads
                const fromTeamPlayers = workingPlayers.filter((p) => p.teamID === String(fromTeam));

                // Sort by priority: unassigned squad members first, then regular players
                fromTeamPlayers.sort((a, b) => {
                    const aInSwappedSquad = a.squadID && swappedSquadIDs.has(String(a.squadID));
                    const bInSwappedSquad = b.squadID && swappedSquadIDs.has(String(b.squadID));

                    if (aInSwappedSquad && !bInSwappedSquad) return -1;
                    if (!aInSwappedSquad && bInSwappedSquad) return 1;
                    return 0; // Keep original order if same priority
                });

                const playersToMove = fromTeamPlayers.slice(0, count);

                for (const player of playersToMove) {
                    log(`Emergency move: Player ${player.steamID} Team ${fromTeam} → Team ${toTeam}`);
                    updatePlayerTeam(player.steamID, toTeam);
                    await switchTeam(player.steamID, String(toTeam));
                }

                return playersToMove.length;
            };

            // Execute emergency moves
            let actuallyMoved = 0;

            if (t1MovesNeeded > 0) {
                actuallyMoved += await movePlayersFromTeam(1, 2, t1MovesNeeded, 'Team1 overcap fix');
            }

            if (t2MovesNeeded > 0) {
                actuallyMoved += await movePlayersFromTeam(2, 1, t2MovesNeeded, 'Team2 overcap fix');
            }

            const finalCounts = getCurrentTeamCounts();
            log(
                `Final team sizes after emergency: Team1 = ${finalCounts.team1Count}, Team2 = ${finalCounts.team2Count}`
            );

            if (finalCounts.team1Count > maxTeamSize || finalCounts.team2Count > maxTeamSize) {
                log(
                    `CRITICAL: Unable to enforce team caps. Team1=${finalCounts.team1Count}, Team2=${finalCounts.team2Count}`
                );
                log(`Server may need manual intervention.`);
            } else {
                log(`Emergency phase completed successfully. Moved ${actuallyMoved} players.`);
            }
        }

        const finalCounts = getCurrentTeamCounts();
        log(`========== Final Scramble Results ==========`);
        log(
            `Final team sizes: Team1 = ${finalCounts.team1Count}, Team2 = ${finalCounts.team2Count}, Unassigned = ${finalCounts.unassignedCount}`
        );
        log(
            `Team balance: ${Math.abs(finalCounts.team1Count - finalCounts.team2Count)} player difference`
        );
        log(`Squads swapped: ${swappedSquadIDs.size} squads total`);

        if (finalCounts.team1Count <= maxTeamSize && finalCounts.team2Count <= maxTeamSize) {
            log(`✅ Scramble completed successfully within team caps`);
        } else {
            log(`❌ WARNING: Final team sizes exceed caps`);
        }
    }
};
