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
