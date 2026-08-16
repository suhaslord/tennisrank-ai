(() => {
  let activeCoachTab = "approvals";
  let rosterRefreshing = false;
  const pendingRankEdits = new Map();
  const pendingStatusEdits = new Map();
  const originalAlert = typeof window.alert === "function" ? window.alert.bind(window) : null;

  function setRosterRefreshing(value) {
    rosterRefreshing = Boolean(value);
    const consoleEl = document.querySelector("#coachLadderConsole");
    if (!consoleEl) return;
    consoleEl.setAttribute("aria-busy", String(rosterRefreshing));
    consoleEl.querySelectorAll("[data-new-rank], [data-move]").forEach(control => {
      control.disabled = rosterRefreshing;
    });
  }

  function showToast(message, tone = "error") {
    const appShell = document.querySelector("#appShell");
    if (!appShell || appShell.hidden) {
      if (originalAlert) originalAlert(message);
      return;
    }
    let region = document.querySelector("#tennisrankWorkflowToast");
    if (!region) {
      region = document.createElement("div");
      region.id = "tennisrankWorkflowToast";
      region.className = "workflow-toast";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "assertive");
      region.setAttribute("aria-atomic", "true");
      document.body.appendChild(region);
    }
    region.classList.toggle("error", tone === "error");
    region.textContent = String(message || "Something went wrong.");
    region.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { region.hidden = true; }, 5200);
  }

  window.alert = message => showToast(message, "error");

  function restoreCoachState() {
    const consoleEl = document.querySelector("#coachLadderConsole");
    if (!consoleEl) return;
    const selected = consoleEl.querySelector(`[data-coach-tab="${activeCoachTab}"]`);
    if (selected) {
      consoleEl.querySelectorAll("[data-coach-tab]").forEach(button => {
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(button === selected));
        button.tabIndex = button === selected ? 0 : -1;
      });
      consoleEl.querySelectorAll("[data-coach-panel]").forEach(panel => {
        panel.setAttribute("role", "tabpanel");
        panel.hidden = panel.dataset.coachPanel !== activeCoachTab;
      });
    }

    consoleEl.querySelectorAll("[data-roster-player]").forEach(row => {
      const playerId = row.dataset.rosterPlayer;
      const select = row.querySelector("[data-status]");
      // A freshly rendered roster row is authoritative server state. Capture it
      // before the user changes the control so a failed mutation can always roll
      // back correctly, including programmatic/mobile select changes that do not
      // produce a focus event first.
      if (select && playerId && !pendingStatusEdits.has(playerId)) {
        select.dataset.confirmedValue = select.value;
      }
    });

    pendingRankEdits.forEach((value, playerId) => {
      const row = consoleEl.querySelector(`[data-roster-player="${CSS.escape(playerId)}"]`);
      const input = row?.querySelector("[data-new-rank]");
      if (input && input.value !== value) input.value = value;
    });
    setRosterRefreshing(rosterRefreshing);
  }

  function captureRankEdit(input) {
    if (!input) return;
    const row = input.closest("[data-roster-player]");
    if (!row?.dataset.rosterPlayer) return;
    pendingRankEdits.set(row.dataset.rosterPlayer, input.value);
  }

  function restoreRankBeforeMove(button) {
    const row = button?.closest("[data-roster-player]");
    const playerId = row?.dataset.rosterPlayer;
    const input = row?.querySelector("[data-new-rank]");
    if (!playerId || !input) return;
    const preserved = pendingRankEdits.get(playerId);
    if (preserved !== undefined && input.value !== preserved) input.value = preserved;
    captureRankEdit(input);
  }

  function validateRankMove(button) {
    const row = button?.closest("[data-roster-player]");
    const input = row?.querySelector("[data-new-rank]");
    if (!row || !input) return true;
    const value = Number(input.value);
    const team = row.querySelector(".coach-roster-meta")?.textContent?.split("·")[0]?.trim().toLowerCase();
    const sameTeamRows = [...document.querySelectorAll("[data-roster-player]")].filter(candidate => {
      const candidateTeam = candidate.querySelector(".coach-roster-meta")?.textContent?.split("·")[0]?.trim().toLowerCase();
      return !team || candidateTeam === team;
    });
    const maxRank = Math.max(1, sameTeamRows.length);
    if (!Number.isInteger(value) || value < 1 || value > maxRank) {
      input.setAttribute("aria-invalid", "true");
      input.focus();
      showToast(`Enter a whole-number rank from 1 to ${maxRank}.`);
      return false;
    }
    input.removeAttribute("aria-invalid");
    return true;
  }

  function rememberStatusBeforeChange(select) {
    if (!select) return;
    const row = select.closest("[data-roster-player]");
    const playerId = row?.dataset.rosterPlayer;
    if (!playerId) return;
    const previous = select.dataset.confirmedValue || "active";
    pendingStatusEdits.set(playerId, {
      previous,
      next: select.value,
    });
  }

  function resolveStatusMutation(playerId, ok) {
    const pending = pendingStatusEdits.get(playerId);
    pendingStatusEdits.delete(playerId);
    if (!pending) return;
    const row = document.querySelector(`[data-roster-player="${CSS.escape(playerId)}"]`);
    const select = row?.querySelector("[data-status]");
    if (select) {
      const resolved = ok ? pending.next : pending.previous;
      select.value = resolved;
      select.dataset.confirmedValue = resolved;
      select.disabled = false;
      if (!ok) select.setAttribute("aria-invalid", "true");
      else select.removeAttribute("aria-invalid");
    }
    if (!ok) setRosterRefreshing(false);
  }

  function localDateTimeMinimum() {
    const date = new Date(Date.now() + 5 * 60 * 1000);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
    return local.toISOString().slice(0, 16);
  }

  function setFormError(form, message, focusTarget) {
    const status = form?.querySelector("#challengeFormStatus");
    if (status) {
      status.textContent = message;
      status.classList.add("error");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "assertive");
    }
    form?.removeAttribute("aria-busy");
    form?.removeAttribute("data-submit-locked");
    const submit = form?.querySelector('button[type="submit"]');
    if (submit) submit.disabled = false;
    if (focusTarget?.focus) focusTarget.focus();
  }

  function lockForm(form) {
    if (!form || form.dataset.submitLocked === "true") return false;
    form.dataset.submitLocked = "true";
    form.setAttribute("aria-busy", "true");
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    return true;
  }

  function validateWorkflowForm(form) {
    const now = Date.now();
    if (form.id === "challengeCreateForm") {
      const inputs = [...form.querySelectorAll('input[type="datetime-local"]')];
      const raw = inputs.map(input => input.value).filter(Boolean);
      const parsed = raw.map(value => new Date(value).getTime());
      if (parsed.some(value => !Number.isFinite(value) || value <= now)) {
        setFormError(form, "Challenge times must be in the future.", inputs.find(input => input.value && new Date(input.value).getTime() <= now));
        return false;
      }
      if (new Set(parsed).size !== parsed.length) {
        setFormError(form, "Use different times for each challenge option.", inputs[1] || inputs[0]);
        return false;
      }
    }
    if (form.id === "challengeScheduleForm") {
      const input = form.querySelector('input[name="scheduledFor"]');
      const time = new Date(input?.value || "").getTime();
      if (!Number.isFinite(time) || time <= now) {
        setFormError(form, "Scheduled time must be in the future.", input);
        return false;
      }
    }
    if (form.id === "challengeScoreForm") {
      const score = form.querySelector('[name="scoreSummary"]');
      const engine = window.TennisRankLadderEngine;
      const validated = engine?.validateWinnerScore?.(score?.value || "");
      if (validated && !validated.valid) {
        setFormError(form, validated.error, score);
        return false;
      }
    }
    return true;
  }

  function hardenDialogForms() {
    document.querySelectorAll("#challengeDialog .challenge-form").forEach(form => {
      form.querySelectorAll('input[type="datetime-local"]').forEach(input => {
        if (!input.min) input.min = localDateTimeMinimum();
      });
      const court = form.querySelector('input[name="courtLocation"]');
      if (court && !court.maxLength) court.maxLength = 160;
      const status = form.querySelector("#challengeFormStatus");
      if (status) {
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.setAttribute("aria-atomic", "true");
      }
    });
  }

  function installFetchGuard() {
    const auth = window.TennisRankAuth;
    if (!auth?.fetch || auth.fetch.__coachRankGuard) return;
    const baseFetch = auth.fetch.bind(auth);
    const guardedFetch = async (path, options = {}) => {
      let nextOptions = options;
      let movedPlayerId = "";
      let statusPlayerId = "";
      try {
        if (String(path) === "/api/admin/ladder" && String(options.method || "GET").toUpperCase() === "PATCH" && options.body) {
          const body = typeof options.body === "string" ? JSON.parse(options.body) : { ...options.body };
          if (body.action === "move" && body.playerId && pendingRankEdits.has(body.playerId)) {
            const preserved = Number(pendingRankEdits.get(body.playerId));
            if (Number.isInteger(preserved) && preserved > 0) {
              body.newRank = preserved;
              movedPlayerId = body.playerId;
              nextOptions = { ...options, body: JSON.stringify(body) };
            }
          }
          if (body.action === "status" && body.playerId) statusPlayerId = body.playerId;
        }
      } catch {
        // Leave malformed/non-JSON requests untouched; the API owns validation.
      }

      try {
        const response = await baseFetch(path, nextOptions);
        if (response?.ok && movedPlayerId) pendingRankEdits.delete(movedPlayerId);
        if (statusPlayerId) resolveStatusMutation(statusPlayerId, Boolean(response?.ok));
        return response;
      } catch (error) {
        if (statusPlayerId) resolveStatusMutation(statusPlayerId, false);
        throw error;
      }
    };
    guardedFetch.__coachRankGuard = true;
    guardedFetch.__baseFetch = baseFetch;
    auth.fetch = guardedFetch;
  }

  window.TennisRankCoachState = {
    getPendingRank(playerId, fallback = "") {
      return pendingRankEdits.has(playerId) ? pendingRankEdits.get(playerId) : fallback;
    },
    clearPendingRank(playerId) {
      pendingRankEdits.delete(playerId);
    },
    isRefreshing() {
      return rosterRefreshing;
    },
  };

  document.addEventListener("click", event => {
    const tab = event.target.closest?.("[data-coach-tab]");
    if (tab) activeCoachTab = tab.dataset.coachTab || "approvals";

    const move = event.target.closest?.("[data-move]");
    if (move) {
      restoreRankBeforeMove(move);
      if (!validateRankMove(move)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
  }, true);

  document.addEventListener("keydown", event => {
    const tab = event.target.closest?.("[data-coach-tab]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...tab.closest("[role='tablist']")?.querySelectorAll("[data-coach-tab]") || []];
    if (!tabs.length) return;
    const index = tabs.indexOf(tab);
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    event.preventDefault();
    tabs[next].click();
    tabs[next].focus();
  }, true);

  document.addEventListener("submit", event => {
    const form = event.target.closest?.("#challengeCreateForm, #challengeScheduleForm, #challengeScoreForm");
    if (!form) return;
    if (form.dataset.submitLocked === "true") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!validateWorkflowForm(form)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    lockForm(form);
  }, true);

  document.addEventListener("input", event => {
    const input = event.target.closest?.("[data-new-rank]");
    if (input) captureRankEdit(input);
  }, true);

  document.addEventListener("focusin", event => {
    const select = event.target.closest?.("[data-status]");
    if (select && !select.dataset.confirmedValue) select.dataset.confirmedValue = select.value;
  }, true);

  document.addEventListener("change", event => {
    const input = event.target.closest?.("[data-new-rank]");
    if (input) captureRankEdit(input);

    const statusSelect = event.target.closest?.("[data-status]");
    if (statusSelect) {
      rememberStatusBeforeChange(statusSelect);
      statusSelect.disabled = true;
      setRosterRefreshing(true);
    }
  }, true);

  const observer = new MutationObserver(records => {
    hardenDialogForms();
    const formStatusChanged = records.some(record => {
      const target = record.target?.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
      return target?.closest?.(".challenge-form-status.error");
    });
    if (formStatusChanged) {
      document.querySelectorAll("#challengeDialog .challenge-form[data-submit-locked='true']").forEach(form => {
        if (form.querySelector(".challenge-form-status.error")) {
          form.removeAttribute("data-submit-locked");
          form.removeAttribute("aria-busy");
          const submit = form.querySelector('button[type="submit"]');
          if (submit) submit.disabled = false;
        }
      });
    }
    if (!records.some(record => record.addedNodes?.length || record.removedNodes?.length)) return;
    restoreCoachState();
    requestAnimationFrame(restoreCoachState);
  });

  const start = () => {
    installFetchGuard();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    hardenDialogForms();
    restoreCoachState();
  };

  window.addEventListener("tennisrank:auth-ready", installFetchGuard);
  window.addEventListener("tennisrank:ladder-workflow-ready", () => {
    installFetchGuard();
    rosterRefreshing = false;
    restoreCoachState();
    requestAnimationFrame(() => {
      rosterRefreshing = false;
      restoreCoachState();
    });
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
