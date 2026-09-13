const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const links = require('../coach-polish.js');
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

const boysRow = links.normalizeCoachRow({ __sheetName: 'BoysS', name: 'a', opponent: 'b', winner: 'a', score: '6-1' });
assert.equal(boysRow.gender, 'Boys');
assert.equal(boysRow.division, 'Singles');
assert.equal(boysRow.winner, 'a');
assert.equal(boysRow.loser, 'b');

const sideLabelRow = links.normalizeCoachRow({ __sheetName: 'GirlsS', name: 'x', opponent: 'y', winner: 'a', score: '6-4' });
assert.equal(sideLabelRow.winner, 'x', 'A should mean the player column when A is not a participant name');
assert.equal(sideLabelRow.loser, 'y');
assert.equal(sideLabelRow.gender, 'Girls');

const badWinnerRow = links.normalizeCoachRow({ __sheetName: 'GirlsS', name: 'x', opponent: 'z', winner: 'c', score: '6-4' });
assert.match(badWinnerRow.__importWarning, /does not match/i, 'ambiguous winner codes must be flagged instead of silently inventing a result');

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

console.log('Coach feedback regression suite passed: real workbook format, viewer-link import, and photo-consent safeguards.');
