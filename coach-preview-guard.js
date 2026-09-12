(function (win) {
  'use strict';
  if (!win || !win.document) return;

  const SNAPSHOT_KEY = 'tennisRankDataSnapshotV1';

  function savedRows() {
    try {
      const snapshot = JSON.parse(win.localStorage.getItem(SNAPSHOT_KEY) || 'null');
      return Array.isArray(snapshot?.rows) && snapshot.rows.length ? snapshot.rows : null;
    } catch {
      return null;
    }
  }

  function repair() {
    const api = win.TennisRankCoachOps;
    if (!api?.previewAndPublish || typeof win.syncToBackend !== 'function') return false;
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

  win.TennisRankCoachPreviewGuard = { repair, scheduleRepairs, savedRows };
})(typeof window !== 'undefined' ? window : globalThis);
