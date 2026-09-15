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

const partnerRows = [
  {
    name: 'Noah Williams',
    partner: 'Ethan Kim',
    opponent: 'Liam Chen',
    opponentPartner: 'Jack Park',
    result: 'W',
    score: '6-3',
    gender: 'Boys',
    date: '2026-09-15',
  },
  {
    name: 'Ethan Kim',
    partner: 'Noah Williams',
    opponent: 'Jack Park',
    opponentPartner: 'Liam Chen',
    result: 'W',
    score: '6-3',
    gender: 'Boys',
    date: '2026-09-15',
  },
];
compat.normalizeRows(partnerRows);
assert.equal(partnerRows.length, 1, 'reciprocal one-row-per-partner entries for the same dated score must count once');
assert.equal(partnerRows[0].winner, 'Ethan Kim & Noah Williams');
assert.equal(partnerRows[0].loser, 'Jack Park & Liam Chen');
assert.equal(partnerRows[0].division, 'Doubles');

const mixedPartner = {
  name: 'Olivia Brown',
  partner: 'Ravi Shah',
  opponent: 'Sophia Lee',
  opponentPartner: 'Ben Kim',
  result: 'W',
  score: '7-5',
  gender: 'F',
  partnerGender: 'M',
  date: '2026-09-15',
};
compat.normalizeRow(mixedPartner);
assert.equal(mixedPartner.winner, 'Olivia Brown & Ravi Shah');
assert.equal(mixedPartner.loser, 'Ben Kim & Sophia Lee');
assert.equal(mixedPartner.division, 'Doubles');
assert.equal(mixedPartner.gender, 'Mixed');

const explicitMixedPartner = {
  name: 'Olivia Brown',
  partner: 'Ravi Shah',
  opponent: 'Sophia Lee',
  opponentPartner: 'Ben Kim',
  result: 'W',
  division: 'MXD',
};
compat.normalizeRow(explicitMixedPartner);
assert.equal(explicitMixedPartner.gender, 'Mixed');
assert.equal(explicitMixedPartner.division, 'Doubles');

const splitWinnerColumns = {
  winner1: 'Maya Patel',
  winner2: 'Zoe Kim',
  loser1: 'Emma Lee',
  loser2: 'Ava Shah',
  score: '6-4',
  gender: 'Girls',
};
compat.normalizeRow(splitWinnerColumns);
assert.equal(splitWinnerColumns.winner, 'Maya Patel & Zoe Kim');
assert.equal(splitWinnerColumns.loser, 'Ava Shah & Emma Lee');
assert.equal(splitWinnerColumns.division, 'Doubles');

const sidePartnerColumns = {
  player1: 'Noah Williams',
  partner1: 'Ethan Kim',
  player2: 'Liam Chen',
  partner2: 'Jack Park',
  winner: 'Player 1',
  score: '6-2',
  gender: 'Boys',
};
compat.normalizeRow(sidePartnerColumns);
assert.equal(sidePartnerColumns.player1, 'Ethan Kim & Noah Williams');
assert.equal(sidePartnerColumns.player2, 'Jack Park & Liam Chen');
assert.equal(sidePartnerColumns.division, 'Doubles');

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

const importerWindow = {
  TennisRankImportV2: {
    parseText() {
      return [{
        name: 'Noah Williams',
        partner: 'Ethan Kim',
        opponent: 'Liam Chen',
        opponentpartner: 'Jack Park',
        result: 'W',
        score: '6-3',
        gender: 'Boys',
        date: '2026-09-15',
      }];
    },
  },
};
assert.equal(compat.installBrowser(importerWindow), true);
const interpreted = importerWindow.TennisRankImportV2.parseText('ignored');
assert.equal(interpreted[0].winner, 'Ethan Kim & Noah Williams');
assert.equal(interpreted[0].loser, 'Jack Park & Liam Chen');
assert.equal(interpreted[0].division, 'Doubles');

console.log('Named-result and doubles partner compatibility regression passed.');
