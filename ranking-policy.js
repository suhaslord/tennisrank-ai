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
    if (wins > losses) return 0;
    if (wins === losses) return 1;
    return 2;
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

  function wrapFinalCalculator(win) {
    const base = win?.calculateRankings;
    if (typeof base !== "function") return false;
    if (base.__coachRankingPolicy) {
      win.__tennisrankRankingPolicyInstalled = true;
      return true;
    }

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

  function installBrowser(win) {
    if (!win || win.__tennisrankRankingPolicyScheduled) return false;
    win.__tennisrankRankingPolicyScheduled = true;

    const apply = () => {
      // import-runtime-fixes installs its metadata guard in a zero-delay task.
      // Schedule after that task so the coach policy wraps the final safe
      // calculator rather than being replaced by it.
      win.setTimeout?.(() => {
        if (wrapFinalCalculator(win)) return;
        win.__tennisrankRankingPolicyScheduled = false;
        win.setTimeout?.(() => installBrowser(win), 20);
      }, 0);
    };

    if (win.document?.readyState === "loading") {
      win.document.addEventListener("DOMContentLoaded", apply, { once: true });
    } else {
      apply();
    }
    return true;
  }

  return {
    recordTier,
    comparePlayers,
    sortRankings,
    wrapFinalCalculator,
    installBrowser,
  };
});
