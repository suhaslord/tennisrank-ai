const assert = require('node:assert/strict');
const autoSync = require('../import-auto-sync.js');

function fakeEvent(name, init = {}) {
  this.type = name;
  this.detail = init.detail;
}

function jsonResponse(ok, payload) {
  return {
    ok,
    async json() { return payload; },
  };
}

async function testRankingExtraction() {
  const teams = autoSync.rankingsToTeams([
    { name: '  Noah   Williams ', gender: 'boys', division: 'singles' },
    { name: 'Ethan Kim', gender: 'Boys', division: 'Singles' },
    { name: 'noah williams', gender: 'BOYS', division: 'SINGLES' },
    { name: 'Liam Chen & Oliver Davis', gender: 'boys', division: 'doubles' },
    { name: 'Ava Patel', gender: 'girls', division: 'singles' },
    { name: 'Mia Rodriguez', gender: 'Girls', division: 'Singles' },
    { name: '', gender: 'girls', division: 'singles' },
    { name: 'Unknown', gender: 'unknown', division: 'singles' },
  ]);

  assert.deepEqual(teams.boys, [
    { name: 'Noah Williams' },
    { name: 'Ethan Kim' },
  ]);
  assert.deepEqual(teams.girls, [
    { name: 'Ava Patel' },
    { name: 'Mia Rodriguez' },
  ]);
}

async function testNonAdminDoesNotMutateLadder() {
  let fetchCalls = 0;
  const win = {
    TennisRankAuth: {
      getProfile: () => ({ role: 'player' }),
      fetch: async () => { fetchCalls += 1; return jsonResponse(true, {}); },
    },
  };
  const result = await autoSync.syncOfficialBoards(win, [{ name: 'A' }]);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'not-admin');
  assert.equal(fetchCalls, 0);
}

async function testCoachUiPathUsesCurrentRankingOrder() {
  const invoked = [];
  let directApiCalls = 0;
  const buttons = {
    boys: { onclick: async () => { invoked.push('boys'); } },
    girls: { onclick: async () => { invoked.push('girls'); } },
  };
  const rows = [{ id: 1 }, { id: 2 }];
  const win = {
    CustomEvent: fakeEvent,
    document: {
      querySelector(selector) {
        if (selector.includes('boys')) return buttons.boys;
        if (selector.includes('girls')) return buttons.girls;
        return null;
      },
    },
    TennisRankAuth: {
      getProfile: () => ({ role: 'admin', id: 'coach' }),
      getSession: () => ({ access_token: 'test' }),
      fetch: async () => { directApiCalls += 1; return jsonResponse(true, {}); },
    },
    calculateRankings(receivedRows) {
      assert.equal(receivedRows, rows);
      return {
        rankings: [
          { name: 'Boys #1', gender: 'boys', division: 'singles' },
          { name: 'Boys #2', gender: 'boys', division: 'singles' },
          { name: 'Girls #1', gender: 'girls', division: 'singles' },
          { name: 'Doubles ignored', gender: 'girls', division: 'doubles' },
        ],
      };
    },
    dispatched: [],
    dispatchEvent(event) { this.dispatched.push(event); },
  };

  const result = await autoSync.syncOfficialBoards(win, rows);
  assert.deepEqual(invoked, ['boys', 'girls']);
  assert.equal(directApiCalls, 0);
  assert.deepEqual(result.teams.boys, [{ name: 'Boys #1' }, { name: 'Boys #2' }]);
  assert.deepEqual(result.teams.girls, [{ name: 'Girls #1' }]);
  assert.equal(win.dispatched.some(event => event.type === 'tennisrank:import-synced'), true);
  assert.equal(win.dispatched.some(event => event.type === 'tennisrank:auth-ready'), false);
}

async function testApiFallbackAndImmediateWorkflowRefresh() {
  const requests = [];
  const events = [];
  const profile = { role: 'admin', id: 'coach' };
  const session = { access_token: 'token' };
  const win = {
    CustomEvent: fakeEvent,
    document: { querySelector: () => null },
    TennisRankAuth: {
      getProfile: () => profile,
      getSession: () => session,
      async fetch(path, options) {
        requests.push({ path, body: JSON.parse(options.body) });
        return jsonResponse(true, { seeded: options.body.length });
      },
    },
    calculateRankings: () => ({
      rankings: [
        { name: 'B One', gender: 'boys', division: 'singles' },
        { name: 'B Two', gender: 'boys', division: 'singles' },
        { name: 'G One', gender: 'girls', division: 'singles' },
      ],
    }),
    dispatchEvent(event) { events.push(event); },
  };

  await autoSync.syncOfficialBoards(win, [{ source: 'csv' }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].path, '/api/admin/seed-ladder');
  assert.deepEqual(requests[0].body, {
    teamGender: 'boys',
    players: [{ name: 'B One' }, { name: 'B Two' }],
  });
  assert.deepEqual(requests[1].body, {
    teamGender: 'girls',
    players: [{ name: 'G One' }],
  });

  const authReady = events.find(event => event.type === 'tennisrank:auth-ready');
  const importSynced = events.find(event => event.type === 'tennisrank:import-synced');
  assert.ok(authReady, 'fallback API sync should trigger existing workflow refresh hook');
  assert.equal(authReady.detail.profile, profile);
  assert.equal(authReady.detail.session, session);
  assert.ok(importSynced, 'import completion event should be emitted');
}

async function testPublishHookUsesMostRecentlyLoadedRows() {
  const calls = [];
  const buttonCalls = [];
  const rows = [{ sourceRow: 1 }, { sourceRow: 2 }];
  const buttons = {
    boys: { onclick: async () => { buttonCalls.push('boys'); } },
    girls: { onclick: async () => { buttonCalls.push('girls'); } },
  };
  const win = {
    CustomEvent: fakeEvent,
    __events: [],
    setTimeout(callback) { callback(); return 1; },
    dispatchEvent(event) { this.__events.push(event); },
    document: {
      querySelector(selector) {
        if (selector.includes('boys')) return buttons.boys;
        if (selector.includes('girls')) return buttons.girls;
        return null;
      },
    },
    TennisRankAuth: {
      getProfile: () => ({ role: 'admin' }),
      getSession: () => ({ access_token: 'token' }),
      fetch: async () => jsonResponse(true, {}),
    },
    calculateRankings(received) {
      assert.equal(received, rows, 'official board must be calculated from the just-loaded file rows');
      return {
        rankings: [
          { name: 'Imported Boy', gender: 'boys', division: 'singles' },
          { name: 'Imported Girl', gender: 'girls', division: 'singles' },
        ],
      };
    },
    loadRows(loaded, source) {
      calls.push({ type: 'load', loaded, source });
      return 'rendered';
    },
    async syncToBackend(explicitRows) {
      calls.push({ type: 'save', explicitRows });
      return { saved: true };
    },
  };

  autoSync.installBrowser(win);
  assert.equal(win.loadRows(rows, 'file'), 'rendered');
  const result = await win.syncToBackend();

  assert.deepEqual(result, { saved: true });
  assert.equal(calls[0].type, 'load');
  assert.equal(calls[1].type, 'save');
  assert.equal(calls[1].explicitRows, undefined, 'real importer calls sync without explicitly re-passing rows');
  assert.deepEqual(buttonCalls, ['boys', 'girls']);
  assert.equal(win.__events.some(event => event.type === 'tennisrank:import-synced'), true);
}

async function testExplicitRowsAlsoSync() {
  const posted = [];
  const rows = [{ sourceRow: 7 }];
  const win = {
    CustomEvent: fakeEvent,
    setTimeout(callback) { callback(); return 1; },
    dispatchEvent() {},
    document: { querySelector: () => null },
    TennisRankAuth: {
      getProfile: () => ({ role: 'admin' }),
      getSession: () => ({}),
      async fetch(path, options) {
        posted.push({ path, body: JSON.parse(options.body) });
        return jsonResponse(true, {});
      },
    },
    calculateRankings(received) {
      assert.equal(received, rows);
      return { rankings: [{ name: 'Explicit Player', gender: 'boys', division: 'singles' }] };
    },
    loadRows() {},
    async syncToBackend(explicitRows) {
      assert.equal(explicitRows, rows);
      return { saved: rows.length };
    },
  };

  autoSync.installBrowser(win);
  await win.syncToBackend(rows);
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].body.players, [{ name: 'Explicit Player' }]);
}

async function testBoardFailureIsNotSilentlyReportedAsSuccess() {
  const rows = [{ sourceRow: 1 }];
  let rawSaveCompleted = false;
  const win = {
    CustomEvent: fakeEvent,
    setTimeout(callback) { callback(); return 1; },
    dispatchEvent() {},
    document: { querySelector: () => null },
    TennisRankAuth: {
      getProfile: () => ({ role: 'admin' }),
      getSession: () => ({}),
      async fetch() { return jsonResponse(false, { error: 'ladder RPC failed' }); },
    },
    calculateRankings: () => ({ rankings: [{ name: 'Player', gender: 'boys', division: 'singles' }] }),
    loadRows() {},
    async syncToBackend() { rawSaveCompleted = true; return { saved: true }; },
  };

  autoSync.installBrowser(win);
  win.loadRows(rows, 'csv');
  await assert.rejects(
    () => win.syncToBackend(),
    error => {
      assert.equal(error.code, 'OFFICIAL_LADDER_SYNC_FAILED');
      assert.match(error.message, /official ladder refresh failed/i);
      assert.match(error.message, /ladder RPC failed/i);
      return true;
    },
  );
  assert.equal(rawSaveCompleted, true, 'raw records save should have happened before board sync failed');
}

(async () => {
  await testRankingExtraction();
  await testNonAdminDoesNotMutateLadder();
  await testCoachUiPathUsesCurrentRankingOrder();
  await testApiFallbackAndImmediateWorkflowRefresh();
  await testPublishHookUsesMostRecentlyLoadedRows();
  await testExplicitRowsAlsoSync();
  await testBoardFailureIsNotSilentlyReportedAsSuccess();
  console.log('import auto-sync tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
