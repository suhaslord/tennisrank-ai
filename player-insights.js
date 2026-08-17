(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankPlayerInsights = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) { return String(value == null ? "" : value).replace(/\s+/g, " ").trim(); }
  function identity(value) { return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function escapeHtml(value) { return clean(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  function nameParts(value) { return clean(value).split(/\s+(?:&|and|\+|\/|vs\.?|versus)\s+/i).map(identity).filter(Boolean); }
  function belongs(value, playerName) {
    const target = identity(playerName);
    return Boolean(target && (identity(value) === target || nameParts(value).includes(target)));
  }
  function reasonLabel(value) {
    const reason = clean(value).toLowerCase();
    if (/challenge/.test(reason)) return "Challenge result";
    if (/import/.test(reason)) return "Spreadsheet import";
    if (/manual|coach|move/.test(reason)) return "Coach adjustment";
    if (/restore|undo/.test(reason)) return "Undo / restore";
    return reason ? reason.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()) : "Rank update";
  }
  function deriveRankTrend(rankHistory, currentRank) {
    const history = Array.isArray(rankHistory) ? rankHistory : [];
    const current = Number(currentRank);
    const validCurrent = Number.isInteger(current) && current > 0 ? current : null;
    const points = [];
    for (const item of history) {
      const oldRank = Number(item?.old_rank ?? item?.oldRank);
      const newRank = Number(item?.new_rank ?? item?.newRank);
      if (!points.length && Number.isInteger(oldRank) && oldRank > 0) points.push({ rank: oldRank, changedAt: item.changed_at || item.changedAt || null, reason: "Season start" });
      if (Number.isInteger(newRank) && newRank > 0) points.push({ rank: newRank, changedAt: item.changed_at || item.changedAt || null, reason: reasonLabel(item.reason) });
    }
    if (!points.length && validCurrent) points.push({ rank: validCurrent, changedAt: null, reason: "Current position" });
    if (validCurrent && points.at(-1)?.rank !== validCurrent) points.push({ rank: validCurrent, changedAt: null, reason: "Current position" });
    const seasonStartRank = points[0]?.rank ?? validCurrent;
    const bestRank = points.length ? Math.min(...points.map(item => item.rank)) : validCurrent;
    const movement = Number.isInteger(seasonStartRank) && Number.isInteger(validCurrent) ? seasonStartRank - validCurrent : 0;
    return { points, currentRank: validCurrent, seasonStartRank, bestRank, movement };
  }
  function deriveRecentForm(matches, playerName, limit = 5) {
    const relevant = (Array.isArray(matches) ? matches : [])
      .filter(match => belongs(match?.winner, playerName) || belongs(match?.loser, playerName))
      .sort((a, b) => String(b?.date || "").localeCompare(String(a?.date || "")));
    const wins = relevant.filter(match => belongs(match.winner, playerName)).length;
    const losses = relevant.length - wins;
    const last = relevant.slice(0, limit).map(match => ({
      result: belongs(match.winner, playerName) ? "W" : "L",
      opponent: belongs(match.winner, playerName) ? clean(match.loser) : clean(match.winner),
      score: clean(match.score),
      date: clean(match.date),
      division: clean(match.division),
    }));
    return { wins, losses, last };
  }
  function chartMarkup(points) {
    const safe = Array.isArray(points) && points.length ? points : [];
    if (!safe.length) return `<div class="insights-empty">Rank history starts after the first official movement.</div>`;
    const width = 680, height = 180, padX = 28, padY = 22;
    const ranks = safe.map(item => item.rank);
    const min = Math.min(...ranks, 1), max = Math.max(...ranks, 1);
    const span = Math.max(max - min, 1);
    const coords = safe.map((item, index) => {
      const x = safe.length === 1 ? width / 2 : padX + (index / (safe.length - 1)) * (width - padX * 2);
      const y = padY + ((item.rank - min) / span) * (height - padY * 2);
      return { ...item, x, y };
    });
    const path = coords.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    return `<div class="rank-chart-wrap"><svg class="rank-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Official rank history"><polyline class="rank-chart-line" points="${path}"></polyline>${coords.map((point, index) => `<g><circle class="rank-chart-dot${index === coords.length - 1 ? " current" : ""}" cx="${point.x}" cy="${point.y}" r="6"></circle><text x="${point.x}" y="${Math.max(14, point.y - 12)}" text-anchor="middle">#${point.rank}</text></g>`).join("")}</svg><div class="rank-chart-caption"><span>Season start</span><span>Current</span></div></div>`;
  }

  function installBrowser(win) {
    if (!win || win.__tennisrankPlayerInsightsInstalled) return;
    win.__tennisrankPlayerInsightsInstalled = true;
    let workflow = null;
    let recordsCache = null;
    let loading = false;

    async function loadRecords() {
      if (recordsCache) return recordsCache;
      const response = await win.TennisRankAuth.fetch("/api/records");
      if (!response.ok) return { rankings: [], matches: [] };
      const payload = await response.json().catch(() => ({}));
      recordsCache = typeof win.calculateRankings === "function" ? win.calculateRankings(payload.rows || []) : { rankings: [], matches: [] };
      return recordsCache;
    }

    async function render() {
      if (loading || win.TennisRankAuth?.getProfile?.()?.role !== "player") return;
      const dashboard = win.document.querySelector("#playerDashboard");
      if (!dashboard || !workflow?.viewer?.playerId) return;
      loading = true;
      try {
        const playerId = workflow.viewer.playerId;
        const entry = (workflow.ladder || []).find(item => item.player_id === playerId);
        const playerName = entry?.player?.display_name || workflow.viewer.playerName || win.TennisRankAuth?.getProfile?.()?.player_name || "Player";
        const trend = deriveRankTrend(workflow.rankHistory || [], entry?.rank_position);
        const calculated = await loadRecords();
        const form = deriveRecentForm(calculated.matches || [], playerName, 5);
        let panel = dashboard.querySelector("#playerSeasonInsights");
        if (!panel) {
          panel = win.document.createElement("section");
          panel.id = "playerSeasonInsights";
          panel.className = "player-season-insights";
          dashboard.querySelector("#playerStatGrid")?.insertAdjacentElement("afterend", panel);
        }
        const moveLabel = trend.movement > 0 ? `↑ ${trend.movement}` : trend.movement < 0 ? `↓ ${Math.abs(trend.movement)}` : "—";
        const recentRecord = form.last.length ? `${form.last.filter(x => x.result === "W").length}-${form.last.filter(x => x.result === "L").length}` : "0-0";
        panel.innerHTML = `<div class="insights-head"><div><p class="eyebrow">Season momentum</p><h3>Your climb</h3></div><span class="insights-status">Official ladder + imported results</span></div>
          <div class="insights-metrics"><article><span>Current rank</span><strong>${trend.currentRank ? `#${trend.currentRank}` : "—"}</strong></article><article><span>Season start</span><strong>${trend.seasonStartRank ? `#${trend.seasonStartRank}` : "—"}</strong></article><article><span>Best rank</span><strong>${trend.bestRank ? `#${trend.bestRank}` : "—"}</strong></article><article><span>Season movement</span><strong class="${trend.movement > 0 ? "positive" : trend.movement < 0 ? "negative" : ""}">${moveLabel}</strong></article></div>
          <div class="insights-grid"><article class="insights-chart-card"><div class="insights-card-head"><div><span>Rank history</span><strong>${trend.points.length > 1 ? `${trend.points.length - 1} official moves` : "Baseline"}</strong></div></div>${chartMarkup(trend.points)}</article>
          <article class="insights-form-card"><div class="insights-card-head"><div><span>Recent form</span><strong>${recentRecord} last ${form.last.length || 0}</strong></div><small>${form.wins}-${form.losses} across imported season results</small></div><div class="form-strip">${form.last.length ? form.last.map(item => `<span class="form-chip ${item.result === "W" ? "win" : "loss"}" title="${escapeHtml(item.opponent)}">${item.result}</span>`).join("") : `<span class="insights-empty">No linked results yet.</span>`}</div><div class="recent-form-list">${form.last.slice(0,3).map(item => `<div><span class="form-chip ${item.result === "W" ? "win" : "loss"}">${item.result}</span><p><b>${escapeHtml(item.opponent || "Opponent")}</b><small>${escapeHtml(item.date || "Recent")} · ${escapeHtml(item.score || "Score unavailable")}</small></p></div>`).join("")}</div></article></div>
          <div class="rank-reasons">${(workflow.rankHistory || []).slice(-4).reverse().map(item => `<span><i class="ph ph-arrow-up-right"></i>${escapeHtml(reasonLabel(item.reason))}<small>#${escapeHtml(item.old_rank)} → #${escapeHtml(item.new_rank)}</small></span>`).join("") || `<span><i class="ph ph-flag"></i>Season baseline established<small>Future official movements will appear here.</small></span>`}</div>`;
      } finally { loading = false; }
    }

    win.addEventListener("tennisrank:ladder-workflow-ready", event => { workflow = event.detail || {}; render(); });
    win.addEventListener("tennisrank:import-synced", () => { recordsCache = null; render(); });
    win.addEventListener("tennisrank:auth-ready", () => render());
    win.addEventListener("tennisrank:coach-data-changed", () => render());
    if (win.document.readyState !== "loading") render();
    else win.document.addEventListener("DOMContentLoaded", render, { once: true });
  }

  return { identity, belongs, reasonLabel, deriveRankTrend, deriveRecentForm, chartMarkup, installBrowser };
});
