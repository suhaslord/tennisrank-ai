(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.TennisRankConnectedSheetGuard = api;
    if (root.document) api.schedule(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SHEET_URL_KEY = 'tennisRankSheetUrl';

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function staleError() {
    const error = new Error('This Sheet refresh was superseded by a newer data action. Nothing from the old refresh was published.');
    error.code = 'STALE_SHEET_REFRESH';
    return error;
  }

  function storedSheetUrl(win) {
    try { return clean(win.localStorage?.getItem?.(SHEET_URL_KEY)); }
    catch { return ''; }
  }

  function inputSheetUrl(win) {
    return clean(win.document?.querySelector?.('#sheetUrl')?.value);
  }

  function currentSheetUrl(win) {
    return inputSheetUrl(win) || storedSheetUrl(win);
  }

  function dependencies(win) {
    return {
      certainty: win.TennisRankImportCertainty,
      importer: win.TennisRankImportV2,
      runtime: win.TennisRankImportRuntime,
      ai: win.TennisRankSpreadsheetAI,
      auth: win.TennisRankAuth,
      XLSX: win.XLSX,
      bridge: win.TennisRankGoogleWorkbookBridge,
    };
  }

  function isFullWorkbookLink(win, input) {
    const deps = dependencies(win);
    return Boolean(
      deps.bridge?.isStandardGoogleSheet?.(input)
      || deps.certainty?.isStandardWorkbookLink?.(input)
    );
  }

  function workbookProxyUrl(win, input) {
    const deps = dependencies(win);
    if (deps.bridge?.isStandardGoogleSheet?.(input) && deps.bridge?.workbookProxyUrl) {
      return deps.bridge.workbookProxyUrl(input);
    }
    return deps.certainty?.workbookProxyUrl?.(input) || `/api/sheet-workbook?url=${encodeURIComponent(String(input || '').trim())}`;
  }

  async function verifiedRows(win, input) {
    const deps = dependencies(win);
    const certainty = deps.certainty;
    if (!certainty?.interpretText || !certainty?.interpretWorkbookBuffer || !certainty?.publishRows || !deps.importer || !deps.runtime) {
      throw new Error('Spreadsheet intelligence is still loading. Try again in a moment.');
    }

    if (isFullWorkbookLink(win, input)) {
      const response = await win.fetch(workbookProxyUrl(win, input), { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `The Google Sheet could not be loaded (${response.status}).`);
      }
      const buffer = await response.arrayBuffer();
      return certainty.interpretWorkbookBuffer(buffer, { ...deps, source: 'sheet' });
    }

    if (!deps.importer.googleCsvProxyUrl) throw new Error('Google Sheet support is still loading.');
    const response = await win.fetch(deps.importer.googleCsvProxyUrl(input), { cache: 'no-store' });
    const text = await response.text();
    if (!response.ok) {
      let message = `The Google Sheet could not be loaded (${response.status}).`;
      try { message = JSON.parse(text).error || message; } catch {}
      throw new Error(message);
    }
    return certainty.interpretText(text, {
      importer: deps.importer,
      runtime: deps.runtime,
      ai: deps.ai,
      auth: deps.auth,
      source: 'sheet',
      sourceName: 'Google Sheet tennis data',
    });
  }

  async function publishVerifiedRows(win, rows) {
    const deps = dependencies(win);
    if (!Array.isArray(rows) || !rows.length) throw new Error('No verified Sheet rows are ready to publish.');
    if (typeof win.loadRows !== 'function') throw new Error('The TennisRank importer is not ready yet.');

    // Bind the preview to these exact verified rows. Do not rely on whichever
    // syncToBackend wrapper happened to win the startup race.
    win.loadRows(rows, 'sheet');
    deps.certainty?.renderMeter?.(win, rows);
    win.TennisRankCoachPreviewGuard?.repair?.();

    if (win.TennisRankCoachOps?.previewAndPublish) {
      await win.TennisRankCoachOps.previewAndPublish(win, rows);
    } else if (typeof win.syncToBackend === 'function') {
      await win.syncToBackend(rows);
    } else {
      throw new Error('The coach import preview is still loading. Try again in a moment.');
    }

    if (typeof win.startRefresh === 'function') win.startRefresh();
    win.__tennisRankLastCertaintyRows = rows;
    return rows;
  }

  function createController(win) {
    let epoch = 0;
    let inFlight = null;

    const invalidate = () => { epoch += 1; };

    const stillCurrent = (capturedEpoch, input) => {
      if (capturedEpoch !== epoch) return false;
      const stored = storedSheetUrl(win);
      return Boolean(stored && stored === input);
    };

    const refresh = async () => {
      if (inFlight) return inFlight;
      const input = currentSheetUrl(win);
      if (!input) throw new Error('Paste a Google Sheet link first.');
      const capturedEpoch = epoch;

      inFlight = (async () => {
        const rows = await verifiedRows(win, input);
        if (!stillCurrent(capturedEpoch, input)) throw staleError();
        if (!stillCurrent(capturedEpoch, input)) throw staleError();
        return publishVerifiedRows(win, rows);
      })();

      try { return await inFlight; }
      finally { inFlight = null; }
    };

    return { refresh, invalidate, stillCurrent, inFlight: () => inFlight, epoch: () => epoch };
  }

  function runRefresh(win, controller, button, successMessage) {
    win.setBusy?.(button, true);
    win.setStatus?.('Checking the connected Google Sheet…');
    win.TennisRankCoachPreviewGuard?.repair?.();
    controller.refresh().then(() => {
      win.setStatus?.(successMessage || 'Connected Sheet verified and saved.');
    }).catch(error => {
      if (error?.code !== 'STALE_SHEET_REFRESH' && error?.code !== 'IMPORT_CANCELLED') {
        win.setStatus?.(error?.message || 'Connected Sheet refresh failed.', true);
      }
    }).finally(() => win.setBusy?.(button, false));
  }

  function install(win) {
    if (!win?.document) return false;
    const deps = dependencies(win);
    if (!deps.certainty?.publishRows || !deps.importer || !deps.runtime) return false;

    if (!win.__tennisrankConnectedSheetGuardController) {
      win.__tennisrankConnectedSheetGuardController = createController(win);
    }
    const controller = win.__tennisrankConnectedSheetGuardController;

    if (!win.fetchSheet?.__connectedSheetGuard) {
      const guardedFetch = async function guardedConnectedSheetRefresh() {
        return controller.refresh();
      };
      guardedFetch.__connectedSheetGuard = true;
      win.fetchSheet = guardedFetch;
    }

    if (!win.__tennisrankConnectedSheetGuardEvents) {
      win.__tennisrankConnectedSheetGuardEvents = true;
      // Window capture runs before the legacy document listeners. This makes one
      // code path authoritative for Sheet connect/refresh and prevents duplicate
      // fetch/publish races.
      win.addEventListener('click', event => {
        const target = event.target?.closest?.('#connectSheet, #useCsv, #refreshNow');
        if (!target) return;

        if (target.id === 'useCsv') {
          controller.invalidate();
          return;
        }

        if (target.id === 'connectSheet') {
          const input = inputSheetUrl(win);
          controller.invalidate();
          if (!input) return;
          try { win.localStorage?.setItem?.(SHEET_URL_KEY, input); } catch {}
          event.preventDefault();
          event.stopImmediatePropagation();
          runRefresh(win, controller, target, 'Google Sheet verified and saved.');
          return;
        }

        if (target.id === 'refreshNow' && storedSheetUrl(win)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          runRefresh(win, controller, target, 'Connected Sheet refreshed.');
        }
      }, true);

      win.addEventListener('change', event => {
        if (event.target?.id === 'csvFile' || event.target?.id === 'refreshRate') controller.invalidate();
      }, true);
    }

    return true;
  }

  function schedule(win) {
    const apply = () => install(win);
    apply();
    if (win.document?.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', apply, { once: true });
    win.addEventListener?.('tennisrank:auth-ready', apply);
    for (const delay of [50, 150, 300, 600, 1200, 2500]) win.setTimeout?.(apply, delay);
  }

  return {
    clean,
    staleError,
    storedSheetUrl,
    inputSheetUrl,
    currentSheetUrl,
    dependencies,
    isFullWorkbookLink,
    workbookProxyUrl,
    verifiedRows,
    publishVerifiedRows,
    createController,
    install,
    schedule,
  };
});
