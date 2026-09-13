(function (win) {
  'use strict';
  if (!win || !win.document) return;

  const SNAPSHOT_KEY = 'tennisRankDataSnapshotV1';
  let activePreviewPromise = null;

  function savedRows() {
    try {
      const snapshot = JSON.parse(win.localStorage.getItem(SNAPSHOT_KEY) || 'null');
      return Array.isArray(snapshot?.rows) && snapshot.rows.length ? snapshot.rows : null;
    } catch {
      return null;
    }
  }

  function installSettlingAwarePreview(api) {
    if (!api?.previewAndPublish || api.previewAndPublish.__settlingAware) return Boolean(api?.previewAndPublish);
    const basePreview = api.previewAndPublish.bind(api);
    const wrapped = async function (targetWin, rows) {
      const target = targetWin?.document ? targetWin : win;
      if (activePreviewPromise) {
        const modal = target.document?.querySelector('#importPreviewModal');
        if (modal && !modal.hidden) {
          throw new Error('Finish or cancel the current import before starting another one.');
        }
        try { await activePreviewPromise; } catch (_) {}
      }

      const task = Promise.resolve().then(() => basePreview(target, rows));
      activePreviewPromise = task;
      try {
        return await task;
      } finally {
        if (activePreviewPromise === task) activePreviewPromise = null;
      }
    };
    wrapped.__settlingAware = true;
    wrapped.__basePreviewAndPublish = basePreview;
    api.previewAndPublish = wrapped;
    return true;
  }

  function repair() {
    const api = win.TennisRankCoachOps;
    if (!api?.previewAndPublish || typeof win.syncToBackend !== 'function') return false;
    installSettlingAwarePreview(api);
    if (win.syncToBackend.__coachOpsPreviewFinal) return true;

    const base = win.syncToBackend;
    const guarded = function (rows) {
      const candidate = Array.isArray(rows) && rows.length ? rows : savedRows();
      return api.previewAndPublish(win, candidate);
    };
    guarded.__coachOpsPreview = true;
    guarded.__coachOpsPreviewFinal = true;
    guarded.__baseSync = base;
    win.syncToBackend = guarded;
    return true;
  }

  function scheduleRepairs() {
    for (const delay of [0, 25, 75, 200, 500, 1200, 2500]) win.setTimeout(repair, delay);
  }

  win.addEventListener?.('tennisrank:auth-ready', event => {
    if (event?.detail?.profile?.role === 'admin') scheduleRepairs();
  });
  win.addEventListener?.('DOMContentLoaded', scheduleRepairs, { once: true });
  scheduleRepairs();

  win.TennisRankCoachPreviewGuard = { repair, scheduleRepairs, savedRows, installSettlingAwarePreview };
})(typeof window !== 'undefined' ? window : globalThis);
