(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankRankingPolicy = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function recordTier(player) {
    const wins = number(player?.wins);
    const losses = number(player?.losses);
    if (wins > losses) return 0; // winning records first
    if (wins === losses) return 1; // includes a new 0-0 player
    return 2; // losing records last
  }

  function normalizedName(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function comparePlayers(a, b) {
    const tier = recordTier(a) - recordTier(b);
    if (tier) return tier;

    const aWins = number(a?.wins);
    const bWins = number(b?.wins);
    const aLosses = number(a?.losses);
    const bLosses = number(b?.losses);
    const aDiff = aWins - aLosses;
    const bDiff = bWins - bLosses;
    if (bDiff !== aDiff) return bDiff - aDiff;

    const aMatches = aWins + aLosses;
    const bMatches = bWins + bLosses;
    const aRate = aMatches ? aWins / aMatches : 0;
    const bRate = bMatches ? bWins / bMatches : 0;
    if (bRate !== aRate) return bRate - aRate;
    if (bWins !== aWins) return bWins - aWins;
    if (aLosses !== bLosses) return aLosses - bLosses;

    return normalizedName(a?.name).localeCompare(normalizedName(b?.name), "en", { sensitivity: "base", numeric: true });
  }

  function sortRankings(rankings) {
    return [...(Array.isArray(rankings) ? rankings : [])].sort(comparePlayers);
  }

  function installBrowser(win) {
    if (!win || win.__tennisrankRankingPolicyInstalled) return false;
    if (typeof win.calculateRankings !== "function") {
      win?.setTimeout?.(() => installBrowser(win), 20);
      return false;
    }

    const base = win.calculateRankings;
    if (base.__coachRankingPolicy) return true;
    const wrapped = function () {
      const calculated = base.apply(this, arguments) || {};
      return { ...calculated, rankings: sortRankings(calculated.rankings) };
    };
    wrapped.__coachRankingPolicy = true;
    wrapped.__baseCalculateRankings = base;
    win.calculateRankings = wrapped;
    win.__tennisrankRankingPolicyInstalled = true;
    return true;
  }

  return {
    recordTier,
    comparePlayers,
    sortRankings,
    installBrowser,
  };
});
