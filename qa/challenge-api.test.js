const assert = require('node:assert/strict');
const challenges = require('../api/challenges.js');

function futureIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

{
  const duplicate = futureIso(2);
  const values = challenges.normalizeProposedTimes([duplicate, futureIso(3), duplicate]);
  assert.equal(values.length, 2, 'duplicate challenge options are deduplicated');
}

assert.throws(
  () => challenges.normalizeProposedTimes(['not-a-date']),
  error => error.status === 400 && /invalid/i.test(error.message),
  'invalid proposed dates must be a client error',
);

assert.throws(
  () => challenges.normalizeProposedTimes([new Date(Date.now() - 60_000).toISOString()]),
  error => error.status === 400 && /future/i.test(error.message),
  'past challenge options must be rejected server-side',
);

assert.throws(
  () => challenges.normalizeProposedTimes([futureIso(challenges.MAX_SCHEDULE_DAYS + 1)]),
  error => error.status === 400 && /within/i.test(error.message),
  'challenge options cannot be placed beyond the scheduling horizon',
);

assert.throws(
  () => challenges.normalizeScheduledFor('', true),
  error => error.status === 400 && /required/i.test(error.message),
  'schedule action requires a time before reaching the RPC',
);

assert.throws(
  () => challenges.normalizeScheduledFor(new Date(Date.now() - 60_000).toISOString(), true),
  error => error.status === 400 && /future/i.test(error.message),
  'past scheduled matches are rejected server-side',
);

assert.throws(
  () => challenges.normalizeScheduledFor(futureIso(challenges.MAX_SCHEDULE_DAYS + 1), true),
  error => error.status === 400 && /within/i.test(error.message),
  'scheduled matches cannot bypass the same 90-day horizon as challenge proposals',
);

assert.equal(challenges.normalizeScheduledFor(null, false), null, 'accept/decline may omit a scheduled time');
assert.equal(challenges.normalizeCourtLocation('  Court 3  '), 'Court 3', 'court names are trimmed');
assert.throws(
  () => challenges.normalizeCourtLocation('x'.repeat(challenges.MAX_COURT_LOCATION_LENGTH + 1)),
  error => error.status === 400 && /too long/i.test(error.message),
  'oversized court/location input is rejected before database mutation',
);

console.log('Challenge API validation suite passed: future-time horizon, required scheduling, deduplication, and location bounds.');

async function historyScenario({ role = 'player', linked = true, side = 'challenger_id' }, check) {
  const previousFetch = global.fetch;
  const environment = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previousEnv = environment.map(key => process.env[key]);
  process.env[environment[0]] = 'https://challenge.example.test';
  process.env[environment[1]] = 'service-test';
  const target = { id: 'target-player', profile_id: 'viewer', display_name: 'Target Player' };
  const players = [target, { id: 'other-a' }, { id: 'other-b' }];
  const oldChallenge = { id: 'target-challenge', challenger_id: 'other-a', defender_id: 'other-b', status: 'scheduled', [side]: target.id };
  const rows = [...Array.from({ length: 100 }, (_, index) => ({ id: `newer-${index}`, challenger_id: 'other-a', defender_id: 'other-b', status: 'completed' })), oldChallenge];
  const state = { challengeQueries: [], rpcCalls: 0 };
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const reply = payload => ({ ok: true, status: 200, json: async () => payload });
    if (url.pathname === '/auth/v1/user') return reply({ id: 'viewer' });
    if (url.pathname === '/rest/v1/profiles') return reply([{ id: 'viewer', role, full_name: 'Unlinked Person' }]);
    if (url.pathname === '/rest/v1/players') {
      if (url.searchParams.has('profile_id')) return reply(linked ? [target] : []);
      return reply(players);
    }
    if (url.pathname === '/rest/v1/challenges') {
      state.challengeQueries.push(url);
      const filter = url.searchParams.get('or');
      const selected = filter ? rows.filter(row => filter.includes(`challenger_id.eq.${row.challenger_id}`) || filter.includes(`defender_id.eq.${row.defender_id}`)) : rows;
      return reply(selected.slice(0, Number(url.searchParams.get('limit'))));
    }
    if (url.pathname === '/rest/v1/challenge_matches') {
      return reply(url.searchParams.get('challenge_id').includes(oldChallenge.id) ? [{ id: 'target-match', challenge_id: oldChallenge.id }] : []);
    }
    if (url.pathname === '/rest/v1/rpc/submit_ladder_match') { state.rpcCalls += 1; return reply('match-id'); }
    throw new Error(`Unexpected mock request: ${init.method || 'GET'} ${url.pathname}`);
  };
  const invoke = async (handler, body) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, setHeader() { return this; }, send(value) { this.body = JSON.parse(value); return this; } };
    await handler({ method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer test-token' }, body }, res);
    return res;
  };
  try { await check({ state, invoke }); }
  finally {
    global.fetch = previousFetch;
    environment.forEach((key, index) => { if (previousEnv[index] === undefined) delete process.env[key]; else process.env[key] = previousEnv[index]; });
  }
}

(async () => {
  for (const side of ['challenger_id', 'defender_id']) {
    await historyScenario({ side }, async ({ state, invoke }) => {
      const response = await invoke(challenges);
      assert.equal(response.code, 200);
      assert.equal(response.body.challenges.length, 1, `the player's older ${side} challenge survives 100 newer unrelated records`);
      assert.equal(response.body.challenges[0].id, 'target-challenge');
      assert.equal(response.body.challenges[0].match.id, 'target-match');
      assert.equal(response.body.challenges[0].isOpen, true);
      assert.equal(state.challengeQueries[0].searchParams.get('limit'), '100');
    });
  }
  await historyScenario({ role: 'admin' }, async ({ state, invoke }) => {
    const response = await invoke(challenges);
    assert.equal(response.body.challenges.length, 100, 'coach history remains team-wide and bounded');
    assert.equal(state.challengeQueries[0].searchParams.has('or'), false);
  });
  await historyScenario({ linked: false }, async ({ state, invoke }) => {
    const response = await invoke(challenges);
    assert.deepEqual(response.body.challenges, []);
    assert.equal(state.challengeQueries.length, 0, 'an unlinked account never queries team challenge history');
  });
  await historyScenario({}, async ({ state, invoke }) => {
    const submit = require('../api/match-score');
    for (const count of [6, 1000]) {
      const response = await invoke(submit, { challengeId: 'target-challenge', winnerPlayerId: 'target-player', scoreSummary: Array(count).fill('6-0').join(', ') });
      assert.equal(response.code, 400);
      assert.match(response.body.error, /more than 5 sets/);
    }
    assert.equal(state.rpcCalls, 0, 'invalid match lengths never reach the score-submission transaction');
    const response = await invoke(submit, { challengeId: 'target-challenge', winnerPlayerId: 'target-player', scoreSummary: '6-4, 4-6, 10-8' });
    assert.equal(response.code, 201);
    assert.equal(state.rpcCalls, 1, 'a valid match tiebreak still reaches score submission');
  });
  console.log('Challenge history and score-boundary regressions passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
