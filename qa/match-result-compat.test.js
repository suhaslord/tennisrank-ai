const assert = require('node:assert/strict');
const compat = require('../match-result-compat.js');

const rows = [
  { name: 'a', opponent: 'b', result: 'a', score: '6-1', gender: 'Boys', division: 'Singles' },
  { name: 'a', opponent: 'c', result: 'c', score: '6-2', gender: 'Boys', division: 'Singles' },
  { name: 'b', opponent: 'c', result: 'b', score: '6-3', gender: 'Boys', division: 'Singles' },
];
compat.normalizeRows(rows);
assert.deepEqual(
  rows.map(row => ({ winner: row.winner, loser: row.loser })),
  [
    { winner: 'a', loser: 'b' },
    { winner: 'c', loser: 'a' },
    { winner: 'b', loser: 'c' },
  ],
  'a Result/Won cell containing the actual player name must become a complete winner/loser match',
);

const invalid = [
  { name: 'x', opponent: 'y', result: 'a', score: '6-4', gender: 'Girls', division: 'Singles' },
  { name: 'x', opponent: 'z', result: 'c', score: '6-4', gender: 'Girls', division: 'Singles' },
  { name: 'y', opponent: 'z', result: 'b', score: '7-6', gender: 'Girls', division: 'Singles' },
];
compat.normalizeRows(invalid);
assert.equal(invalid.some(row => row.winner || row.loser), false, 'mismatched result names must stay unresolved instead of being guessed');

let received;
const fakeWindow = {
  loadRows(incoming) {
    received = incoming;
    return 'ok';
  },
};
assert.equal(compat.installBrowser(fakeWindow), true);
const persistedShape = [{ name: 'a', opponent: 'b', result: 'a', score: '6-1', gender: 'Boys', division: 'Singles' }];
assert.equal(fakeWindow.loadRows(persistedShape, 'backend'), 'ok');
assert.equal(received[0].winner, 'a');
assert.equal(received[0].loser, 'b');

console.log('Named-result compatibility regression passed.');
