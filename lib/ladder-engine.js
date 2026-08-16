(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TennisRankLadderEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_RULES = Object.freeze({ maxChallengeDistance: 3 });

  function normalizeStatus(value) {
    const text = String(value || "available").trim().toLowerCase();
    if (["injured", "injury hold", "injury_hold"].includes(text)) return "injury_hold";
    if (["challenge pending", "challenge_pending", "pending"].includes(text)) return "challenge_pending";
    if (["inactive"].includes(text)) return "inactive";
    return "available";
  }

  function assertRank(rank, label) {
    const value = Number(rank);
    if (!Number.isInteger(value) || value < 1) throw new Error(`${label} rank must be a positive integer.`);
    return value;
  }

  function eligibleOpponents(players, challengerId, rules = DEFAULT_RULES) {
    const maxDistance = Number(rules.maxChallengeDistance ?? DEFAULT_RULES.maxChallengeDistance);
    const challenger = players.find(player => player.id === challengerId);
    if (!challenger) return [];
    if (normalizeStatus(challenger.status) !== "available") return [];
    const challengerRank = assertRank(challenger.rank, "Challenger");

    return players
      .filter(player => player.id !== challenger.id)
      .filter(player => !challenger.gender || !player.gender || player.gender === challenger.gender)
      .filter(player => normalizeStatus(player.status) === "available")
      .filter(player => {
        const defenderRank = assertRank(player.rank, "Defender");
        const distance = challengerRank - defenderRank;
        return distance >= 1 && distance <= maxDistance;
      })
      .sort((a, b) => Number(a.rank) - Number(b.rank));
  }

  function applyChallengeResult(players, challengerId, defenderId, challengerWon) {
    const ladder = players.map(player => ({ ...player }));
    const challenger = ladder.find(player => player.id === challengerId);
    const defender = ladder.find(player => player.id === defenderId);
    if (!challenger || !defender) throw new Error("Both challenger and defender must exist on the ladder.");

    const challengerRank = assertRank(challenger.rank, "Challenger");
    const defenderRank = assertRank(defender.rank, "Defender");
    if (defenderRank >= challengerRank) throw new Error("The defender must be ranked above the challenger.");

    ladder.forEach(player => { player.previousRank = Number(player.rank); });
    if (!challengerWon) return ladder.sort((a, b) => Number(a.rank) - Number(b.rank));

    ladder.forEach(player => {
      const rank = Number(player.rank);
      if (player.id === challengerId) player.rank = defenderRank;
      else if (rank >= defenderRank && rank < challengerRank) player.rank = rank + 1;
    });

    return ladder.sort((a, b) => Number(a.rank) - Number(b.rank));
  }

  function parseScoreSummary(summary) {
    const raw = String(summary || "").trim();
    if (!raw) return { valid: false, sets: [], winner: null, error: "Enter at least one completed set." };
    const parts = raw.split(/\s*,\s*/).filter(Boolean);
    const sets = [];

    for (const part of parts) {
      const match = part.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
      if (!match) return { valid: false, sets: [], winner: null, error: `“${part}” is not a valid set score.` };
      const a = Number(match[1]);
      const b = Number(match[2]);
      if (a === b) return { valid: false, sets: [], winner: null, error: "A completed set cannot end tied." };
      const winner = Math.max(a, b);
      const loser = Math.min(a, b);
      const standard = (winner === 6 && loser <= 4) || (winner === 7 && (loser === 5 || loser === 6));
      const proSet = (winner === 8 && loser <= 6) || (winner >= 9 && winner - loser === 2);
      const matchTiebreak = winner >= 10 && winner - loser >= 2;
      if (!standard && !proSet && !matchTiebreak) {
        return { valid: false, sets: [], winner: null, error: `“${part}” does not look like a completed tennis set or match tiebreak.` };
      }
      sets.push({ a, b });
    }

    const aSets = sets.filter(set => set.a > set.b).length;
    const bSets = sets.filter(set => set.b > set.a).length;
    const winner = aSets > bSets ? "a" : bSets > aSets ? "b" : null;
    if (!winner) return { valid: false, sets, winner: null, error: "The score does not produce a match winner." };
    return { valid: true, sets, winner, error: "" };
  }

  function validateWinnerScore(summary) {
    const parsed = parseScoreSummary(summary);
    if (!parsed.valid) return parsed;
    if (parsed.winner !== "a") {
      return {
        ...parsed,
        valid: false,
        error: "Enter the score from the selected winner’s perspective (winner’s score first in each set).",
      };
    }
    return parsed;
  }

  function currentWinStreak(matches, playerName) {
    const key = String(playerName || "").trim().toLowerCase();
    if (!key) return 0;
    const sorted = [...matches].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    let streak = 0;
    for (const match of sorted) {
      const winner = String(match.winner || "").trim().toLowerCase();
      const loser = String(match.loser || "").trim().toLowerCase();
      if (winner !== key && loser !== key) continue;
      if (winner === key) streak += 1;
      else break;
    }
    return streak;
  }

  function movementLabel(previousRank, currentRank) {
    const previous = Number(previousRank);
    const current = Number(currentRank);
    if (!Number.isInteger(previous) || !Number.isInteger(current)) return { delta: 0, label: "—", direction: "same" };
    const delta = previous - current;
    if (delta > 0) return { delta, label: `↑${delta}`, direction: "up" };
    if (delta < 0) return { delta, label: `↓${Math.abs(delta)}`, direction: "down" };
    return { delta: 0, label: "—", direction: "same" };
  }

  return {
    DEFAULT_RULES,
    normalizeStatus,
    eligibleOpponents,
    applyChallengeResult,
    parseScoreSummary,
    validateWinnerScore,
    currentWinStreak,
    movementLabel,
  };
});
