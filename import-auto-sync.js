(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankImportAutoSync = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function cleanName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function identityKey(value) {
    return cleanName(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function normalizeKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function normalizeRosterDivision(value) {
    const text = String(value || "").trim().toLowerCase().replace(/[._-]+/g, " ");
    if (!text) return null;
    if (/\b(jv|junior\s+varsity)\b/.test(text)) return "jv";
    if (/\bvarsity\b/.test(text) && !/junior\s+varsity/.test(text)) return "varsity";
    return null;
  }

  function normalizeGradeLevel(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return null;
    const number = Number(text.match(/\b(9|10|11|12)(?:th)?\b/)?.[1]);
    if (Number.isInteger(number) && number >= 9 && number <= 12) return number;
    if (/\b(freshman|freshmen|9th\s*grade)\b/.test(text)) return 9;
    if (/\b(sophomore|sophomores|10th\s*grade)\b/.test(text)) return 10;
    if (/\b(junior|juniors|11th\s*grade)\b/.test(text) && !/junior\s+varsity/.test(text)) return 11;
    if (/\b(senior|seniors|12th\s*grade)\b/.test(text)) return 12;
    return null;
  }

  function candidateNames(row) {
    const entries = Object.entries(row || {}).filter(([key, value]) => !String(key).startsWith("__") && cleanName(value));
    const preferred = entries
      .filter(([key]) => /^(name|player|playername|athlete|student|roster|participant|competitor|displayname|teamname)$/i.test(normalizeKey(key)))
      .map(([, value]) => cleanName(value));
    return preferred.length ? preferred : entries.map(([, value]) => cleanName(value));
  }

  function rosterMetadata(rows, playerName) {
    const target = identityKey(playerName);
    if (!target) return {};
    const matches = (Array.isArray(rows) ? rows : []).filter(row => candidateNames(row).some(value => identityKey(value) === target));
    let division = null;
    let gradeLevel = null;

    for (const row of matches) {
      const entries = Object.entries(row || {}).filter(([key]) => !String(key).startsWith("__"));
      for (const [key, value] of entries) {
        const normalizedKey = normalizeKey(key);
        if (!division && /(level|squad|rosterdivision|teamdivision|teamlevel|classification|class)/.test(normalizedKey)) {
          division = normalizeRosterDivision(value);
        }
        if (!gradeLevel && /(grade|gradelevel|schoolyear|classyear|yearinschool)/.test(normalizedKey)) {
          gradeLevel = normalizeGradeLevel(value);
        }
      }
      // Some coach sheets use a generic "Division" column for Varsity/JV, while
      // others use the same header for Singles/Doubles. Only accept explicit
      // Varsity/JV values here so match-format values cannot be confused.
      if (!division) division = entries.map(([, value]) => normalizeRosterDivision(value)).find(Boolean) || null;
      if (!gradeLevel) gradeLevel = entries.map(([, value]) => normalizeGradeLevel(value)).find(Boolean) || null;
      if (division && gradeLevel) break;
    }

    return {
      ...(division ? { division } : {}),
      ...(gradeLevel ? { gradeLevel } : {}),
    };
  }

  function rankingsToTeams(rankings, rows = []) {
    const teams = { boys: [], girls: [] };
    const seen = { boys: new Set(), girls: new Set() };
    for (const item of rankings || []) {
      const team = String(item?.gender || "").toLowerCase();
      const matchFormat = String(item?.division || "").toLowerCase();
      const name = cleanName(item?.name);
      if (!teams[team] || matchFormat !== "singles" || !name) continue;
      const key = identityKey(name);
      if (seen[team].has(key)) continue;
      seen[team].add(key);
      teams[team].push({ name, ...rosterMetadata(rows, name) });
    }
    return teams;
  }

  async function readJson(response) {
    return response?.json ? response.json().catch(() => ({})) : {};
  }

  async function seedThroughApi(win, team, players) {
    const response = await win.TennisRankAuth.fetch("/api/admin/seed-ladder", {
      method: "POST",
      body: JSON.stringify({ teamGender: team, players }),
    });
    const payload = await readJson(response);
    if (!response?.ok) throw new Error(payload.error || `${team} ladder could not be synchronized.`);
    return payload;
  }

  async function syncTeam(win, team, players) {
    if (!players.length) return { team, skipped: true };
    const payload = await seedThroughApi(win, team, players);
    return { team, count: players.length, mode: "api", payload };
  }

  function dispatch(win, name, detail) {
    if (!win.dispatchEvent) return;
    const EventCtor = win.CustomEvent || (typeof CustomEvent !== "undefined" ? CustomEvent : null);
    if (EventCtor) win.dispatchEvent(new EventCtor(name, { detail }));
  }

  async function syncOfficialBoards(win, rows) {
    const profile = win.TennisRankAuth?.getProfile?.();
    if (profile?.role !== "admin") return { skipped: true, reason: "not-admin" };
    if (!Array.isArray(rows) || !rows.length) return { skipped: true, reason: "no-rows" };
    if (typeof win.calculateRankings !== "function") throw new Error("Ranking engine is not ready.");

    const calculated = win.calculateRankings(rows) || {};
    const teams = rankingsToTeams(calculated.rankings || [], rows);
    const results = [];
    for (const team of ["boys", "girls"]) {
      if (!teams[team].length) continue;
      results.push(await syncTeam(win, team, teams[team]));
    }

    // Reuse challenge-ui's existing auth-ready listener as the single official
    // workflow refresh path. app.js safely ignores duplicate initialization.
    if (results.length) {
      dispatch(win, "tennisrank:auth-ready", {
        profile,
        session: win.TennisRankAuth?.getSession?.() || null,
      });
    }
    dispatch(win, "tennisrank:import-synced", { teams, results, rowCount: rows.length });
    return { teams, results };
  }

  function installBrowser(win) {
    if (win.__tennisrankImportAutoSyncInstalled) return;
    win.__tennisrankImportAutoSyncInstalled = true;

    const install = () => {
      if (typeof win.loadRows !== "function" || typeof win.syncToBackend !== "function") {
        win.setTimeout(install, 25);
        return;
      }
      if (win.syncToBackend.__officialBoardsSynced) return;

      let lastRows = null;
      const baseLoadRows = win.loadRows;
      const trackedLoadRows = function (rows, source) {
        if (Array.isArray(rows) && rows.length) lastRows = rows;
        return baseLoadRows.apply(this, arguments);
      };
      trackedLoadRows.__tracksImportRows = true;
      trackedLoadRows.__baseLoadRows = baseLoadRows;
      win.loadRows = trackedLoadRows;

      const baseSync = win.syncToBackend;
      const synced = async function (rows) {
        const candidate = Array.isArray(rows) && rows.length ? rows : lastRows;
        const result = await baseSync.apply(this, arguments);
        if (candidate?.length) {
          try {
            await syncOfficialBoards(win, candidate);
          } catch (error) {
            const wrapped = new Error(`Team data was saved, but the official ladder refresh failed: ${error.message}`);
            wrapped.cause = error;
            wrapped.code = "OFFICIAL_LADDER_SYNC_FAILED";
            throw wrapped;
          }
        }
        return result;
      };
      synced.__officialBoardsSynced = true;
      synced.__baseSync = baseSync;
      win.syncToBackend = synced;
    };

    // Import runtime patches its own wrappers with a zero-delay task. Install one
    // tick later so this becomes the final publish hook regardless of script order.
    win.setTimeout(install, 0);
  }

  return {
    cleanName,
    identityKey,
    normalizeRosterDivision,
    normalizeGradeLevel,
    candidateNames,
    rosterMetadata,
    rankingsToTeams,
    readJson,
    seedThroughApi,
    syncTeam,
    dispatch,
    syncOfficialBoards,
    installBrowser,
  };
});
