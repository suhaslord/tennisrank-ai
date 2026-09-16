(function (win) {
  'use strict';
  if (!win || !win.document) return;

  const SNAPSHOT_KEY = 'tennisRankDataSnapshotV1';
  const IMPORT_SOURCES = new Set(['csv', 'file', 'sheet']);
  let activePreviewPromise = null;
  let latestImportRows = null;
  let latestImportSource = '';

  function savedRows() {
    try {
      const snapshot = JSON.parse(win.localStorage.getItem(SNAPSHOT_KEY) || 'null');
      return Array.isArray(snapshot?.rows) && snapshot.rows.length ? snapshot.rows : null;
    } catch {
      return null;
    }
  }

  function rememberFreshRows(rows, source) {
    const normalizedSource = String(source || '').trim().toLowerCase();
    if (IMPORT_SOURCES.has(normalizedSource) && Array.isArray(rows) && rows.length) {
      latestImportRows = rows;
      latestImportSource = normalizedSource;
      return;
    }
    if (normalizedSource === 'backend' || normalizedSource === 'empty') {
      latestImportRows = null;
      latestImportSource = '';
    }
  }

  function installFreshRowTracker() {
    if (typeof win.loadRows !== 'function') return false;
    if (win.loadRows.__coachPreviewFreshRows) return true;
    const baseLoad = win.loadRows;
    const trackedLoad = function coachPreviewFreshRows(rows, source) {
      rememberFreshRows(rows, source);
      return baseLoad.apply(this, arguments);
    };
    trackedLoad.__coachPreviewFreshRows = true;
    trackedLoad.__baseLoadRows = baseLoad;
    win.loadRows = trackedLoad;
    return true;
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
        latestImportRows = null;
        latestImportSource = '';
      }
    };
    wrapped.__settlingAware = true;
    wrapped.__basePreviewAndPublish = basePreview;
    api.previewAndPublish = wrapped;
    return true;
  }

  function repair() {
    installFreshRowTracker();
    const api = win.TennisRankCoachOps;
    if (!api?.previewAndPublish || typeof win.syncToBackend !== 'function') return false;
    installSettlingAwarePreview(api);
    if (win.syncToBackend.__coachOpsPreviewFinal) return true;

    const base = win.syncToBackend;
    const guarded = function (rows) {
      // Always bind a preview to the exact rows that were loaded immediately
      // before the save. This avoids stale local-storage snapshots and also makes
      // the guard independent of the order in which other runtime wrappers install.
      const explicit = Array.isArray(rows) && rows.length ? rows : null;
      const fresh = latestImportRows && IMPORT_SOURCES.has(latestImportSource) ? latestImportRows : null;
      return api.previewAndPublish(win, explicit || fresh || undefined);
    };
    guarded.__coachOpsPreview = true;
    guarded.__coachOpsPreviewFinal = true;
    guarded.__baseSync = base;
    win.syncToBackend = guarded;
    return true;
  }

  function scheduleRepairs() {
    for (const delay of [0, 25, 75, 200, 500, 1200, 2500, 5000]) win.setTimeout(repair, delay);
  }

  win.addEventListener?.('tennisrank:auth-ready', event => {
    if (event?.detail?.profile?.role === 'admin') scheduleRepairs();
  });
  win.addEventListener?.('tennisrank:coach-data-changed', repair);
  win.addEventListener?.('DOMContentLoaded', scheduleRepairs, { once: true });
  scheduleRepairs();

  win.TennisRankCoachPreviewGuard = {
    repair,
    scheduleRepairs,
    savedRows,
    rememberFreshRows,
    installFreshRowTracker,
    installSettlingAwarePreview,
  };
})(typeof window !== 'undefined' ? window : globalThis);
