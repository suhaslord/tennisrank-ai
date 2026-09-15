(() => {
  const engine = window.TennisRankLadderEngine;
  if (!engine) return;

  const SNAPSHOT_KEY = "tennisRankLadderSnapshotV2";
  const BOARDS = [
    { key: "boys|singles", gender: "boys", division: "singles", label: "Boys Singles", challenge: true },
    { key: "girls|singles", gender: "girls", division: "singles", label: "Girls Singles", challenge: true },
    { key: "boys|doubles", gender: "boys", division: "doubles", label: "Boys Doubles", challenge: false },
    { key: "girls|doubles", gender: "girls", division: "doubles", label: "Girls Doubles", challenge: false },
    { key: "mixed|doubles", gender: "mixed", division: "doubles", label: "Mixed Doubles", challenge: false },
  ];

  const view = {
    board: "boys|singles",
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

  function boardConfig(key = view.board) {
    return BOARDS.find(item => item.key === key) || BOARDS[0];
  }

  function importedPlayers(appState, board) {
    return (appState?.rankings || [])
      .filter(player => String(player.gender || "").toLowerCase() === board.gender && String(player.division || "").toLowerCase() === board.division)
      .map((player, index) => ({
        id: player.key || `${board.key}-${identity(player.name)}`,
        name: player.name,
        gender: board.gender,
        division: board.division,
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

  function officialPlayers(appState, board) {
    if (!board.challenge) return [];
    const entries = view.official
      .filter(entry => entry.team_gender === board.gender)
      .sort((a, b) => Number(a.rank_position) - Number(b.rank_position));
    if (!entries.length) return [];
    return entries.map(entry => {
      const stats = (appState?.rankings || []).find(player => String(player.gender || "").toLowerCase() === board.gender
        && String(player.division || "").toLowerCase() === "singles"
        && identity(player.name) === identity(entry.player?.display_name));
      return {
        id: entry.player_id,
        name: entry.player?.display_name || "Unnamed player",
        gender: board.gender,
        division: "singles",
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

  function playersForBoard(appState, board = boardConfig()) {
    const official = officialPlayers(appState, board);
    return official.length ? official : importedPlayers(appState, board);
  }

  function currentFingerprint(appState) {
    return BOARDS.flatMap(board => importedPlayers(appState, board).map(player => `${board.key}:${player.id}:${player.rank}`)).join("|");
  }

  function captureFallbackMovement(appState) {
    const fingerprint = currentFingerprint(appState);
    if (!fingerprint || fingerprint === view.currentFingerprint) return;
    let snapshot = null;
    try { snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null"); } catch { localStorage.removeItem(SNAPSHOT_KEY); }
    view.previousRanks = new Map((snapshot?.entries || []).map(entry => [entry.id, Number(entry.rank)]));
    view.currentFingerprint = fingerprint;
    try {
      const entries = BOARDS.flatMap(board => importedPlayers(appState, board).map(player => ({ id: player.id, rank: player.rank })));
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ entries, savedAt: new Date().toISOString() }));
    } catch { /* display enhancement only */ }
  }

  function movementFor(player) {
    if (player.official) return engine.movementLabel(player.previousRank, player.rank);
    return engine.movementLabel(view.previousRanks.get(player.id), player.rank);
  }

  function bestStreak(appState, players, board) {
    const matches = (appState?.matches || []).filter(match => String(match.gender || "").toLowerCase() === board.gender
      && String(match.division || "").toLowerCase() === board.division);
    return players.map(player => ({ player, streak: engine.currentWinStreak(matches, player.name) }))
      .sort((a, b) => b.streak - a.streak || a.player.rank - b.player.rank)[0] || null;
  }

  function topClimber(players) {
    return players.map(player => ({ player, movement: movementFor(player) }))
      .filter(item => item.movement.delta > 0)
      .sort((a, b) => b.movement.delta - a.movement.delta || a.player.rank - b.player.rank)[0] || null;
  }

  function metricMarkup(appState, players, board) {
    const mostWins = [...players].sort((a, b) => b.wins - a.wins || a.rank - b.rank)[0] || null;
    const streak = bestStreak(appState, players, board);
    const climber = topClimber(players);
    return `
      <div class="ladder-metric"><span class="ladder-metric-label">Players / teams</span><strong>${players.length}</strong><small>${players.length ? escapeHtml(board.label) : "Waiting for data"}</small></div>
      <div class="ladder-metric"><span class="ladder-metric-label">Most wins</span><strong>${mostWins ? mostWins.wins : 0}</strong><small>${mostWins ? escapeHtml(mostWins.name) : "Waiting for results"}</small></div>
      <div class="ladder-metric"><span class="ladder-metric-label">Active streak</span><strong>${streak?.streak || 0}</strong><small>${streak?.streak ? escapeHtml(streak.player.name) : climber ? `Top climber ${escapeHtml(climber.player.name)}` : "Baseline established"}</small></div>`;
  }

  function boardMarkup(players, board) {
    if (!players.length) return `<div class="ladder-empty">No ${escapeHtml(board.label.toLowerCase())} rankings yet.</div>`;
    return players.map(player => {
      const movement = movementFor(player);
      const status = board.challenge
        ? (player.activeStatus === "injured" ? "Injury hold" : player.activeStatus === "inactive" ? "Inactive" : String(player.status || "available").replaceAll("_", " "))
        : "ranking";
      return `
        <article class="ladder-row" data-player-id="${escapeHtml(player.id)}" data-ranking-board="${escapeHtml(board.key)}">
          <div class="ladder-rank">#${player.rank}</div>
          <div class="ladder-movement ${movement.direction}">${movement.label}</div>
          <div><div class="ladder-player-name">${escapeHtml(player.name)}</div><div class="ladder-record">${player.wins}W · ${player.losses}L · ${Math.round(player.winRate * 100)}%</div></div>
          <div class="ladder-status">${escapeHtml(status)}</div>
          <div class="ladder-challenge-state"></div>
        </article>`;
    }).join("");
  }

  function tabMarkup() {
    return BOARDS.map(board => {
      const legacyTeam = board.division === "singles" ? ` data-ladder-team="${board.gender}"` : "";
      return `<button class="ladder-tab" type="button" role="tab" data-ladder-board="${board.key}"${legacyTeam} aria-selected="${board.key === view.board}">${board.label}</button>`;
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
      <div class="ladder-intro">
        <div>
          <p class="ladder-kicker">River Islands Tennis · Live rankings</p>
          <h2 id="ladderExperienceTitle">Every board.<br>One view.</h2>
          <p class="ladder-intro-copy">Switch between singles, doubles, and mixed rankings. Challenge matches remain on the official boys and girls singles ladders.</p>
        </div>
        <div class="ladder-tabs" role="tablist" aria-label="Ranking board">${tabMarkup()}</div>
      </div>
      <div class="ladder-metrics" id="ladderMetrics"></div>
      <div class="ladder-board">
        <div class="ladder-board-head"><h3 id="ladderBoardTitle">Boys Singles</h3><p id="ladderBoardNote"></p></div>
        <div class="ladder-list" id="ladderList"></div>
      </div>`;
    hero.insertAdjacentElement("afterend", section);
    section.querySelectorAll("[data-ladder-board]").forEach(button => button.addEventListener("click", () => {
      view.board = button.dataset.ladderBoard;
      section.querySelectorAll("[data-ladder-board]").forEach(item => item.setAttribute("aria-selected", String(item === button)));
      render();
    }));
    return section;
  }

  function render() {
    const appState = getAppState();
    const shell = ensureShell();
    if (!appState || !shell) return;
    captureFallbackMovement(appState);
    const board = boardConfig();
    const players = playersForBoard(appState, board);
    shell.querySelector("#ladderMetrics").innerHTML = metricMarkup(appState, players, board);
    shell.querySelector("#ladderList").innerHTML = boardMarkup(players, board);
    shell.querySelector("#ladderBoardTitle").textContent = board.label;
    shell.querySelector("#ladderBoardNote").textContent = board.challenge
      ? (players.some(player => player.official)
        ? "Official coach-managed singles ladder. Eligible player accounts can challenge within the configured range."
        : "Imported singles ranking preview. Coach initialization turns this into the official challenge ladder.")
      : "Imported ranking board. Doubles and mixed results are tracked here; the challenge ladder stays singles-only.";
    shell.querySelectorAll("[data-ladder-board]").forEach(item => item.setAttribute("aria-selected", String(item.dataset.ladderBoard === board.key)));
    window.dispatchEvent(new CustomEvent("tennisrank:ladder-rendered", { detail: { board: board.key, challengeBoard: board.challenge } }));
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