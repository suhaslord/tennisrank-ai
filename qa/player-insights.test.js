const assert = require('node:assert/strict');
const insights = require('../player-insights');

const trend = insights.deriveRankTrend([
  { old_rank: 7, new_rank: 5, reason: 'import_sync', changed_at: '2026-08-01T00:00:00Z' },
  { old_rank: 5, new_rank: 3, reason: 'challenge_result', changed_at: '2026-08-10T00:00:00Z' },
  { old_rank: 3, new_rank: 4, reason: 'coach_move', changed_at: '2026-08-12T00:00:00Z' },
], 4);
assert.equal(trend.seasonStartRank, 7);
assert.equal(trend.currentRank, 4);
assert.equal(trend.bestRank, 3);
assert.equal(trend.movement, 3);
assert.deepEqual(trend.points.map(x => x.rank), [7, 5, 3, 4]);

const form = insights.deriveRecentForm([
  { winner: 'Aiden Brooks', loser: 'Mateo Rivera', date: '2026-08-10', score: '6-4' },
  { winner: 'Ethan Cole', loser: 'Aiden Brooks', date: '2026-08-11', score: '7-5' },
  { winner: 'Aiden Brooks & Noah Patel', loser: 'Team X', date: '2026-08-12', score: '8-5' },
], 'Aiden Brooks');
assert.equal(form.wins, 2);
assert.equal(form.losses, 1);
assert.deepEqual(form.last.map(x => x.result), ['W', 'L', 'W']);
assert.equal(insights.reasonLabel('challenge_result'), 'Challenge result');
assert.match(insights.chartMarkup(trend.points), /Official rank history/);
console.log('player insights tests passed');
