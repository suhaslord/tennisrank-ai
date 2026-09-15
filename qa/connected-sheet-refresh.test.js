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
  let fetchSheetCalls = 0;
  let syncCalls = 0;

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
    async fetchSheet() { fetchSheetCalls += 1; },
    async syncToBackend() { syncCalls += 1; return { saved: true }; },
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
    fetchSheetCalls: () => fetchSheetCalls,
    syncCalls: () => syncCalls,
    setProfile(next) { profile = next; },
  };
}

async function main() {
  {
    const fixture = fakeWindow({ sheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit#gid=0' });
    const controller = autoSync.installConnectedSheetRefresh(fixture.win);

    assert.ok(controller, 'refresh controller should install in the browser');
    assert.equal(fixture.sheet.value, 'https://docs.google.com/spreadsheets/d/test/edit#gid=0');
    assert.equal(fixture.win.localStorage.getItem('tennisRankSheetUrl'), 'https://docs.google.com/spreadsheets/d/test/edit#gid=0');
    assert.equal(fixture.intervals.size, 1, 'connected Sheet should own the recurring refresh');
    assert.equal([...fixture.intervals.values()][0].milliseconds, 60000);
    assert.ok(fixture.nativeStarts() >= 1, 'native backend timer should be cleared before Sheet polling starts');
  }

  {
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
  }

  {
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
  }

  {
    const fixture = fakeWindow({ sheetUrl: 'https://docs.google.com/spreadsheets/d/certainty/edit', refreshRate: '15' });
    fixture.win.__tennisRankCertaintyGateInstalled = true;
    fixture.win.TennisRankImportCertainty = { publishRows() {} };
    autoSync.installConnectedSheetRefresh(fixture.win);
    const timer = [...fixture.intervals.values()][0];
    assert.ok(timer, 'certainty-gated Sheet should still receive a refresh timer');
    await timer.callback();
    assert.equal(fixture.fetchSheetCalls(), 1, 'automatic refresh should fetch the Sheet once');
    assert.equal(fixture.syncCalls(), 0, 'certainty-gated fetch already publishes and must not trigger a second save');
  }

  {
    const fixture = fakeWindow({ sheetUrl: 'https://docs.google.com/spreadsheets/d/legacy/edit', refreshRate: '15' });
    autoSync.installConnectedSheetRefresh(fixture.win);
    const timer = [...fixture.intervals.values()][0];
    await timer.callback();
    assert.equal(fixture.fetchSheetCalls(), 1);
    assert.equal(fixture.syncCalls(), 1, 'legacy fetch-only flow still needs the explicit backend save');
  }

  {
    const fixture = fakeWindow({ sheetUrl: 'https://docs.google.com/spreadsheets/d/slow/edit', refreshRate: '15' });
    let calls = 0;
    let releaseFirst;
    fixture.win.fetchSheet = () => {
      calls += 1;
      if (calls === 1) return new Promise(resolve => { releaseFirst = resolve; });
      return Promise.resolve();
    };
    const controller = autoSync.installConnectedSheetRefresh(fixture.win);
    const timer = [...fixture.intervals.values()][0];
    const first = timer.callback();
    const second = timer.callback();
    await Promise.resolve();
    assert.equal(calls, 1, 'a second timer tick must not start another Sheet fetch while one is in flight');
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal(fixture.syncCalls(), 1, 'overlapping timer ticks must collapse to one publish');
    await timer.callback();
    assert.equal(calls, 2, 'a later tick should run after the previous refresh is finished');
    assert.equal(fixture.syncCalls(), 2);
    assert.ok(controller);
  }

  {
    const fixture = fakeWindow({ sheetUrl: 'https://docs.google.com/spreadsheets/d/stale/edit', refreshRate: '15' });
    let releaseFetch;
    let calls = 0;
    fixture.win.fetchSheet = () => {
      calls += 1;
      return new Promise(resolve => { releaseFetch = resolve; });
    };
    const controller = autoSync.installConnectedSheetRefresh(fixture.win);
    const timer = [...fixture.intervals.values()][0];
    const oldTick = timer.callback();
    await Promise.resolve();
    assert.equal(calls, 1);

    controller.disconnect();
    releaseFetch();
    await oldTick;
    assert.equal(fixture.syncCalls(), 0, 'a refresh that finishes after disconnect must never publish stale Sheet data');
    assert.equal(fixture.win.localStorage.getItem('tennisRankSheetUrl'), null);
    assert.equal(fixture.intervals.size, 0);
  }

  console.log('Connected Sheet refresh regression tests passed, including overlap and stale-generation protection.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
