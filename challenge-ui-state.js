(() => {
  let activeCoachTab = "approvals";

  function restoreCoachTab() {
    const consoleEl = document.querySelector("#coachLadderConsole");
    if (!consoleEl) return;
    const selected = consoleEl.querySelector(`[data-coach-tab="${activeCoachTab}"]`);
    if (!selected) return;

    consoleEl.querySelectorAll("[data-coach-tab]").forEach(button => {
      button.setAttribute("aria-selected", String(button === selected));
    });
    consoleEl.querySelectorAll("[data-coach-panel]").forEach(panel => {
      panel.hidden = panel.dataset.coachPanel !== activeCoachTab;
    });
  }

  document.addEventListener("click", event => {
    const tab = event.target.closest?.("[data-coach-tab]");
    if (!tab) return;
    activeCoachTab = tab.dataset.coachTab || "approvals";
  }, true);

  const observer = new MutationObserver(records => {
    if (!records.some(record => record.addedNodes.length || record.removedNodes.length)) return;
    requestAnimationFrame(restoreCoachTab);
  });

  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    restoreCoachTab();
  };

  window.addEventListener("tennisrank:ladder-workflow-ready", () => requestAnimationFrame(restoreCoachTab));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
