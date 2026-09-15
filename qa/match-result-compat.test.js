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

const ambiguousNames = { player1: 'Joanne Lee', player2: 'Ann', winner: 'Ann', gender: 'Girls', division: 'Singles' };
compat.normalizeRow(ambiguousNames);
assert.equal(ambiguousNames.winner, 'Ann', 'exact side matching must beat substring overlap');
assert.equal(ambiguousNames.loser, 'Joanne Lee');

const partnerRows = [
  {
    name: 'Noah Williams', partner: 'Ethan Kim', opponent: 'Liam Chen', opponentPartner: 'Jack Park',
    result: 'W', score: '6-3', gender: 'Boys', date: '2026-09-15',
  },
  {
    name: 'Ethan Kim', partner: 'Noah Williams', opponent: 'Jack Park', opponentPartner: 'Liam Chen',
    result: 'W', score: '6-3', gender: 'Boys', date: '2026-09-15',
  },
];
compat.normalizeRows(partnerRows);
assert.equal(partnerRows.length, 1, 'reciprocal one-row-per-partner entries for the same dated score must count once');
assert.equal(partnerRows[0].winner, 'Ethan Kim & Noah Williams');
assert.equal(partnerRows[0].loser, 'Jack Park & Liam Chen');
assert.equal(partnerRows[0].division, 'Doubles');
assert.equal(compat.isCompletePartnerLayout(partnerRows), true);

const mixedPartner = {
  name: 'Olivia Brown', partner: 'Ravi Shah', opponent: 'Sophia Lee', opponentPartner: 'Ben Kim',
  result: 'W', score: '7-5', gender: 'F', partnerGender: 'M', date: '2026-09-15',
};
compat.normalizeRow(mixedPartner);
assert.equal(mixedPartner.winner, 'Olivia Brown & Ravi Shah');
assert.equal(mixedPartner.loser, 'Ben Kim & Sophia Lee');
assert.equal(mixedPartner.division, 'Doubles');
assert.equal(mixedPartner.gender, 'Mixed');

const explicitMixedPartner = {
  name: 'Olivia Brown', partner: 'Ravi Shah', opponent: 'Sophia Lee', opponentPartner: 'Ben Kim',
  result: 'W', division: 'MXD',
};
compat.normalizeRow(explicitMixedPartner);
assert.equal(explicitMixedPartner.gender, 'Mixed');
assert.equal(explicitMixedPartner.division, 'Doubles');

const splitWinnerColumns = {
  winner1: 'Maya Patel', winner2: 'Zoe Kim', loser1: 'Emma Lee', loser2: 'Ava Shah', score: '6-4', gender: 'Girls',
};
compat.normalizeRow(splitWinnerColumns);
assert.equal(splitWinnerColumns.winner, 'Maya Patel & Zoe Kim');
assert.equal(splitWinnerColumns.loser, 'Ava Shah & Emma Lee');
assert.equal(splitWinnerColumns.division, 'Doubles');

const sidePartnerColumns = {
  player1: 'Noah Williams', partner1: 'Ethan Kim', player2: 'Liam Chen', partner2: 'Jack Park',
  winner: 'Player 1', score: '6-2', gender: 'Boys',
};
compat.normalizeRow(sidePartnerColumns);
assert.equal(sidePartnerColumns.player1, 'Ethan Kim & Noah Williams');
assert.equal(sidePartnerColumns.player2, 'Jack Park & Liam Chen');
assert.equal(sidePartnerColumns.winner, 'Ethan Kim & Noah Williams');
assert.equal(sidePartnerColumns.loser, 'Jack Park & Liam Chen');
assert.equal(sidePartnerColumns.division, 'Doubles');

assert.equal(compat.pairGender('M', 'M'), 'boys');
assert.equal(compat.pairGender('F', 'F'), 'girls');
assert.equal(compat.pairGender('M', 'F'), 'mixed');

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
        name: 'Noah Williams', partner: 'Ethan Kim', opponent: 'Liam Chen', opponentpartner: 'Jack Park',
        result: 'W', score: '6-3', gender: 'Boys', date: '2026-09-15',
      }];
    },
  },
};
assert.equal(compat.installBrowser(importerWindow), true);
const interpreted = importerWindow.TennisRankImportV2.parseText('ignored');
assert.equal(interpreted[0].winner, 'Ethan Kim & Noah Williams');
assert.equal(interpreted[0].loser, 'Jack Park & Liam Chen');
assert.equal(interpreted[0].division, 'Doubles');

const droppingImporterWindow = {
  TennisRankImportV2: {
    parseDelimited() {
      return { matrix: [
        ['Player 1', 'Partner 1', 'Player 2', 'Partner 2', 'Winner', 'Score', 'Gender'],
        ['Noah Williams', 'Ethan Kim', 'Liam Chen', 'Jack Park', 'Player 1', '6-2', 'Boys'],
      ] };
    },
    detectHeaderRow() { return { index: 0 }; },
    parseText() {
      return [{ __sourceRow: 2, player1: 'Noah Williams', player2: 'Liam Chen', winner: 'Player 1', score: '6-2', gender: 'Boys' }];
    },
    validateInterpretation() {
      return { valid: false, confidence: 0.4, level: 'LOW', reason: 'Base importer does not understand partner columns.' };
    },
  },
};
assert.equal(compat.installBrowser(droppingImporterWindow), true);
const recovered = droppingImporterWindow.TennisRankImportV2.parseText('raw csv');
assert.equal(recovered[0].player1, 'Ethan Kim & Noah Williams');
assert.equal(recovered[0].player2, 'Jack Park & Liam Chen');
assert.equal(recovered[0].winner, 'Ethan Kim & Noah Williams');
assert.equal(recovered[0].loser, 'Jack Park & Liam Chen');
assert.equal(recovered[0].division, 'Doubles');
const deterministicReview = droppingImporterWindow.TennisRankImportV2.validateInterpretation(recovered);
assert.equal(deterministicReview.valid, true);
assert.equal(deterministicReview.confidence, 1);

const opposingGenderImporter = {
  TennisRankImportV2: {
    parseDelimited() {
      return { matrix: [
        ['Player 1', 'Partner 1', 'Player 2', 'Partner 2', 'Winner', 'Score', 'Gender', 'Player 1 Gender', 'Player 2 Gender'],
        ['Noah Williams', 'Ethan Kim', 'Olivia Brown', 'Sophia Lee', 'Player 1', '6-2', 'Boys', 'M', 'F'],
      ] };
    },
    detectHeaderRow() { return { index: 0 }; },
    parseText() {
      return [{ __sourceRow: 2, player1: 'Noah Williams', player2: 'Olivia Brown', winner: 'Player 1', score: '6-2', gender: 'Boys' }];
    },
    validateInterpretation() { return { valid: true, confidence: 1, level: 'HIGH' }; },
  },
};
compat.installBrowser(opposingGenderImporter);
const opposingGender = opposingGenderImporter.TennisRankImportV2.parseText('raw csv');
assert.equal(opposingGender[0].gender, 'Boys', 'opponent-side genders must never be treated as partner genders');
assert.notEqual(opposingGender[0].gender, 'Mixed');

const trueMixedSidesImporter = {
  TennisRankImportV2: {
    parseDelimited() {
      return { matrix: [
        ['Player 1', 'Partner 1', 'Player 2', 'Partner 2', 'Winner', 'Score', 'Player 1 Gender', 'Partner 1 Gender', 'Player 2 Gender', 'Partner 2 Gender'],
        ['Noah Williams', 'Olivia Brown', 'Liam Chen', 'Sophia Lee', 'Player 1', '6-2', 'M', 'F', 'M', 'F'],
      ] };
    },
    detectHeaderRow() { return { index: 0 }; },
    parseText() {
      return [{ __sourceRow: 2, player1: 'Noah Williams', player2: 'Liam Chen', winner: 'Player 1', score: '6-2' }];
    },
    validateInterpretation() { return { valid: true, confidence: 1, level: 'HIGH' }; },
  },
};
compat.installBrowser(trueMixedSidesImporter);
const trueMixedSides = trueMixedSidesImporter.TennisRankImportV2.parseText('raw csv');
assert.equal(trueMixedSides[0].gender, 'Mixed', 'mixed must be inferred only from gender differences inside a doubles pair');
assert.equal(trueMixedSides[0].division, 'Doubles');

console.log('Named-result and doubles partner compatibility regression passed.');
