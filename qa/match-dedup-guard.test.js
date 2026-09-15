const assert = require('node:assert/strict');
const compat = require('../match-result-compat.js');
const guard = require('../match-dedup-guard.js');

{
  const rows = [
    { name: 'Noah', opponent: 'Liam', result: 'W', score: '6-3', date: '2026-09-15', gender: 'Boys', division: 'Singles' },
    { name: 'Noah', opponent: 'Liam', result: 'W', score: '6-3', date: '2026-09-15', gender: 'Boys', division: 'Singles' },
  ];
  guard.normalizeRows(rows, compat);
  assert.equal(rows.length, 1, 'literal duplicate dated/scored matches should count once');
  assert.equal(rows.__duplicatesRemoved, 1);
  assert.equal(rows[0].winner, 'Noah');
  assert.equal(rows[0].loser, 'Liam');
}

{
  const rows = [
    { name: 'Noah', opponent: 'Liam', result: 'W', score: '6-3', date: '2026-09-15', gender: 'Boys', division: 'Singles' },
    { name: 'Liam', opponent: 'Noah', result: 'L', score: '6-3', date: '2026-09-15', gender: 'Boys', division: 'Singles' },
  ];
  guard.normalizeRows(rows, compat);
  assert.equal(rows.length, 1, 'reciprocal one-row-per-player copies of the same match should count once');
  assert.equal(rows[0].winner, 'Noah');
  assert.equal(rows[0].loser, 'Liam');
}

{
  const rows = [
    { name: 'Noah', opponent: 'Liam', result: 'W', score: '6-3', date: '2026-09-15', gender: 'Boys', division: 'Singles' },
    { name: 'Noah', opponent: 'Liam', result: 'L', score: '6-3', date: '2026-09-15', gender: 'Boys', division: 'Singles' },
  ];
  guard.normalizeRows(rows, compat);
  assert.equal(rows.length, 2, 'contradictory rows must not be silently discarded');
  assert.equal(guard.conflictRows(rows).length, 2);
  assert.match(rows[0].__importConflict, /both marked as the winner/i);
}

{
  const importer = {
    parseText() {
      return [
        { name: 'Noah', opponent: 'Liam', result: 'W', score: '6-3', date: '2026-09-15', gender: 'Boys', division: 'Singles' },
        { name: 'Noah', opponent: 'Liam', result: 'L', score: '6-3', date: '2026-09-15', gender: 'Boys', division: 'Singles' },
      ];
    },
    validateInterpretation() { return { valid: true, confidence: 1, level: 'HIGH' }; },
  };
  guard.installImporter(importer, compat);
  const rows = importer.parseText('ignored');
  const review = importer.validateInterpretation(rows);
  assert.equal(review.valid, false, 'conflicting duplicate winners must block publication');
  assert.equal(review.confidence, 0);
  assert.match(review.reason, /conflicting duplicate/i);
}

{
  const rows = [
    { name: 'Noah', opponent: 'Liam', result: 'W', score: '6-3', date: '2026-09-15', matchId: 'M-101', gender: 'Boys', division: 'Singles' },
    { name: 'Noah', opponent: 'Liam', result: 'L', score: '6-3', date: '2026-09-15', matchId: 'M-102', gender: 'Boys', division: 'Singles' },
  ];
  guard.normalizeRows(rows, compat);
  assert.equal(rows.length, 2, 'distinct match IDs must preserve legitimate rematches');
  assert.equal(guard.conflictRows(rows).length, 0, 'different match IDs must not be treated as contradictory duplicates');
}

console.log('Match duplicate guard tests passed: exact/reciprocal dedupe, conflict blocking, and distinct rematch preservation.');
