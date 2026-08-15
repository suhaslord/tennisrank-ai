(() => {
  let activeCoachTab = "approvals";
  const pendingRankEdits = new Map();

  function restoreCoachState() {
    const consoleEl = document.querySelector("#coachLadderConsole");
    if (!consoleEl) return;
    const selected = consoleEl.querySelector(`[data-coach-tab="${activeCoachTab}"]`);
    if (selected) {
      consoleEl.querySelectorAll("[data-coach-tab]").forEach(button => {
        button.setAttribute("aria-selected", String(button === selected));
      });
      consoleEl.querySelectorAll("[data-coach-panel]").forEach(panel => {
        panel.hidden = panel.dataset.coachPanel !== activeCoachTab;
      });
    }

    pendingRankEdits.forEach((value, playerId) => {
      const row = consoleEl.querySelector(`[data-roster-player="${CSS.escape(playerId)}"]`);
      const input = row?.querySelector("[data-new-rank]");
      if (input && input.value !== value) input.value = value;
    });
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
    // The coach console can rerender after an unrelated async status update.
    // Resolve the value from the preserved edit at the action boundary so the
    // move handler cannot accidentally submit the freshly-rendered current rank.
    const preserved = pendingRankEdits.get(playerId);
    if (preserved !== undefined && input.value !== preserved) input.value = preserved;
    captureRankEdit(input);
  }

  window.TennisRankCoachState = {
    getPendingRank(playerId, fallback = "") {
      return pendingRankEdits.has(playerId) ? pendingRankEdits.get(playerId) : fallback;
    },
    clearPendingRank(playerId) {
      pendingRankEdits.delete(playerId);
    },
  };

  document.addEventListener("click", event => {
    const tab = event.target.closest?.("[data-coach-tab]");
    if (tab) activeCoachTab = tab.dataset.coachTab || "approvals";

    const move = event.target.closest?.("[data-move]");
    if (move) restoreRankBeforeMove(move);
  }, true);

  document.addEventListener("input", event => {
    const input = event.target.closest?.("[data-new-rank]");
    if (input) captureRankEdit(input);
  }, true);

  // change is included because some browser automation, accessibility tools,
  // and number-input interactions commit a value without a conventional input
  // event sequence.
  document.addEventListener("change", event => {
    const input = event.target.closest?.("[data-new-rank]");
    if (input) captureRankEdit(input);
  }, true);

  const observer = new MutationObserver(records => {
    if (!records.some(record => record.addedNodes.length || record.removedNodes.length)) return;
    restoreCoachState();
    requestAnimationFrame(restoreCoachState);
  });

  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    restoreCoachState();
  };

  window.addEventListener("tennisrank:ladder-workflow-ready", () => {
    restoreCoachState();
    requestAnimationFrame(restoreCoachState);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
