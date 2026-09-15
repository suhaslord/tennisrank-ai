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

  function sourceText(value, division, row) {
    return [value, division, ...Object.values(row || {})]
      .filter(value => value !== null && value !== undefined)
      .map(value => String(value).trim())
      .filter(Boolean);
  }

  function isGirlsToken(value) {
    return /^(?:f|female|girl|girls|women|woman|wta)$/i.test(String(value || "").trim())
      || /\b(?:female|girl|girls|women|woman|wta)\b/i.test(String(value || ""));
  }

  function isBoysToken(value) {
    return /^(?:m|male|boy|boys|men|man|atp)$/i.test(String(value || "").trim())
      || /\b(?:male|boy|boys|men|man|atp)\b/i.test(String(value || ""));
  }

  function detectGender(value, division = "", row = {}) {
    const sources = sourceText(value, division, row);
    const joined = sources.join(" ");
    const explicitMixed = /\b(?:mixed|co[- ]?ed|coed)\b/i.test(joined)
      || /\b(?:boys?|men|male)\s*(?:&|\+|\/|and)\s*(?:girls?|women|female)\b/i.test(joined)
      || /\b(?:girls?|women|female)\s*(?:&|\+|\/|and)\s*(?:boys?|men|male)\b/i.test(joined)
      || /\bm\s*[&+/]\s*f\b|\bf\s*[&+/]\s*m\b/i.test(joined);
    if (explicitMixed) return "mixed";

    const hasGirls = sources.some(isGirlsToken);
    const hasBoys = sources.some(isBoysToken);
    if (hasGirls && hasBoys) return "mixed";
    if (hasGirls) return "girls";
    if (hasBoys) return "boys";
    return "unknown";
  }

  function detectDivision(value, row = {}) {
    const text = `${value || ""} ${Object.values(row || {}).join(" ")}`.toLowerCase();
    if (/\b(?:mixed|co[- ]?ed|coed)\b|\bxd\b/.test(text)) return "doubles";
    if (/double|pair|duo|team event|2v2|\b[123]d\b/.test(text)) return "doubles";
    return "singles";
  }

  function splitPairNames(value) {
    return String(value || "")
      .replace(/\s+(?:vs\.?|versus)\s+/gi, "|")
      .replace(/\s+and\s+/gi, "|")
      .replace(/\s*[&+/;|]\s*/g, "|")
      .split("|")
      .map(name => name.replace(/^\s*(?:(?:player\s*)?[ab12]\s*[:.)-]\s*|(?:player\s*)?[12]\s*[:.)-]\s*)/i, "").trim())
      .filter(Boolean);
  }

  function isSectionLabel(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    return /\b(?:boys?|girls?|men|women|male|female|mixed|co[- ]?ed|coed|singles?|doubles?|pairs?|2v2|xd)\b/i.test(text);
  }

  function mixedAwarePrepareRows(win, rows) {
    let currentGender = "";
    let currentDivision = "";
    return rows.map(row => {
      const publicValues = Object.entries(row)
        .filter(([key, value]) => !key.startsWith("__") && String(value || "").trim())
        .map(([, value]) => String(value).trim());
      const loneSection = publicValues.length === 1 && isSectionLabel(publicValues[0]) ? publicValues[0] : "";
      const explicitDivision = win.valueFrom(row, ["division", "category", "format", "event", "type", "discipline", "matchtype", "section", "group"]);
      const genderHint = win.valueFrom(row, ["gender", "sex"]) || loneSection;
      const divisionHint = explicitDivision || loneSection;
      const directGender = win.normalizeGender(genderHint, divisionHint, row);
      const directDivision = divisionHint ? win.normalizeDivision(divisionHint, row) : "";

      if (directGender !== "unknown") currentGender = directGender;
      if (directDivision) currentDivision = directDivision;

      const prepared = { ...row };
      if (loneSection) prepared.__sectionRow = true;
      if (!win.valueFrom(row, ["gender", "sex"]) && currentGender) prepared.__contextGender = currentGender;
      if (!explicitDivision && currentDivision) prepared.__contextDivision = currentDivision;
      return prepared;
    });
  }

  function installFormatSupport(win) {
    if (!win || win.__tennisrankFormatSupportInstalled) return true;
    if (typeof win.normalizeGender !== "function" || typeof win.normalizeDivision !== "function") return false;

    const baseGender = win.normalizeGender;
    const baseDivision = win.normalizeDivision;
    const baseSplitNames = win.splitNames;
    const baseGroupTitle = win.groupTitle;
    const baseRenderRankings = win.renderRankings;

    win.normalizeGender = function (value, division, row) {
      const detected = detectGender(value, division, row);
      return detected === "unknown" ? baseGender.call(this, value, division, row) : detected;
    };

    win.normalizeDivision = function (value, row) {
      const detected = detectDivision(value, row);
      if (detected === "doubles") return "doubles";
      return baseDivision.call(this, value, row);
    };

    if (typeof baseSplitNames === "function") {
      win.splitNames = function (value) {
        const names = splitPairNames(value);
        return names.length ? names : baseSplitNames.call(this, value);
      };
    }

    if (typeof win.prepareRows === "function" && typeof win.valueFrom === "function") {
      win.prepareRows = function (rows) {
        return mixedAwarePrepareRows(win, rows);
      };
    }

    if (typeof baseGroupTitle === "function") {
      win.groupTitle = function (gender, division) {
        if (gender === "mixed") return division === "doubles" ? "Mixed doubles" : "Mixed singles";
        return baseGroupTitle.call(this, gender, division);
      };
    }

    if (typeof baseRenderRankings === "function" && typeof win.rankingCard === "function") {
      const wrappedRenderRankings = function () {
        const result = baseRenderRankings.apply(this, arguments);
        try {
          if (typeof state === "undefined") return result;
          const showMixed = (state.activeGender === "all" || state.activeGender === "mixed")
            && (state.activeDivision === "all" || state.activeDivision === "doubles");
          const grid = win.document?.querySelector("#rankingsGrid");
          if (showMixed && grid) {
            grid.insertAdjacentHTML("beforeend", win.rankingCard("mixed", "doubles"));
            if (typeof win.setupStagger === "function") {
              win.setupStagger("#rankingsGrid .ranking-card");
              win.setupStagger("#rankingsGrid .ranking-row");
            }
          }
        } catch {
          // The base rankings still render if the mixed-doubles enhancement cannot.
        }
        return result;
      };
      wrappedRenderRankings.__mixedDoublesSupport = true;
      wrappedRenderRankings.__baseRenderRankings = baseRenderRankings;
      win.renderRankings = wrappedRenderRankings;
    }

    const filterBar = win.document?.querySelector(".filter-bar");
    if (filterBar && !filterBar.querySelector('[data-gender="mixed"]')) {
      const mixedButton = win.document.createElement("button");
      mixedButton.className = "filter-chip";
      mixedButton.type = "button";
      mixedButton.dataset.gender = "mixed";
      mixedButton.setAttribute("aria-pressed", "false");
      mixedButton.textContent = "Mixed";
      const girlsButton = filterBar.querySelector('[data-gender="girls"]');
      const divider = filterBar.querySelector(".filter-divider");
      if (girlsButton) girlsButton.insertAdjacentElement("afterend", mixedButton);
      else if (divider) divider.insertAdjacentElement("beforebegin", mixedButton);
      else filterBar.appendChild(mixedButton);

      mixedButton.addEventListener("click", () => {
        if (typeof state === "undefined") return;
        filterBar.querySelectorAll("[data-gender]").forEach(item => {
          item.classList.remove("active");
          item.setAttribute("aria-pressed", "false");
        });
        mixedButton.classList.add("active");
        mixedButton.setAttribute("aria-pressed", "true");
        state.activeGender = "mixed";
        if (typeof render === "function") render();
      });
    }

    const guide = win.document?.querySelector(".format-guide span");
    if (guide && !/mixed/i.test(guide.textContent || "")) {
      guide.textContent = "It also recognizes common variations, title rows, grouped Boys/Girls/Mixed or Singles/Doubles sections, mixed doubles, and player/opponent rows with W or L results.";
    }

    win.__tennisrankFormatSupportInstalled = true;

    // If data loaded before this compatibility layer was installed, recalculate it
    // once so mixed/doubles rows are corrected immediately without another import.
    try {
      if (typeof state !== "undefined" && Array.isArray(state.rows) && state.rows.length && typeof win.calculateRankings === "function") {
        const calculated = win.calculateRankings(state.rows);
        state.rankings = calculated.rankings;
        state.matches = calculated.matches;
        if (typeof win.analyzeRows === "function") state.analysis = win.analyzeRows(state.rows, calculated);
        if (typeof render === "function") render();
      }
    } catch {
      // Future imports still use the corrected functions.
    }

    return true;
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
        const formatsReady = installFormatSupport(win);
        const rankingReady = wrapFinalCalculator(win);
        if (formatsReady && rankingReady) return;
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
    detectGender,
    detectDivision,
    splitPairNames,
    installFormatSupport,
    wrapFinalCalculator,
    installBrowser,
  };
});