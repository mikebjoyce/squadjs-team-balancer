/**
 * Generates mock player data for testing the TeamBalancer.
 * @param {number} count - Total number of players to generate.
 * @param {number} team1Ratio - Ratio of players on Team 1 (0.0 to 1.0). Default 0.5.
 * @returns {Array} Array of player objects.
 */
export function generateMockPlayers(count = 50, team1Ratio = 0.5, unassignedRatio) {
  const players = [];
  const team1Count = Math.floor(count * team1Ratio);

  // If unassignedRatio is not provided, default to a random value between 0% and 5% to simulate mostly packed servers.
  const effectiveUnassignedRatio =
    typeof unassignedRatio === 'number' ? unassignedRatio : Math.random() * 0.05;

  for (let i = 0; i < count; i++) {
    const teamID = i < team1Count ? 1 : 2;
    let squadID = null;
    if (Math.random() >= effectiveUnassignedRatio) {
      // Weighted squad assignment to create realistic size distribution
      const rand = Math.random();
      if (rand < 0.2) { // 20% of players go into 3 specialized squads (armor/heli) -> small squads
        squadID = Math.floor(Math.random() * 3) + 1;
      } else { // 80% of players go into 4 infantry squads -> large squads
        squadID = Math.floor(Math.random() * 4) + 4;
      }
    }

    players.push({
      steamID: `mock_steam_${i}`,
      name: `TestPlayer${i}`,
      teamID: teamID,
      squadID: squadID
    });
  }
  return players;
}

/**
 * Groups players into squad objects based on their squadID.
 * @param {Array} players - The array of mock players.
 * @returns {Array} Array of squad objects.
 */
export function generateMockSquads(players) {
  const squadMap = new Map();

  players.forEach((p) => {
    if (p.squadID) {
      const key = `${p.teamID}-${p.squadID}`;
      if (!squadMap.has(key)) {
        // Specialized squads (e.g., armor/heli) are more likely to be locked.
        const isSpecialized = p.squadID <= 3;
        const lockChance = isSpecialized ? 0.8 : 0.5; // 80% for specialized, 50% for infantry

        squadMap.set(key, {
          squadID: p.squadID,
          teamID: p.teamID,
          players: [],
          // Increased lock rate to ~60% average to match real-world scenarios.
          locked: Math.random() < lockChance
        });
      }
      squadMap.get(key).players.push(p.steamID);
    }
  });

  return Array.from(squadMap.values());
}

/**
 * Transforms mock data into the format expected by Scrambler.scrambleTeamsPreservingSquads.
 * Matches the logic in TeamBalancer.transformSquadJSData.
 */
export function transformForScrambler(mockPlayers, mockSquads) {
  // Transform Squads
  const transformedSquads = mockSquads.map((squad) => ({
    id: `T${squad.teamID}-S${squad.squadID}`,
    teamID: String(squad.teamID),
    players: squad.players, // Already array of steamIDs
    locked: squad.locked
  }));

  // Transform Players
  const transformedPlayers = mockPlayers.map((player) => ({
    steamID: player.steamID,
    teamID: String(player.teamID),
    squadID: player.squadID ? `T${player.teamID}-S${player.squadID}` : null
  }));

  return {
    squads: transformedSquads,
    players: transformedPlayers
  };
}