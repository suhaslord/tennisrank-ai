(() => {
  const engine = window.TennisRankLadderEngine;
  if (!engine) return;

  const SNAPSHOT_KEY = "tennisRankLadderSnapshotV1";
  const view = {
    team: "boys",
    official: [],
    settings: [],
    viewer: null,
    previousRanks: new Map(),
    currentFingerprint: "",
  };

  function getAppState() {
    try { return state; } catch { return null; }
  }

  function identity(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    }[character]));
  }

  function fallbackPlayers(appState, team) {
    return (appState?.rankings || [])
      .filter(player => player.gender === team && player.division === "singles")
      .map((player, index) => ({
        id: player.key || `${team}-${identity(player.name)}`,
        name: player.name,
        gender: team,
        wins: Number(player.wins || 0),
        losses: Number(player.losses || 0),
        matches: Number(player.matches || 0),
        winRate: Number(player.winRate || 0),
        rank: index + 1,
        previousRank: null,
        status: "available",
        official: false,
      }));
  }

  function officialPlayers(appState, team) {
    const entries = view.official.filter(entry => entry.team_gender === team).sort((a, b) => Number(a.rank_position) - Number(b.rank_position));
    if (!entries.length) return [];
    return entries.map(entry => {
      const stats = (appState?.rankings || []).find(player => player.gender === team && player.division === "singles" && identity(player.name) === identity(entry.player?.display_name));
      return {
        id: entry.player_id,
        name: entry.player?.display_name || "Unnamed player",
        gender: team,
        wins: Number(stats?.wins || 0),
        losses: Number(stats?.losses || 0),
        matches: Number(stats?.matches || 0),
        winRate: Number(stats?.winRate || 0),
        rank: Number(entry.rank_position),
        previousRank: Number(entry.previous_rank_position || entry.rank_position),
        status: entry.status || "available",
        activeStatus: entry.player?.active_status || "active",
        official: true,
      };
    });
  }

  function playersForTeam(appState, team) {
    const official = officialPlayers(appState, team);
    return official.length ? official : fallbackPlayers(appState, team);
  }

  function currentFingerprint(appState) {
    return ["boys", "girls"].flatMap(team => playersForTeam(appState, team).map(player => `${team}:${player.id}:${player.rank}`)).join("|");
  }

  function captureFallbackMovement(appState) {
    if (view.official.length) return;
    const fingerprint = currentFingerprint(appState);
    if (!fingerprint || fingerprint === view.currentFingerprint) return;
    let snapshot = null;
    try { snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null"); } catch { localStorage.removeItem(SNAPSHOT_KEY); }
    view.previousRanks = new Map((snapshot?.entries || []).map(entry => [entry.id, Number(entry.rank)]));
    view.currentFingerprint = fingerprint;
    try {
      const entries = ["boys", "girls"].flatMap(team => playersForTeam(appState, team).map(player => ({ id: player.id, rank: player.rank })));
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ entries, savedAt: new Date().toISOString() }));
    } catch { /* display enhancement only */ }
  }

  function movementFor(player) {
    if (player.official) return engine.movementLabel(player.previousRank, player.rank);
    return engine.movementLabel(view.previousRanks.get(player.id), player.rank);
  }

  function bestStreak(appState, players) {
    const matches = (appState?.matches || []).filter(match => match.gender === view.team && match.division === "singles");
    return players.map(player => ({ player, streak: engine.currentWinStreak(matches, player.name) }))
      .sort((a, b) => b.streak - a.streak || a.player.rank - b.player.rank)[0] || null;
  }

  function topClimber(players) {
    return players.map(player => ({ player, movement: movementFor(player) }))
      .filter(item => item.movement.delta > 0)
      .sort((a, b) => b.movement.delta - a.movement.delta || a.player.rank - b.player.rank)[0] || null;
  }

  function leaderMarkup(players) {
    const leaders = players.slice(0, 3);
    if (!leaders.length) return `<div class="ladder-empty">No ${view.team} singles players are ranked yet.</div>`;
    return leaders.map((player, index) => `
      <article class="ladder-leader">
        <span class="ladder-spotlight-label">${index === 0 ? "Current leader" : `Rank ${index + 1}`}</span>
        <span class="ladder-leader-rank">#${player.rank}</span>
        <strong class="ladder-leader-name">${escapeHtml(player.name)}</strong>
        <span class="ladder-leader-detail">${player.wins}-${player.losses} · ${Math.round(player.winRate * 100)}% win rate</span>
      </article>`).join("");
  }

  function metricMarkup(appState, players) {
    const mostWins = [...players].sort((a, b) => b.wins - a.wins || a.rank - b.rank)[0] || null;
    const streak = bestStreak(appState, players);
    const climber = topClimber(players);
    return `
      <div class="ladder-metric"><span class="ladder-metric-label">Most Wins</span><strong>${mostWins ? mostWins.wins : 0}</strong><small>${mostWins ? escapeHtml(mostWins.name) : "Waiting for results"}</small></div>
      <div class="ladder-metric"><span class="ladder-metric-label">Active Streak</span><strong>${streak?.streak || 0}</strong><small>${streak?.streak ? escapeHtml(streak.player.name) : "No active streak yet"}</small></div>
      <div class="ladder-metric"><span class="ladder-metric-label">Top Climber</span><strong>${climber ? `↑${climber.movement.delta}` : "—"}</strong><small>${climber ? escapeHtml(climber.player.name) : "Baseline established"}</small></div>`;
  }

  function boardMarkup(players) {
    if (!players.length) return `<div class="ladder-empty">No players are available in this ladder yet.</div>`;
    return players.map(player => {
      const movement = movementFor(player);
      const status = player.activeStatus === "injured" ? "Injury hold" : player.activeStatus === "inactive" ? "Inactive" : String(player.status || "available").replaceAll("_", " ");
      return `
        <article class="ladder-row" data-player-id="${escapeHtml(player.id)}">
          <div class="ladder-rank">#${player.rank}</div>
          <div class="ladder-movement ${movement.direction}">${movement.label}</div>
          <div><div class="ladder-player-name">${escapeHtml(player.name)}</div><div class="ladder-record">${player.wins}W · ${player.losses}L · ${Math.round(player.winRate * 100)}%</div></div>
          <div class="ladder-status">${escapeHtml(status)}</div>
          <div class="ladder-challenge-state"></div>
        </article>`;
    }).join("");
  }

  function ensureShell() {
    if (document.querySelector("#ladderExperience")) return document.querySelector("#ladderExperience");
    const hero = document.querySelector(".hero-section");
    if (!hero) return null;
    const section = document.createElement("section");
    section.className = "ladder-experience";
    section.id = "ladderExperience";
    section.setAttribute("aria-labelledby", "ladderExperienceTitle");
    section.innerHTML = `
      <div class="ladder-intro"><div><p class="ladder-kicker">River Islands Tennis · Live singles ladder</p><h2 id="ladderExperienceTitle">The board.<br>Right now.</h2><p class="ladder-intro-copy">One team at a time. Current positions, form, and the next competitive move—without digging through a spreadsheet.</p></div><div class="ladder-tabs" role="tablist" aria-label="Team ladder"><button class="ladder-tab" type="button" role="tab" data-ladder-team="boys" aria-selected="true">Boys Ladder</button><button class="ladder-tab" type="button" role="tab" data-ladder-team="girls" aria-selected="false">Girls Ladder</button></div></div>
      <div class="ladder-stage"><img class="ladder-stage-photo" src="/assets/team-court.jpg" alt="River Islands tennis team on court" loading="lazy" decoding="async" /><div class="ladder-spotlight" id="ladderSpotlight"></div></div>
      <div class="ladder-metrics" id="ladderMetrics"></div>
      <div class="ladder-board"><div class="ladder-board-head"><h3 id="ladderBoardTitle">Boys singles</h3><p id="ladderBoardNote">Official positions appear here once the coach initializes the ladder. Until then, the current imported singles order is shown as a preview.</p></div><div class="ladder-list" id="ladderList"></div></div>`;
    hero.insertAdjacentElement("afterend", section);
    section.querySelectorAll("[data-ladder-team]").forEach(button => button.addEventListener("click", () => {
      view.team = button.dataset.ladderTeam;
      section.querySelectorAll("[data-ladder-team]").forEach(item => item.setAttribute("aria-selected", String(item === button)));
      render();
    }));
    return section;
  }

  function render() {
    const appState = getAppState();
    const shell = ensureShell();
    if (!appState || !shell) return;
    captureFallbackMovement(appState);
    const players = playersForTeam(appState, view.team);
    shell.querySelector("#ladderSpotlight").innerHTML = leaderMarkup(players);
    shell.querySelector("#ladderMetrics").innerHTML = metricMarkup(appState, players);
    shell.querySelector("#ladderList").innerHTML = boardMarkup(players);
    shell.querySelector("#ladderBoardTitle").textContent = `${view.team === "boys" ? "Boys" : "Girls"} singles`;
    shell.querySelector("#ladderBoardNote").textContent = players.some(player => player.official)
      ? "Official coach-managed ladder. Eligible player accounts can challenge up to the configured number of positions above."
      : "Preview order from the imported singles board. Coach initialization turns this into the official challenge ladder.";
    window.dispatchEvent(new CustomEvent("tennisrank:ladder-rendered"));
  }

  function observeExistingApp() {
    const rankingTable = document.querySelector("#rankingTable");
    if (!rankingTable || !("MutationObserver" in window)) return;
    new MutationObserver(() => render()).observe(rankingTable, { childList: true, subtree: true });
  }

  window.addEventListener("tennisrank:ladder-workflow-ready", event => {
    view.official = Array.isArray(event.detail?.ladder) ? event.detail.ladder : [];
    view.settings = Array.isArray(event.detail?.settings) ? event.detail.settings : [];
    view.viewer = event.detail?.viewer || null;
    render();
  });
  window.addEventListener("tennisrank:auth-ready", () => requestAnimationFrame(render));
  document.addEventListener("DOMContentLoaded", () => { render(); observeExistingApp(); });
  if (document.readyState !== "loading") { render(); observeExistingApp(); }
})();
