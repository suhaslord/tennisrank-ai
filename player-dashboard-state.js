(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankPlayerDashboard = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function titleCase(value) {
    return String(value || "").replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
  }

  function movement(previousRank, rank) {
    const previous = Number(previousRank);
    const current = Number(rank);
    if (!Number.isInteger(previous) || !Number.isInteger(current)) return { label: "—", direction: "same" };
    const delta = previous - current;
    if (delta > 0) return { label: `↑${delta}`, direction: "up" };
    if (delta < 0) return { label: `↓${Math.abs(delta)}`, direction: "down" };
    return { label: "—", direction: "same" };
  }

  function summaryFromWorkflow(detail) {
    const viewer = detail?.viewer || {};
    const ladder = Array.isArray(detail?.ladder) ? detail.ladder : [];
    const playerId = viewer.playerId || ladder.find(entry => entry.player?.profile_id === viewer.profileId)?.player_id || null;
    const entry = playerId ? ladder.find(item => item.player_id === playerId) || null : null;
    const player = entry?.player || null;
    const grade = Number(player?.grade_level ?? viewer.gradeLevel);
    return {
      linked: Boolean(entry && player),
      playerId,
      name: player?.display_name || viewer.playerName || "My season",
      rank: entry ? Number(entry.rank_position) : null,
      previousRank: entry ? Number(entry.previous_rank_position || entry.rank_position) : null,
      movement: entry ? movement(entry.previous_rank_position || entry.rank_position, entry.rank_position) : { label: "—", direction: "same" },
      teamGender: player?.team_gender || viewer.teamGender || null,
      rosterDivision: player?.division || viewer.rosterDivision || null,
      gradeLevel: Number.isInteger(grade) && grade >= 9 && grade <= 12 ? grade : null,
      status: entry?.status || player?.active_status || null,
      linkState: viewer.linkState || null,
    };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    }[char]));
  }

  function setText(element, value) {
    if (!element) return;
    const next = String(value ?? "");
    if (element.textContent !== next) element.textContent = next;
  }

  function installBrowser(win) {
    if (!win || win.__tennisrankPlayerDashboardInstalled) return;
    win.__tennisrankPlayerDashboardInstalled = true;
    let workflow = null;
    let observer = null;

    function profile() {
      return win.TennisRankAuth?.getProfile?.() || null;
    }

    function render() {
      const dashboard = win.document.querySelector("#playerDashboard");
      if (!dashboard || profile()?.role !== "player") return;
      const summary = summaryFromWorkflow(workflow || {});
      let strip = dashboard.querySelector("#playerIdentityStrip");
      if (!strip) {
        strip = win.document.createElement("div");
        strip.id = "playerIdentityStrip";
        strip.className = "player-identity-strip";
        dashboard.querySelector(".player-heading")?.insertAdjacentElement("afterend", strip);
      }

      if (!summary.linked) {
        strip.className = "player-identity-strip is-unlinked";
        const markup = `<div><span class="player-identity-kicker">Roster connection</span><strong>Waiting for your roster link</strong><small>Your match stats remain read only. Ask the coach to make sure your account name exactly matches the imported roster.</small></div>`;
        if (strip.innerHTML !== markup) strip.innerHTML = markup;
        return;
      }

      strip.className = "player-identity-strip";
      const markup = `
        <div class="player-identity-rank"><span>Official singles rank</span><strong>#${escapeHtml(summary.rank)}</strong><small class="movement ${escapeHtml(summary.movement.direction)}">${escapeHtml(summary.movement.label)} since last official position</small></div>
        <div class="player-identity-meta"><span>${escapeHtml(summary.teamGender === "girls" ? "Girls" : "Boys")}</span><span>${escapeHtml(summary.rosterDivision === "jv" ? "JV" : "Varsity")}</span>${summary.gradeLevel ? `<span>Grade ${summary.gradeLevel}</span>` : ""}<span>${escapeHtml(titleCase(summary.status || "available"))}</span></div>`;
      if (strip.innerHTML !== markup) strip.innerHTML = markup;

      // app.js owns record/match calculations. Replace only the rank card with
      // the authoritative challenge-ladder position. setText avoids turning the
      // grid observer into a self-triggering feedback loop.
      const cards = [...dashboard.querySelectorAll("#playerStatGrid .player-stat")];
      const rankCard = cards[2];
      if (rankCard) {
        setText(rankCard.querySelector("span"), "Official rank");
        setText(rankCard.querySelector("strong"), `#${summary.rank}`);
        setText(rankCard.querySelector("small"), `${summary.teamGender === "girls" ? "Girls" : "Boys"} singles · ${summary.rosterDivision === "jv" ? "JV" : "Varsity"}`);
      }
    }

    win.addEventListener("tennisrank:ladder-workflow-ready", event => {
      workflow = event.detail || {};
      render();
    });
    win.addEventListener("tennisrank:auth-ready", () => win.requestAnimationFrame?.(render) || render());
    win.addEventListener("tennisrank:import-synced", () => win.requestAnimationFrame?.(render) || render());

    const start = () => {
      render();
      const grid = win.document.querySelector("#playerStatGrid");
      if (grid && win.MutationObserver && !observer) {
        observer = new win.MutationObserver(() => render());
        observer.observe(grid, { childList: true, subtree: true });
      }
    };
    if (win.document.readyState === "loading") win.document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }

  return { titleCase, movement, summaryFromWorkflow, setText, installBrowser };
});
