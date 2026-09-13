const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const links = require('../coach-polish.js');
const importer = require('../import-v2.js');
const workbookProxy = require('../api/sheet-workbook.js');

assert.equal(
  links.googleCsvTarget('https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing'),
  'https://docs.google.com/spreadsheets/d/abc123/export?format=csv',
  'viewer links without a tab id must not invent gid=0',
);
assert.equal(
  links.googleCsvTarget('https://docs.google.com/spreadsheets/d/abc123/edit?gid=42#gid=42'),
  'https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=42',
  'explicit tab ids must be preserved',
);
assert.equal(
  links.googleCsvTarget('https://docs.google.com/spreadsheets/d/e/pubABC/pubhtml'),
  'https://docs.google.com/spreadsheets/d/e/pubABC/pub?output=csv',
  'published sheets without a tab id must use the default tab',
);
assert.match(
  links.googleCsvProxy('https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing'),
  /^\/api\/sheet-proxy\?url=/,
  'Google Sheets must still pass through the same-origin proxy',
);
assert.equal(
  links.isStandardGoogleWorkbookLink('https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing'),
  true,
  'standard viewer/editor links should import the whole workbook',
);
assert.equal(
  links.isStandardGoogleWorkbookLink('https://docs.google.com/spreadsheets/d/abc123/edit#gid=42'),
  false,
  'an explicitly selected tab should keep the single-tab path',
);

assert.deepEqual(links.compactSheetHints('BoysS'), { gender: 'Boys', division: 'Singles' });
assert.deepEqual(links.compactSheetHints('GirlsS'), { gender: 'Girls', division: 'Singles' });
assert.deepEqual(links.compactSheetHints('BoysD'), { gender: 'Boys', division: 'Doubles' });
assert.deepEqual(links.compactSheetHints('GirlsD'), { gender: 'Girls', division: 'Doubles' });

// Exact simple format from the coach's RIHS-TL screenshot.
const boysCsv = [
  'Player,Opponent,Won?,Score',
  'a,b,a,6-1',
  'a,c,c,6-2',
  'b,c,b,6-3',
].join('\n');
const boysRows = importer.parseText(boysCsv, 'BoysS');
links.normalizeCoachRows(boysRows);
assert.equal(boysRows.length, 3);
assert.deepEqual(
  boysRows.map(row => ({ player: row.name, opponent: row.opponent, winner: row.winner, loser: row.loser, score: row.score, gender: row.gender, division: row.division })),
  [
    { player: 'a', opponent: 'b', winner: 'a', loser: 'b', score: '6-1', gender: 'Boys', division: 'Singles' },
    { player: 'a', opponent: 'c', winner: 'c', loser: 'a', score: '6-2', gender: 'Boys', division: 'Singles' },
    { player: 'b', opponent: 'c', winner: 'b', loser: 'c', score: '6-3', gender: 'Boys', division: 'Singles' },
  ],
  'the coach screenshot format must normalize into three complete matches',
);
assert.deepEqual(links.importWarnings(boysRows), [], 'the valid simple coach sheet must import with no warnings');

// Never guess a winner when Won? does not identify either participant.
const invalidGirlsCsv = [
  'Player,Opponent,Won?,Score',
  'x,y,a,6-4',
  'x,z,c,6-4',
  'y,z,b,7-6',
].join('\n');
const invalidGirlsRows = importer.parseText(invalidGirlsCsv, 'GirlsS');
links.normalizeCoachRows(invalidGirlsRows);
assert.equal(links.importWarnings(invalidGirlsRows).length, 3, 'mismatched winners must be flagged instead of silently fabricated');
assert.equal(invalidGirlsRows.some(row => row.loser), false, 'invalid winner rows must not invent losers');

const yesNoRow = links.normalizeCoachRow({ __sheetName: 'BoysS', name: 'Noah', opponent: 'Ethan', winner: 'yes', score: '6-2' });
assert.equal(yesNoRow.winner, 'Noah');
assert.equal(yesNoRow.loser, 'Ethan');
const lossRow = links.normalizeCoachRow({ __sheetName: 'GirlsS', name: 'Ava', opponent: 'Mia', winner: 'L', score: '4-6' });
assert.equal(lossRow.winner, 'Mia');
assert.equal(lossRow.loser, 'Ava');

assert.equal(
  workbookProxy.exportUrlFor('https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing'),
  'https://docs.google.com/spreadsheets/d/abc123/export?format=xlsx',
  'whole-workbook imports must use the XLSX export endpoint',
);
assert.throws(
  () => workbookProxy.exportUrlFor('https://evil.example/spreadsheets/d/abc123/edit'),
  /standard Google Sheets/i,
);

for (const asset of ['team-court.jpg', 'matchday-awards.jpg', 'singles-spotlight.jpg']) {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'assets', asset)), false, `${asset} must not ship without consent`);
}

const privacyCss = fs.readFileSync(path.join(__dirname, '..', 'coach-polish.css'), 'utf8');
assert.match(privacyCss, /\.hero-photo[^}]*display:none!important|\.hero-photo[^,]*,/s, 'legacy hero photography must be suppressed');
assert.match(privacyCss, /\.season-gallery\{display:none!important\}/, 'legacy season gallery must be suppressed');

console.log('Coach feedback regression suite passed: exact RIHS-TL format, viewer-link import, warnings, and photo-consent safeguards.');
