(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankCoachOps = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const OPEN = new Set(["pending_response", "accepted", "scheduled", "played", "score_submitted", "pending_coach_approval"]);
  let trackedRows = null;
  let trackedSource = "";

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function identity(value) {
    return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function groupKey(item) {
    return `${clean(item?.gender).toLowerCase()}|${clean(item?.division).toLowerCase()}`;
  }

  function boardLabel(key) {
    const [gender, division] = String(key || "").split("|");
    return `${gender === "girls" ? "Girls" : gender === "boys" ? "Boys" : "Unknown"} ${division === "doubles" ? "Doubles" : division === "singles" ? "Singles" : "Unknown"}`;
  }

  function boardEntries(rankings) {
    const groups = new Map();
    for (const item of Array.isArray(rankings) ? rankings : []) {
      const key = groupKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const entries = [];
    for (const [key, items] of groups) {
      items.forEach((item, index) => entries.push({
        key: `${key}|${identity(item?.name)}`,
        board: key,
        name: clean(item?.name),
        rank: index + 1,
        wins: Number(item?.wins || 0),
        losses: Number(item?.losses || 0),
      }));
    }
    return entries;
  }

  async function request(win, url, options) {
    const response = await win.TennisRankAuth.fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function sourceLabel(win) {
    const source = clean(trackedSource).toLowerCase();
    const sheetUrl = clean(win.document.querySelector("#sheetUrl")?.value);
    const file = win.document.querySelector("#csvFile")?.files?.[0];
    if (source === "sheet" && sheetUrl) return sheetUrl;
    if (source === "csv" && file?.name) return `CSV: ${file.name}`;
    if (source === "csv") return "Pasted CSV";
    if (source === "backend") return "Saved board";
    return clean(trackedSource) || "Manual import";
  }

  function analysisWarnings(win) {
    const warnings = [];
    const confidence = clean(win.document.querySelector("#analyzerConfidence")?.textContent).toUpperCase();
    const note = clean(win.document.querySelector("#analyzerNote")?.textContent);
    if (/LOW|REVIEW|UNCERTAIN/.test(confidence)) warnings.push(`Analyzer confidence is ${confidence.toLowerCase()}. Review the detected columns carefully.`);
    if (/warning|uncertain|could not|missing|review/i.test(note) && note.length < 260) warnings.push(note);
    return warnings;
  }

  async function buildPreview(win, rows, serverPreview) {
    if (typeof win.calculateRankings !== "function") throw new Error("Ranking engine is not ready yet.");
    const candidate = win.calculateRankings(rows) || {};
    const currentPayload = await request(win, "/api/records", { method: "GET" });
    const current = Array.isArray(currentPayload.rows) && currentPayload.rows.length ? win.calculateRankings(currentPayload.rows) || {} : { rankings: [] };
    const nextEntries = boardEntries(candidate.rankings || []);
    const oldEntries = boardEntries(current.rankings || []);
    const nextMap = new Map(nextEntries.map(item => [item.key, item]));
    const oldMap = new Map(oldEntries.map(item => [item.key, item]));

    const newPlayers = nextEntries.filter(item => !oldMap.has(item.key));
    const removedPlayers = oldEntries.filter(item => !nextMap.has(item.key));
    const rankChanges = nextEntries
      .filter(item => oldMap.has(item.key) && oldMap.get(item.key).rank !== item.rank)
      .map(item => ({ ...item, oldRank: oldMap.get(item.key).rank, newRank: item.rank }));
    const detectedBoards = [...new Set(nextEntries.map(item => item.board).filter(key => !key.includes("unknown")))];
    const warnings = analysisWarnings(win);

    if (!nextEntries.length) warnings.push("No ranked tennis players or teams were detected. Publishing this would empty the visible rankings.");
    if (oldEntries.length && removedPlayers.length / oldEntries.length >= 0.3) warnings.push(`${removedPlayers.length} existing ranked entries would disappear. Confirm the spreadsheet is complete before publishing.`);
    for (const expected of ["boys|singles", "girls|singles", "boys|doubles", "girls|doubles"]) {
      if (!detectedBoards.includes(expected)) warnings.push(`${boardLabel(expected)} was not detected in this import.`);
    }
    if (serverPreview.unchanged) warnings.unshift("This file matches the latest saved import. Publishing it will create a new history point but will not change the data.");

    const teams = win.TennisRankImportAutoSync?.rankingsToTeams
      ? win.TennisRankImportAutoSync.rankingsToTeams(candidate.rankings || [], rows)
      : { boys: [], girls: [] };

    return {
      rowCount: rows.length,
      rankingCount: nextEntries.length,
      detectedBoards,
      newPlayers: newPlayers.slice(0, 50),
      removedPlayers: removedPlayers.slice(0, 50),
      rankChanges: rankChanges.slice(0, 100),
      warnings: [...new Set(warnings.filter(Boolean))].slice(0, 20),
      officialTeams: teams,
      unchanged: Boolean(serverPreview.unchanged),
      sourceLabel: serverPreview.sourceLabel,
    };
  }

  function ensurePreviewModal(win) {
    let modal = win.document.querySelector("#importPreviewModal");
    if (modal) return modal;
    modal = win.document.createElement("div");
    modal.id = "importPreviewModal";
    modal.className = "coach-modal-shell";
    modal.hidden = true;
    modal.innerHTML = `<div class="coach-modal-backdrop"></div><section class="coach-modal" role="dialog" aria-modal="true" aria-labelledby="importPreviewTitle"><div class="coach-modal-head"><div><p class="eyebrow">Import safety check</p><h2 id="importPreviewTitle">Preview before publishing</h2></div><button type="button" class="close-button" data-preview-cancel aria-label="Cancel import">×</button></div><div id="importPreviewBody"></div><div class="coach-modal-actions"><button type="button" class="ghost-button" data-preview-cancel>Cancel</button><button type="button" class="primary-button" data-preview-confirm><span>Publish changes</span><i class="ph ph-check" aria-hidden="true"></i></button></div></section>`;
    win.document.body.appendChild(modal);
    return modal;
  }

  function itemList(items, mapper, empty) {
    if (!items.length) return `<p class="coach-empty">${escapeHtml(empty)}</p>`;
    return `<ul class="coach-change-list">${items.slice(0, 8).map(mapper).join("")}${items.length > 8 ? `<li class="coach-more">+${items.length - 8} more</li>` : ""}</ul>`;
  }

  function renderPreview(win, preview) {
    const modal = ensurePreviewModal(win);
    const body = modal.querySelector("#importPreviewBody");
    body.innerHTML = `<div class="coach-preview-summary"><div><strong>${preview.rowCount}</strong><span>Rows</span></div><div><strong>${preview.detectedBoards.length}</strong><span>Boards</span></div><div><strong>${preview.newPlayers.length}</strong><span>New</span></div><div><strong>${preview.removedPlayers.length}</strong><span>Removed</span></div><div><strong>${preview.rankChanges.length}</strong><span>Rank moves</span></div></div>
      <div class="coach-preview-source"><span>Source</span><strong>${escapeHtml(preview.sourceLabel)}</strong></div>
      ${preview.warnings.length ? `<div class="coach-warning-box"><strong>Review before publishing</strong>${itemList(preview.warnings, item => `<li>${escapeHtml(item)}</li>`, "")}</div>` : `<div class="coach-safe-box"><i class="ph ph-shield-check"></i><span>No import warnings detected.</span></div>`}
      <div class="coach-preview-grid"><article><h3>New entries</h3>${itemList(preview.newPlayers, item => `<li><b>${escapeHtml(item.name)}</b><span>${escapeHtml(boardLabel(item.board))} · #${item.rank}</span></li>`, "No new players or teams.")}</article>
      <article><h3>Removed / inactive</h3>${itemList(preview.removedPlayers, item => `<li><b>${escapeHtml(item.name)}</b><span>${escapeHtml(boardLabel(item.board))} · was #${item.rank}</span></li>`, "Nobody removed.")}</article>
      <article><h3>Rank changes</h3>${itemList(preview.rankChanges, item => `<li><b>${escapeHtml(item.name)}</b><span>${escapeHtml(boardLabel(item.board))} · #${item.oldRank} → #${item.newRank}</span></li>`, "No existing rank changes.")}</article>
      <article><h3>Detected boards</h3>${itemList(preview.detectedBoards, key => `<li><b>${escapeHtml(boardLabel(key))}</b></li>`, "No boards detected.")}</article></div>`;
    modal.hidden = false;
    win.document.body.classList.add("coach-modal-open");
    modal.querySelector("[data-preview-confirm]")?.focus();
    return modal;
  }

  function awaitPreviewDecision(win, preview) {
    const modal = renderPreview(win, preview);
    return new Promise(resolve => {
      const confirm = modal.querySelector("[data-preview-confirm]");
      const cancels = [...modal.querySelectorAll("[data-preview-cancel]"), modal.querySelector(".coach-modal-backdrop")].filter(Boolean);
      const finish = value => {
        modal.hidden = true;
        win.document.body.classList.remove("coach-modal-open");
        confirm.removeEventListener("click", yes);
        cancels.forEach(button => button.removeEventListener("click", no));
        win.document.removeEventListener("keydown", keydown);
        resolve(value);
      };
      const yes = () => finish(true);
      const no = () => finish(false);
      const keydown = event => { if (event.key === "Escape") finish(false); };
      confirm.addEventListener("click", yes);
      cancels.forEach(button => button.addEventListener("click", no));
      win.document.addEventListener("keydown", keydown);
    });
  }

  async function restoreLiveRows(win) {
    try {
      const live = await request(win, "/api/records", { method: "GET" });
      if (Array.isArray(live.rows) && typeof win.loadRows === "function") win.loadRows(live.rows, "backend");
    } catch (_) {}
  }

  async function previewAndPublish(win, rows) {
    const candidate = Array.isArray(rows) && rows.length ? rows : trackedRows;
    if (!candidate?.length) throw new Error("No spreadsheet rows are ready to publish.");
    const source = sourceLabel(win);
    const serverPreview = await request(win, "/api/records", {
      method: "POST",
      body: JSON.stringify({ action: "preview", rows: candidate, source }),
    });
    const preview = await buildPreview(win, candidate, serverPreview);
    const confirmed = await awaitPreviewDecision(win, preview);
    if (!confirmed) {
      await restoreLiveRows(win);
      const error = new Error("Import cancelled. The live board was not changed.");
      error.code = "IMPORT_CANCELLED";
      throw error;
    }
    const published = await request(win, "/api/records", {
      method: "POST",
      body: JSON.stringify({ action: "publish", rows: candidate, source, previewHash: serverPreview.previewHash, previewSummary: preview }),
    });
    if (win.TennisRankImportAutoSync?.syncOfficialBoards) await win.TennisRankImportAutoSync.syncOfficialBoards(win, candidate);
    const backend = win.document.querySelector("#backendStatus");
    if (backend) { backend.textContent = `Database connected · ${candidate.length} rows published with rollback history`; backend.className = "connected"; }
    win.dispatchEvent?.(new CustomEvent("tennisrank:coach-data-changed", { detail: { type: "import", snapshotId: published.snapshotId } }));
    return published;
  }

  function installPublishGuard(win) {
    if (win.__tennisrankCoachPublishGuard) return true;
    if (typeof win.loadRows !== "function" || typeof win.syncToBackend !== "function" || !win.TennisRankImportAutoSync) return false;
    const baseLoad = win.loadRows;
    if (!baseLoad.__coachOpsTracked) {
      const tracked = function (rows, source) {
        if (Array.isArray(rows) && rows.length) trackedRows = rows;
        if (source) trackedSource = source;
        return baseLoad.apply(this, arguments);
      };
      tracked.__coachOpsTracked = true;
      tracked.__baseLoadRows = baseLoad;
      win.loadRows = tracked;
    }
    const baseSync = win.syncToBackend;
    const guarded = function (rows) { return previewAndPublish(win, rows); };
    guarded.__coachOpsPreview = true;
    guarded.__baseSync = baseSync;
    win.syncToBackend = guarded;
    win.__tennisrankCoachPublishGuard = true;
    return true;
  }

  function formatDate(value) {
    const time = Date.parse(String(value || ""));
    if (!Number.isFinite(time)) return "—";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(time));
  }

  function ensureCoachDashboard(win) {
    let section = win.document.querySelector("#coachOpsDashboard");
    if (section) return section;
    section = win.document.createElement("section");
    section.id = "coachOpsDashboard";
    section.className = "coach-ops-dashboard admin-only";
    section.innerHTML = `<div class="section-heading coach-ops-heading"><div><p class="eyebrow">Coach control center</p><h2>Team operations</h2></div><button type="button" class="secondary-button" id="refreshCoachOps"><span>Refresh</span><i class="ph ph-arrow-clockwise"></i></button></div><div class="coach-attention-grid" id="coachAttentionGrid"></div><div class="coach-ops-columns"><article class="coach-ops-card"><div class="coach-card-head"><div><p class="eyebrow">Team status</p><h3>Season pulse</h3></div></div><div id="coachTeamStatus"></div></article><article class="coach-ops-card"><div class="coach-card-head"><div><p class="eyebrow">Needs attention</p><h3>Next actions</h3></div></div><div id="coachNeedsAttention"></div></article></div><div class="coach-ops-columns"><article class="coach-ops-card"><div class="coach-card-head"><div><p class="eyebrow">Recent activity</p><h3>Audit trail</h3></div></div><div id="coachAuditList"></div></article><article class="coach-ops-card"><div class="coach-card-head"><div><p class="eyebrow">Safety</p><h3>Undo last ladder change</h3></div></div><div id="coachUndoList"></div></article></div>`;
    const anchor = win.document.querySelector("#rankingsSection");
    anchor?.parentNode?.insertBefore(section, anchor);
    return section;
  }

  function attentionCard(icon, label, value, urgent) {
    return `<div class="coach-attention-card${urgent ? " is-urgent" : ""}"><i class="ph ${icon}" aria-hidden="true"></i><strong>${Number(value || 0)}</strong><span>${escapeHtml(label)}</span></div>`;
  }

  function actionName(action) {
    const map = {
      publish_import: "Published import", restore_import: "Restored import", sync_ladder_from_import: "Synced ladder",
      verify_challenge_match: "Approved challenge result", manual_rank_move: "Moved player rank", undo_ladder_change: "Undid ladder change",
      set_player_status: "Changed player status", create_challenge: "Created challenge", submit_match_score: "Submitted score",
    };
    return map[action] || clean(action).replaceAll("_", " ");
  }

  function renderCoachDashboard(win, data) {
    ensureCoachDashboard(win);
    const attention = data.needsAttention || {};
    const grid = win.document.querySelector("#coachAttentionGrid");
    if (grid) grid.innerHTML = attentionCard("ph-arrows-left-right", "Open challenges", attention.pendingChallenges, attention.pendingChallenges > 0)
      + attentionCard("ph-check-square", "Scores to approve", attention.pendingScores, attention.pendingScores > 0)
      + attentionCard("ph-warning", "Import warnings", attention.importWarnings, attention.importWarnings > 0)
      + attentionCard("ph-user-minus", "Players without accounts", attention.playersWithoutAccounts, attention.playersWithoutAccounts > 0);

    const status = data.teamStatus || {};
    const team = win.document.querySelector("#coachTeamStatus");
    if (team) {
      const upcoming = (status.nextChallenges || []).map(item => `<li><b>${escapeHtml(item.challenger)} vs ${escapeHtml(item.defender)}</b><span>${escapeHtml(formatDate(item.scheduledFor))}${item.courtLocation ? ` · ${escapeHtml(item.courtLocation)}` : ""}</span></li>`).join("");
      const recent = (status.recentMatches || []).map(item => `<li><b>${escapeHtml(item.winner)} won</b><span>${escapeHtml(item.score)} · ${escapeHtml(formatDate(item.verifiedAt))}</span></li>`).join("");
      team.innerHTML = `<div class="coach-status-row"><span>Active players</span><strong>${Number(status.activePlayers || 0)}</strong></div><div class="coach-status-row"><span>Latest import</span><strong>${status.latestImport ? `${Number(status.latestImport.rowCount || 0)} rows · ${escapeHtml(formatDate(status.latestImport.createdAt))}` : "None"}</strong></div><h4>Next scheduled challenges</h4><ul class="coach-compact-list">${upcoming || "<li><span>Nothing scheduled.</span></li>"}</ul><h4>Recent verified matches</h4><ul class="coach-compact-list">${recent || "<li><span>No verified challenge matches yet.</span></li>"}</ul>`;
    }

    const needs = win.document.querySelector("#coachNeedsAttention");
    if (needs) {
      const warnings = (data.importWarnings || []).map(item => `<li><i class="ph ph-warning"></i><span>${escapeHtml(item)}</span></li>`).join("");
      const missing = (data.missingAccounts || []).slice(0, 8).map(item => `<li><i class="ph ph-user-plus"></i><span><b>${escapeHtml(item.name)}</b> needs a player account.</span><button type="button" class="text-button" data-create-account="${escapeHtml(item.id)}">Create</button></li>`).join("");
      needs.innerHTML = `<ul class="coach-action-list">${warnings}${missing}${!warnings && !missing ? "<li><i class=\"ph ph-check-circle\"></i><span>Nothing needs attention right now.</span></li>" : ""}</ul>`;
    }

    const audit = win.document.querySelector("#coachAuditList");
    if (audit) audit.innerHTML = `<ul class="coach-audit-list">${(data.audit || []).slice(0, 12).map(event => `<li><span class="coach-audit-dot"></span><div><b>${escapeHtml(actionName(event.action))}</b><small>${escapeHtml(event.actor)} · ${escapeHtml(formatDate(event.createdAt))}</small>${event.reason ? `<p>${escapeHtml(event.reason)}</p>` : ""}${event.rankChanges?.length ? `<p>${event.rankChanges.slice(0,4).map(change => `${escapeHtml(change.player)} #${change.oldRank}→#${change.newRank}`).join(" · ")}</p>` : ""}</div></li>`).join("") || "<li><span>No coach activity yet.</span></li>"}</ul>`;

    const undo = win.document.querySelector("#coachUndoList");
    if (undo) undo.innerHTML = (data.undoCandidates || []).length
      ? (data.undoCandidates || []).map(item => `<div class="coach-undo-row"><div><b>${escapeHtml(item.teamGender === "girls" ? "Girls ladder" : "Boys ladder")}</b><span>${escapeHtml(item.reason === "challenge_verify" ? "Challenge result" : "Manual rank move")} · ${escapeHtml(formatDate(item.createdAt))}</span></div><button type="button" class="secondary-button" data-undo-snapshot="${escapeHtml(item.id)}">Undo</button></div>`).join("")
      : `<p class="coach-empty">No recent manual/challenge ladder change is safe to undo. Imported changes are restored from Import History instead.</p>`;
  }

  async function refreshCoachDashboard(win) {
    if (win.TennisRankAuth?.getProfile?.()?.role !== "admin") return;
    const data = await request(win, "/api/ladder?mode=coach", { method: "GET" });
    renderCoachDashboard(win, data);
    return data;
  }

  function ensureImportHistory(win) {
    let card = win.document.querySelector("#importHistoryCard");
    if (card) return card;
    card = win.document.createElement("div");
    card.id = "importHistoryCard";
    card.className = "import-history-card";
    card.innerHTML = `<div class="coach-card-head"><div><p class="eyebrow">Import history</p><h3>Rollback points</h3></div><button type="button" class="text-button" id="refreshImportHistory">Refresh</button></div><p class="helper-text">Every published spreadsheet is saved as a snapshot. Restore an earlier snapshot if a later upload is wrong.</p><div id="importHistoryList"></div>`;
    const target = win.document.querySelector("#settingsPanel .backend-row") || win.document.querySelector("#settingsPanel .format-guide");
    target?.parentNode?.insertBefore(card, target.nextSibling);
    return card;
  }

  async function refreshImportHistory(win) {
    if (win.TennisRankAuth?.getProfile?.()?.role !== "admin") return;
    ensureImportHistory(win);
    const payload = await request(win, "/api/records?mode=history", { method: "GET" });
    const list = win.document.querySelector("#importHistoryList");
    const snapshots = payload.snapshots || [];
    if (!list) return snapshots;
    list.innerHTML = snapshots.length ? snapshots.map((snapshot, index) => `<div class="import-history-row"><div><b>${escapeHtml(snapshot.source_label)}</b><span>${Number(snapshot.row_count || 0)} rows · ${escapeHtml(formatDate(snapshot.created_at))}${snapshot.restored_from_snapshot_id ? " · restored" : ""}</span></div>${index === 0 ? `<span class="history-current">Current</span>` : `<button type="button" class="secondary-button" data-restore-import="${escapeHtml(snapshot.id)}">Restore</button>`}</div>`).join("") : `<p class="coach-empty">No import history yet.</p>`;
    return snapshots;
  }

  async function restoreImport(win, snapshotId) {
    if (!win.confirm("Restore this import snapshot? The current import will remain in history so you can switch back if needed.")) return;
    const payload = await request(win, "/api/records", { method: "POST", body: JSON.stringify({ action: "restore", snapshotId }) });
    if (Array.isArray(payload.rows) && typeof win.loadRows === "function") win.loadRows(payload.rows, "backend");
    win.dispatchEvent?.(new CustomEvent("tennisrank:auth-ready", { detail: { profile: win.TennisRankAuth?.getProfile?.(), session: win.TennisRankAuth?.getSession?.() } }));
    await Promise.all([refreshImportHistory(win), refreshCoachDashboard(win), refreshRosterAccounts(win)]);
  }

  function randomPassword(win, length = 16) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    const bytes = new Uint32Array(length);
    win.crypto.getRandomValues(bytes);
    let value = "";
    for (let i = 0; i < length; i += 1) value += alphabet[bytes[i] % alphabet.length];
    return value;
  }

  function ensureRosterAccountTools(win) {
    const form = win.document.querySelector("#inviteForm");
    if (!form || form.dataset.coachOpsAccounts === "true") return;
    form.dataset.coachOpsAccounts = "true";
    const playerInput = win.document.querySelector("#invitePlayerName");
    const playerLabel = playerInput?.previousElementSibling;
    if (playerInput) playerInput.hidden = true;
    if (playerLabel?.tagName === "LABEL") playerLabel.hidden = true;
    const selectWrap = win.document.createElement("div");
    selectWrap.id = "inviteRosterWrap";
    selectWrap.innerHTML = `<label for="inviteRosterPlayer">Roster player</label><select id="inviteRosterPlayer"><option value="">Select imported player…</option></select>`;
    playerInput?.parentNode?.insertBefore(selectWrap, playerInput);
    const password = win.document.querySelector("#invitePassword");
    if (password?.parentElement && !win.document.querySelector("#generateInvitePassword")) {
      const button = win.document.createElement("button");
      button.type = "button";
      button.id = "generateInvitePassword";
      button.className = "text-button password-generator";
      button.textContent = "Generate secure temporary password";
      password.parentElement.appendChild(button);
      button.addEventListener("click", () => { password.value = randomPassword(win); password.focus(); password.select(); });
    }
    const matrix = win.document.createElement("div");
    matrix.id = "rosterAccountMatrix";
    matrix.className = "roster-account-matrix";
    win.document.querySelector("#accountList")?.parentNode?.insertBefore(matrix, win.document.querySelector("#accountList"));

    const role = win.document.querySelector("#inviteRole");
    const toggle = () => { if (selectWrap) selectWrap.hidden = role?.value === "admin"; };
    role?.addEventListener("change", toggle);
    toggle();

    form.addEventListener("submit", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const button = win.document.querySelector("#inviteButton");
      const status = win.document.querySelector("#inviteStatus");
      if (button) button.disabled = true;
      if (status) { status.textContent = "Creating account…"; status.classList.remove("error"); }
      try {
        const selected = win.document.querySelector("#inviteRosterPlayer");
        const payload = await request(win, "/api/users", {
          method: "POST",
          body: JSON.stringify({
            email: clean(win.document.querySelector("#inviteEmail")?.value),
            fullName: clean(win.document.querySelector("#inviteFullName")?.value),
            playerName: clean(playerInput?.value),
            playerId: role?.value === "player" ? clean(selected?.value) : "",
            role: role?.value || "player",
            temporaryPassword: String(password?.value || ""),
          }),
        });
        if (status) status.textContent = payload.linkWarning || "Account created and linked to the roster.";
        form.reset();
        if (playerInput) playerInput.value = "";
        toggle();
        await Promise.all([refreshRosterAccounts(win), refreshCoachDashboard(win)]);
      } catch (error) {
        if (status) { status.textContent = error.message; status.classList.add("error"); }
      } finally { if (button) button.disabled = false; }
    }, true);
  }

  async function refreshRosterAccounts(win) {
    if (win.TennisRankAuth?.getProfile?.()?.role !== "admin") return;
    ensureRosterAccountTools(win);
    const payload = await request(win, "/api/users", { method: "GET" });
    const roster = payload.roster || [];
    const select = win.document.querySelector("#inviteRosterPlayer");
    if (select) {
      const previous = select.value;
      select.innerHTML = `<option value="">Select imported player…</option>${roster.filter(player => player.active_status === "active" && !player.accountCreated).map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.display_name)} · ${escapeHtml(player.team_gender)} · ${escapeHtml(player.division)}</option>`).join("")}`;
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
      select.onchange = () => {
        const player = roster.find(item => item.id === select.value);
        const nameInput = win.document.querySelector("#invitePlayerName");
        const full = win.document.querySelector("#inviteFullName");
        if (player && nameInput) nameInput.value = player.display_name;
        if (player && full && !full.value) full.value = player.display_name;
      };
    }
    const matrix = win.document.querySelector("#rosterAccountMatrix");
    if (matrix) matrix.innerHTML = `<div class="roster-account-head"><strong>Imported roster</strong><span>${roster.filter(player => player.accountCreated).length}/${roster.length} accounts created</span></div><div class="roster-account-list">${roster.map(player => `<div class="roster-account-row"><div><b>${escapeHtml(player.display_name)}</b><span>${escapeHtml(player.team_gender)} · ${escapeHtml(player.division)}${player.grade_level ? ` · Grade ${player.grade_level}` : ""}</span></div><span class="account-state ${player.accountCreated ? "created" : "missing"}">${player.accountCreated ? "Account created" : "Not created"}</span>${!player.accountCreated && player.active_status === "active" ? `<button type="button" class="text-button" data-create-account="${escapeHtml(player.id)}">Create</button>` : ""}</div>`).join("")}</div>`;
    return roster;
  }

  function chooseRosterPlayer(win, playerId) {
    const select = win.document.querySelector("#inviteRosterPlayer");
    const form = win.document.querySelector("#inviteForm");
    if (!select || !form) return;
    select.value = playerId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    win.document.querySelector("#inviteEmail")?.focus();
  }

  function bindActions(win) {
    if (win.__tennisrankCoachOpsActions) return;
    win.__tennisrankCoachOpsActions = true;
    win.document.addEventListener("click", async event => {
      const refresh = event.target.closest?.("#refreshCoachOps");
      const historyRefresh = event.target.closest?.("#refreshImportHistory");
      const restore = event.target.closest?.("[data-restore-import]");
      const undo = event.target.closest?.("[data-undo-snapshot]");
      const create = event.target.closest?.("[data-create-account]");
      try {
        if (refresh) await refreshCoachDashboard(win);
        else if (historyRefresh) await refreshImportHistory(win);
        else if (restore) await restoreImport(win, restore.dataset.restoreImport);
        else if (create) chooseRosterPlayer(win, create.dataset.createAccount);
        else if (undo) {
          if (!win.confirm("Undo this latest ladder change? This creates an audit entry and is only allowed when no newer ladder change exists.")) return;
          await request(win, "/api/ladder?mode=coach", { method: "POST", body: JSON.stringify({ action: "undo-ladder", snapshotId: undo.dataset.undoSnapshot }) });
          win.dispatchEvent?.(new CustomEvent("tennisrank:auth-ready", { detail: { profile: win.TennisRankAuth?.getProfile?.(), session: win.TennisRankAuth?.getSession?.() } }));
          await refreshCoachDashboard(win);
        }
      } catch (error) {
        const status = win.document.querySelector("#statusMessage") || win.document.querySelector("#inviteStatus");
        if (status) { status.textContent = error.message; status.classList.add("error"); }
      }
    });
    win.addEventListener("tennisrank:coach-data-changed", () => Promise.allSettled([refreshCoachDashboard(win), refreshImportHistory(win), refreshRosterAccounts(win)]));
  }

  function initializeAdmin(win) {
    if (win.TennisRankAuth?.getProfile?.()?.role !== "admin") return;
    ensureCoachDashboard(win);
    ensureImportHistory(win);
    ensureRosterAccountTools(win);
    bindActions(win);
    Promise.allSettled([refreshCoachDashboard(win), refreshImportHistory(win), refreshRosterAccounts(win)]);
  }

  function installBrowser(win) {
    if (!win || win.__tennisrankCoachOpsInstalled) return false;
    win.__tennisrankCoachOpsInstalled = true;
    const install = () => {
      if (!installPublishGuard(win)) { win.setTimeout(install, 30); return; }
      bindActions(win);
      initializeAdmin(win);
    };
    win.addEventListener?.("tennisrank:auth-ready", event => {
      if (event?.detail?.profile?.role === "admin") win.setTimeout(() => initializeAdmin(win), 0);
    });
    win.setTimeout(install, 20);
    return true;
  }

  return {
    clean, identity, boardEntries, boardLabel, buildPreview, randomPassword, sourceLabel,
    installPublishGuard, previewAndPublish, refreshCoachDashboard, refreshImportHistory, refreshRosterAccounts, installBrowser,
  };
});
