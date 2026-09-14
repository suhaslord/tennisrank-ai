const assert = require('node:assert/strict');
const autoSync = require('../import-auto-sync.js');

function element(value = '') {
  const listeners = new Map();
  return {
    value,
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    },
    dispatch(name) {
      for (const handler of listeners.get(name) || []) handler({ target: this });
    },
  };
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function fakeWindow({ sheetUrl = '', role = 'admin', refreshRate = '60' } = {}) {
  const refresh = element(refreshRate);
  const sheet = element('');
  const windowListeners = new Map();
  const intervals = new Map();
  let nextInterval = 1;
  let profile = role ? { role } : null;
  let nativeStarts = 0;

  const win = {
    document: {
      querySelector(selector) {
        if (selector === '#refreshRate') return refresh;
        if (selector === '#sheetUrl') return sheet;
        return null;
      },
    },
    localStorage: storage({
      ...(sheetUrl ? { tennisRankSheetUrl: sheetUrl } : {}),
      tennisRankRefreshRate: refreshRate,
    }),
    TennisRankAuth: {
      getProfile: () => profile,
      getSession: () => ({}),
      async fetch() { return { ok: true, async json() { return {}; } }; },
    },
    calculateRankings: () => ({ rankings: [] }),
    startRefresh() { nativeStarts += 1; },
    async fetchSheet() {},
    async syncToBackend() { return { saved: true }; },
    loadRows() { return 'loaded'; },
    setInterval(callback, milliseconds) {
      const id = nextInterval++;
      intervals.set(id, { callback, milliseconds });
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback) { callback(); return 1; },
    addEventListener(name, handler) {
      if (!windowListeners.has(name)) windowListeners.set(name, []);
      windowListeners.get(name).push(handler);
    },
    dispatch(name, detail) {
      for (const handler of windowListeners.get(name) || []) handler({ type: name, detail });
    },
  };

  return {
    win,
    refresh,
    sheet,
    intervals,
    nativeStarts: () => nativeStarts,
    setProfile(next) { profile = next; },
  };
}

(function restoresConnectedSheetAfterAdminSignIn() {
  const fixture = fakeWindow({ sheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit#gid=0' });
  const controller = autoSync.installConnectedSheetRefresh(fixture.win);

  assert.ok(controller, 'refresh controller should install in the browser');
  assert.equal(fixture.sheet.value, 'https://docs.google.com/spreadsheets/d/test/edit#gid=0');
  assert.equal(fixture.win.localStorage.getItem('tennisRankSheetUrl'), 'https://docs.google.com/spreadsheets/d/test/edit#gid=0');
  assert.equal(fixture.intervals.size, 1, 'connected Sheet should own the recurring refresh');
  assert.equal([...fixture.intervals.values()][0].milliseconds, 60000);
  assert.ok(fixture.nativeStarts() >= 1, 'native backend timer should be cleared before Sheet polling starts');
})();

(function survivesAppInitializationClearingStoredUrl() {
  const fixture = fakeWindow({ sheetUrl: 'https://docs.google.com/spreadsheets/d/persist/edit', role: null });
  const controller = autoSync.installConnectedSheetRefresh(fixture.win);
  assert.ok(controller);

  fixture.win.localStorage.removeItem('tennisRankSheetUrl');
  fixture.sheet.value = '';
  fixture.setProfile({ role: 'admin' });
  fixture.win.dispatch('tennisrank:auth-ready', { profile: { role: 'admin' } });

  assert.equal(fixture.win.localStorage.getItem('tennisRankSheetUrl'), 'https://docs.google.com/spreadsheets/d/persist/edit');
  assert.equal(fixture.sheet.value, 'https://docs.google.com/spreadsheets/d/persist/edit');
  assert.equal(fixture.intervals.size, 1);
})();

(function csvSourceSwitchStopsOldSheetTimer() {
  const fixture = fakeWindow({ sheetUrl: 'https://docs.google.com/spreadsheets/d/old/edit' });
  fixture.win.loadRows = function loadRows(rows, source) {
    if (source === 'csv') fixture.win.localStorage.removeItem('tennisRankSheetUrl');
    return rows.length;
  };

  autoSync.installBrowser(fixture.win);
  assert.equal(fixture.intervals.size, 1, 'Sheet polling should begin for the remembered coach source');

  const result = fixture.win.loadRows([{ name: 'New CSV Player' }], 'csv');
  assert.equal(result, 1);
  assert.equal(fixture.win.localStorage.getItem('tennisRankSheetUrl'), null);
  assert.equal(fixture.intervals.size, 0, 'CSV import must stop the previous Sheet timer');
})();

console.log('Connected Sheet refresh regression tests passed.');
