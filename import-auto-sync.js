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

  function rankingsToTeams(rankings) {
    const teams = { boys: [], girls: [] };
    const seen = { boys: new Set(), girls: new Set() };
    for (const item of rankings || []) {
      const team = String(item?.gender || "").toLowerCase();
      const division = String(item?.division || "").toLowerCase();
      const name = cleanName(item?.name);
      if (!teams[team] || division !== "singles" || !name) continue;
      const key = name.toLowerCase();
      if (seen[team].has(key)) continue;
      seen[team].add(key);
      teams[team].push({ name });
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

    // The coach console owns refreshWorkflow(). Calling its existing async action
    // keeps the official ladder, challenge eligibility, and roster controls in sync
    // without creating a second rendering path.
    const button = win.document?.querySelector?.(`[data-seed-team="${team}"]`);
    if (button && typeof button.onclick === "function" && !button.disabled) {
      await button.onclick();
      return { team, count: players.length, mode: "coach-ui" };
    }

    const payload = await seedThroughApi(win, team, players);
    return { team, count: players.length, mode: "api", payload };
  }

  async function syncOfficialBoards(win, rows) {
    const profile = win.TennisRankAuth?.getProfile?.();
    if (profile?.role !== "admin") return { skipped: true, reason: "not-admin" };
    if (!Array.isArray(rows) || !rows.length) return { skipped: true, reason: "no-rows" };
    if (typeof win.calculateRankings !== "function") throw new Error("Ranking engine is not ready.");

    const calculated = win.calculateRankings(rows) || {};
    const teams = rankingsToTeams(calculated.rankings || []);
    const results = [];
    for (const team of ["boys", "girls"]) {
      if (!teams[team].length) continue;
      results.push(await syncTeam(win, team, teams[team]));
    }

    win.dispatchEvent?.(new CustomEvent("tennisrank:import-synced", {
      detail: { teams, results, rowCount: rows.length },
    }));
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
    rankingsToTeams,
    seedThroughApi,
    syncTeam,
    syncOfficialBoards,
    installBrowser,
  };
});
