(() => {
  const engine = window.TennisRankLadderEngine;
  if (!engine) return;

  const ui = {
    ladder: [],
    settings: [],
    challenges: [],
    viewer: null,
    activeDialog: null,
  };

  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));

  async function api(path, options = {}) {
    if (!window.TennisRankAuth?.fetch) throw new Error("Authentication is not ready.");
    const response = await window.TennisRankAuth.fetch(path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  function currentProfile() {
    return window.TennisRankAuth?.getProfile?.() || null;
  }

  function linkedPlayer() {
    return ui.ladder.find(entry => entry.player?.profile_id && entry.player.profile_id === ui.viewer?.profileId) || null;
  }

  function teamSettings(team) {
    return ui.settings.find(item => item.team_gender === team) || { max_challenge_distance: 3 };
  }

  function eligibleDefenders() {
    const me = linkedPlayer();
    if (!me || me.status !== "available" || me.player?.active_status !== "active") return [];
    const maxDistance = Number(teamSettings(me.team_gender).max_challenge_distance || 3);
    return ui.ladder.filter(entry => entry.team_gender === me.team_gender)
      .filter(entry => entry.player_id !== me.player_id)
      .filter(entry => entry.status === "available" && entry.player?.active_status === "active")
      .filter(entry => Number(me.rank_position) - Number(entry.rank_position) >= 1)
      .filter(entry => Number(me.rank_position) - Number(entry.rank_position) <= maxDistance)
      .sort((a, b) => Number(a.rank_position) - Number(b.rank_position));
  }

  function ensureDialog() {
    let dialog = $("#challengeDialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "challengeDialog";
    dialog.className = "challenge-dialog";
    dialog.innerHTML = `<div class="challenge-dialog-inner" id="challengeDialogInner"></div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
    return dialog;
  }

  function openChallengeDialog(defender) {
    const dialog = ensureDialog();
    ui.activeDialog = { type: "challenge", defender };
    dialog.querySelector("#challengeDialogInner").innerHTML = `
      <div class="challenge-dialog-top"><div><p class="challenge-dialog-kicker">Issue challenge</p><h3>#${defender.rank_position} ${escapeHtml(defender.player.display_name)}</h3></div><button class="challenge-dialog-close" type="button" aria-label="Close">×</button></div>
      <p class="challenge-dialog-copy">Propose up to three times. The defender can accept or decline, and rankings will not change until a coach verifies the completed match.</p>
      <form class="challenge-form" id="challengeCreateForm">
        <div class="challenge-time-grid">
          <label>Option 1<input type="datetime-local" name="time1" required /></label>
          <label>Option 2<input type="datetime-local" name="time2" /></label>
          <label>Option 3<input type="datetime-local" name="time3" /></label>
        </div>
        <div class="challenge-form-status" id="challengeFormStatus"></div>
        <div class="challenge-dialog-footer"><button class="challenge-action" type="button" data-close-dialog>Cancel</button><button class="challenge-action primary" type="submit">Send challenge</button></div>
      </form>`;
    dialog.querySelector(".challenge-dialog-close").onclick = () => dialog.close();
    dialog.querySelector("[data-close-dialog]").onclick = () => dialog.close();
    dialog.querySelector("#challengeCreateForm").onsubmit = async event => {
      event.preventDefault();
      const status = dialog.querySelector("#challengeFormStatus");
      const form = new FormData(event.currentTarget);
      const proposedTimes = [form.get("time1"), form.get("time2"), form.get("time3")].filter(Boolean).map(value => new Date(value).toISOString());
      status.textContent = "Sending challenge…";
      status.classList.remove("error");
      try {
        await api("/api/challenges", { method: "POST", body: JSON.stringify({ defenderPlayerId: defender.player_id, proposedTimes }) });
        dialog.close();
        await refreshWorkflow();
      } catch (error) {
        status.textContent = error.message;
        status.classList.add("error");
      }
    };
    dialog.showModal();
  }

  function openScheduleDialog(challenge) {
    const dialog = ensureDialog();
    dialog.querySelector("#challengeDialogInner").innerHTML = `
      <div class="challenge-dialog-top"><div><p class="challenge-dialog-kicker">Schedule match</p><h3>${escapeHtml(challenge.challenger?.display_name)} vs ${escapeHtml(challenge.defender?.display_name)}</h3></div><button class="challenge-dialog-close" type="button" aria-label="Close">×</button></div>
      <form class="challenge-form" id="challengeScheduleForm">
        <label>Date and time<input type="datetime-local" name="scheduledFor" required /></label>
        <label>Court / location<input type="text" name="courtLocation" placeholder="River Islands courts" /></label>
        <div class="challenge-form-status" id="challengeFormStatus"></div>
        <div class="challenge-dialog-footer"><button class="challenge-action" type="button" data-close-dialog>Cancel</button><button class="challenge-action primary" type="submit">Save schedule</button></div>
      </form>`;
    dialog.querySelector(".challenge-dialog-close").onclick = () => dialog.close();
    dialog.querySelector("[data-close-dialog]").onclick = () => dialog.close();
    dialog.querySelector("#challengeScheduleForm").onsubmit = async event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const status = dialog.querySelector("#challengeFormStatus");
      try {
        await api("/api/challenges", { method: "PATCH", body: JSON.stringify({ challengeId: challenge.id, action: "schedule", scheduledFor: new Date(data.get("scheduledFor")).toISOString(), courtLocation: data.get("courtLocation") }) });
        dialog.close();
        await refreshWorkflow();
      } catch (error) { status.textContent = error.message; status.classList.add("error"); }
    };
    dialog.showModal();
  }

  function openScoreDialog(challenge) {
    const dialog = ensureDialog();
    dialog.querySelector("#challengeDialogInner").innerHTML = `
      <div class="challenge-dialog-top"><div><p class="challenge-dialog-kicker">Submit result</p><h3>${escapeHtml(challenge.challenger?.display_name)} vs ${escapeHtml(challenge.defender?.display_name)}</h3></div><button class="challenge-dialog-close" type="button" aria-label="Close">×</button></div>
      <p class="challenge-dialog-copy">Enter the completed match score. A coach must approve it before the ladder changes.</p>
      <form class="challenge-form" id="challengeScoreForm">
        <label>Winner<select name="winnerPlayerId" required><option value="${challenge.challenger_id}">${escapeHtml(challenge.challenger?.display_name)}</option><option value="${challenge.defender_id}">${escapeHtml(challenge.defender?.display_name)}</option></select></label>
        <label>Score<textarea name="scoreSummary" required placeholder="6-4, 4-6, 10-8"></textarea></label>
        <div class="challenge-form-status" id="challengeFormStatus"></div>
        <div class="challenge-dialog-footer"><button class="challenge-action" type="button" data-close-dialog>Cancel</button><button class="challenge-action primary" type="submit">Submit for coach approval</button></div>
      </form>`;
    dialog.querySelector(".challenge-dialog-close").onclick = () => dialog.close();
    dialog.querySelector("[data-close-dialog]").onclick = () => dialog.close();
    dialog.querySelector("#challengeScoreForm").onsubmit = async event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const status = dialog.querySelector("#challengeFormStatus");
      const scoreSummary = String(data.get("scoreSummary") || "").trim();
      const parsed = engine.parseScoreSummary(scoreSummary);
      if (!parsed.valid) { status.textContent = parsed.error; status.classList.add("error"); return; }
      try {
        await api("/api/match-score", { method: "POST", body: JSON.stringify({ challengeId: challenge.id, winnerPlayerId: data.get("winnerPlayerId"), scoreSummary }) });
        dialog.close();
        await refreshWorkflow();
      } catch (error) { status.textContent = error.message; status.classList.add("error"); }
    };
    dialog.showModal();
  }

  function challengeActionButtons(challenge) {
    const profileId = ui.viewer?.profileId;
    const isAdmin = ui.viewer?.role === "admin";
    const isDefender = challenge.defender?.profile_id === profileId;
    const isParticipant = isAdmin || challenge.challenger?.profile_id === profileId || isDefender;
    const buttons = [];
    if (challenge.status === "pending_response" && (isDefender || isAdmin)) {
      buttons.push(`<button class="challenge-action primary" data-challenge-action="accept" data-id="${challenge.id}">Accept</button>`);
      buttons.push(`<button class="challenge-action" data-challenge-action="decline" data-id="${challenge.id}">Decline</button>`);
    }
    if (challenge.status === "accepted" && isParticipant) buttons.push(`<button class="challenge-action primary" data-challenge-action="schedule" data-id="${challenge.id}">Schedule</button>`);
    if (["accepted", "scheduled", "played"].includes(challenge.status) && isParticipant) buttons.push(`<button class="challenge-action" data-challenge-action="score" data-id="${challenge.id}">Enter score</button>`);
    return buttons.join("");
  }

  function renderChallengeCenter() {
    const ladderExperience = $("#ladderExperience");
    if (!ladderExperience || !ui.viewer) return;
    let center = $("#challengeCenter");
    if (!center) {
      center = document.createElement("section");
      center.id = "challengeCenter";
      center.className = "challenge-center";
      ladderExperience.insertAdjacentElement("afterend", center);
    }
    const mine = ui.challenges.filter(challenge => ui.viewer.role === "admin" || challenge.challenger?.profile_id === ui.viewer.profileId || challenge.defender?.profile_id === ui.viewer.profileId);
    center.innerHTML = `
      <div class="challenge-center-head"><div><p class="ladder-kicker">Competition workflow</p><h3>${ui.viewer.role === "admin" ? "Challenge inbox" : "My challenges"}</h3></div><p>Accept, schedule, submit results, and track coach verification without leaving the ladder.</p></div>
      <div class="challenge-list">${mine.length ? mine.map(challenge => `
        <article class="challenge-item">
          <div><div class="challenge-title">${escapeHtml(challenge.challenger?.display_name)} vs ${escapeHtml(challenge.defender?.display_name)}</div><div class="challenge-meta">${escapeHtml(challenge.team_gender)} singles${challenge.scheduled_for ? ` · ${new Date(challenge.scheduled_for).toLocaleString()}` : ""}${challenge.court_location ? ` · ${escapeHtml(challenge.court_location)}` : ""}${challenge.match ? ` · ${escapeHtml(challenge.match.score_summary)}` : ""}</div></div>
          <div class="challenge-status ${escapeHtml(challenge.status)}">${escapeHtml(challenge.status.replaceAll("_", " "))}</div>
          <div class="challenge-actions">${challengeActionButtons(challenge)}</div>
        </article>`).join("") : `<div class="challenge-empty">No challenges yet.</div>`}</div>`;

    center.querySelectorAll("[data-challenge-action]").forEach(button => button.addEventListener("click", async () => {
      const challenge = ui.challenges.find(item => item.id === button.dataset.id);
      const action = button.dataset.challengeAction;
      if (!challenge) return;
      if (action === "schedule") return openScheduleDialog(challenge);
      if (action === "score") return openScoreDialog(challenge);
      button.disabled = true;
      try {
        await api("/api/challenges", { method: "PATCH", body: JSON.stringify({ challengeId: challenge.id, action }) });
        await refreshWorkflow();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    }));
  }

  function decorateEligibleRows() {
    const eligible = new Map(eligibleDefenders().map(entry => [entry.player_id, entry]));
    document.querySelectorAll(".ladder-row").forEach(row => {
      row.querySelector(".ladder-challenge-button")?.remove();
      const entry = eligible.get(row.dataset.playerId);
      if (!entry || ui.viewer?.role !== "player") return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ladder-challenge-button";
      button.textContent = "Challenge";
      button.addEventListener("click", () => openChallengeDialog(entry));
      row.appendChild(button);
    });
  }

  function currentSpreadsheetSingles(team) {
    try {
      return state.rankings.filter(player => player.gender === team && player.division === "singles").map(player => ({ name: player.name }));
    } catch { return []; }
  }

  function renderCoachConsole() {
    const anchor = $("#challengeCenter") || $("#ladderExperience");
    if (!anchor || ui.viewer?.role !== "admin") { $("#coachLadderConsole")?.remove(); return; }
    let consoleEl = $("#coachLadderConsole");
    if (!consoleEl) {
      consoleEl = document.createElement("section");
      consoleEl.id = "coachLadderConsole";
      consoleEl.className = "coach-ladder-console";
      anchor.insertAdjacentElement("afterend", consoleEl);
    }
    const pending = ui.challenges.filter(challenge => challenge.status === "pending_coach_approval" && challenge.match?.approval_status === "pending");
    const officialEntries = [...ui.ladder].sort((a, b) => a.team_gender.localeCompare(b.team_gender) || a.rank_position - b.rank_position);
    consoleEl.innerHTML = `
      <div class="coach-console-head"><div><p class="ladder-kicker">Coach control</p><h3>Ladder operations</h3></div><p>Verify results, initialize ladders, protect injured players, and make audited manual rank corrections.</p></div>
      <div class="coach-tabs" role="tablist"><button class="coach-tab" data-coach-tab="approvals" aria-selected="true">Approval queue (${pending.length})</button><button class="coach-tab" data-coach-tab="roster" aria-selected="false">Roster controls</button></div>
      <div class="coach-panel" data-coach-panel="approvals"><div class="approval-list">${pending.length ? pending.map(challenge => `
        <article class="approval-item"><div><div class="approval-title">${escapeHtml(challenge.challenger?.display_name)} vs ${escapeHtml(challenge.defender?.display_name)}</div><div class="approval-meta">${escapeHtml(challenge.match.score_summary)} · winner ${escapeHtml((challenge.match.winner_id === challenge.challenger_id ? challenge.challenger : challenge.defender)?.display_name)}</div></div><div class="challenge-status pending_coach_approval">Needs verification</div><div class="approval-actions"><button class="coach-action primary" data-verify="approve" data-match-id="${challenge.match.id}">Approve</button><button class="coach-action" data-verify="reject" data-match-id="${challenge.match.id}">Reject</button></div></article>`).join("") : `<div class="coach-empty">No scores are waiting for approval.</div>`}</div></div>
      <div class="coach-panel" data-coach-panel="roster" hidden>
        <div class="coach-seed-actions"><button class="coach-action" data-seed-team="boys">Initialize Boys from current board</button><button class="coach-action" data-seed-team="girls">Initialize Girls from current board</button></div>
        <div class="coach-roster-list">${officialEntries.length ? officialEntries.map(entry => `
          <article class="coach-roster-row" data-roster-player="${entry.player_id}"><div class="coach-rank-number">#${entry.rank_position}</div><div><div class="coach-roster-name">${escapeHtml(entry.player.display_name)}</div><div class="coach-roster-meta">${escapeHtml(entry.team_gender)} · ${escapeHtml(entry.player.active_status)}</div></div><select class="coach-status-select" data-status><option value="active" ${entry.player.active_status === "active" ? "selected" : ""}>Active</option><option value="injured" ${entry.player.active_status === "injured" ? "selected" : ""}>Injured</option><option value="inactive" ${entry.player.active_status === "inactive" ? "selected" : ""}>Inactive</option></select><div class="coach-roster-actions"><input class="coach-rank-input" data-new-rank type="number" min="1" value="${entry.rank_position}" aria-label="New rank for ${escapeHtml(entry.player.display_name)}" /><button class="coach-action" data-move>Move</button></div></article>`).join("") : `<div class="coach-empty">Official ladder tables are empty. Initialize Boys and Girls from the current singles board.</div>`}</div>
        <div class="coach-console-status" id="coachConsoleStatus"></div>
      </div>`;

    consoleEl.querySelectorAll("[data-coach-tab]").forEach(button => button.onclick = () => {
      consoleEl.querySelectorAll("[data-coach-tab]").forEach(item => item.setAttribute("aria-selected", String(item === button)));
      consoleEl.querySelectorAll("[data-coach-panel]").forEach(panel => panel.hidden = panel.dataset.coachPanel !== button.dataset.coachTab);
    });
    consoleEl.querySelectorAll("[data-verify]").forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        await api("/api/admin/verify-match", { method: "POST", body: JSON.stringify({ matchId: button.dataset.matchId, action: button.dataset.verify }) });
        await refreshWorkflow();
      } catch (error) { alert(error.message); button.disabled = false; }
    });
    consoleEl.querySelectorAll("[data-seed-team]").forEach(button => button.onclick = async () => {
      const team = button.dataset.seedTeam;
      const status = $("#coachConsoleStatus");
      const players = currentSpreadsheetSingles(team);
      if (!players.length) { status.textContent = `No ${team} singles players are available in the current board.`; status.classList.add("error"); return; }
      button.disabled = true;
      try {
        await api("/api/admin/seed-ladder", { method: "POST", body: JSON.stringify({ teamGender: team, players }) });
        status.textContent = `${team === "boys" ? "Boys" : "Girls"} ladder initialized.`;
        status.classList.remove("error");
        await refreshWorkflow();
      } catch (error) { status.textContent = error.message; status.classList.add("error"); button.disabled = false; }
    });
    consoleEl.querySelectorAll("[data-roster-player]").forEach(row => {
      row.querySelector("[data-status]").onchange = async event => {
        try { await api("/api/admin/ladder", { method: "PATCH", body: JSON.stringify({ action: "status", playerId: row.dataset.rosterPlayer, status: event.target.value }) }); await refreshWorkflow(); }
        catch (error) { alert(error.message); }
      };
      row.querySelector("[data-move]").onclick = async () => {
        const newRank = Number(row.querySelector("[data-new-rank]").value);
        try { await api("/api/admin/ladder", { method: "PATCH", body: JSON.stringify({ action: "move", playerId: row.dataset.rosterPlayer, newRank, reason: "Coach manual reorder" }) }); await refreshWorkflow(); }
        catch (error) { alert(error.message); }
      };
    });
  }

  async function loadOfficialLadder() {
    const payload = await api("/api/ladder");
    ui.ladder = Array.isArray(payload.ladder) ? payload.ladder : [];
    ui.settings = Array.isArray(payload.settings) ? payload.settings : [];
    ui.viewer = payload.viewer || null;
  }

  async function loadChallenges() {
    const payload = await api("/api/challenges");
    ui.challenges = Array.isArray(payload.challenges) ? payload.challenges : [];
  }

  async function refreshWorkflow() {
    try {
      await Promise.all([loadOfficialLadder(), loadChallenges()]);
      renderChallengeCenter();
      decorateEligibleRows();
      renderCoachConsole();
      window.dispatchEvent(new CustomEvent("tennisrank:ladder-workflow-ready", { detail: { ladder: ui.ladder, settings: ui.settings, viewer: ui.viewer } }));
    } catch (error) {
      // During rollout the new tables/endpoints may not exist yet. Keep the existing app usable.
      console.warn("TennisRank ladder workflow unavailable:", error.message);
    }
  }

  const observer = new MutationObserver(() => decorateEligibleRows());
  document.addEventListener("DOMContentLoaded", () => {
    const target = $("#rankingsGrid") || document.body;
    observer.observe(target, { childList: true, subtree: true });
  });
  window.addEventListener("tennisrank:auth-ready", refreshWorkflow);
  window.addEventListener("tennisrank:ladder-rendered", decorateEligibleRows);
  if (currentProfile()) refreshWorkflow();
})();
