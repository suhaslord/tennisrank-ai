const assert = require('node:assert/strict');
const guard = require('../connected-sheet-guard.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function fakeWindow({ url = 'https://docs.google.com/spreadsheets/d/team/edit#gid=0' } = {}) {
  const parseGate = deferred();
  let fetchCalls = 0;
  let publishCalls = 0;
  const input = { value: url };
  const win = {
    document: {
      querySelector(selector) {
        if (selector === '#sheetUrl') return input;
        return null;
      },
    },
    localStorage: storage({ tennisRankSheetUrl: url }),
    fetch: async () => {
      fetchCalls += 1;
      return { ok: true, async text() { return 'Name,Opponent,Result\nA,B,W'; } };
    },
    TennisRankImportV2: { googleCsvProxyUrl: value => `/proxy?url=${encodeURIComponent(value)}` },
    TennisRankImportRuntime: {},
    TennisRankSpreadsheetAI: {},
    TennisRankAuth: {},
    TennisRankImportCertainty: {
      isStandardWorkbookLink: () => false,
      async interpretText() { return parseGate.promise; },
      async interpretWorkbookBuffer() { throw new Error('not used'); },
      async publishRows(_win, rows) { publishCalls += 1; return rows; },
    },
  };
  return { win, input, parseGate, fetchCalls: () => fetchCalls, publishCalls: () => publishCalls };
}

async function main() {
  {
    const fixture = fakeWindow();
    const controller = guard.createController(fixture.win);
    const first = controller.refresh();
    const second = controller.refresh();
    await Promise.resolve();
    assert.equal(fixture.fetchCalls(), 1, 'concurrent refresh requests should share one network/parse operation');
    fixture.parseGate.resolve([{ name: 'A' }]);
    await Promise.all([first, second]);
    assert.equal(fixture.publishCalls(), 1, 'collapsed refreshes should publish once');
  }

  {
    const fixture = fakeWindow();
    const controller = guard.createController(fixture.win);
    const work = controller.refresh();
    await Promise.resolve();
    controller.invalidate();
    fixture.parseGate.resolve([{ name: 'Old A' }]);
    await assert.rejects(work, error => error?.code === 'STALE_SHEET_REFRESH');
    assert.equal(fixture.publishCalls(), 0, 'an invalidated refresh must be stopped before publishRows can mutate the board');
  }

  {
    const fixture = fakeWindow();
    const controller = guard.createController(fixture.win);
    const work = controller.refresh();
    await Promise.resolve();
    fixture.win.localStorage.setItem('tennisRankSheetUrl', 'https://docs.google.com/spreadsheets/d/new/edit');
    fixture.input.value = 'https://docs.google.com/spreadsheets/d/new/edit';
    fixture.parseGate.resolve([{ name: 'Old A' }]);
    await assert.rejects(work, error => error?.code === 'STALE_SHEET_REFRESH');
    assert.equal(fixture.publishCalls(), 0, 'an old Sheet response must not publish after the connected source changes');
  }

  console.log('Connected Sheet publication guard tests passed: overlap, invalidation, and source-switch staleness.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
