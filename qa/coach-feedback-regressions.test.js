const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const links = require('../coach-polish.js');

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

for (const asset of ['team-court.jpg', 'matchday-awards.jpg', 'singles-spotlight.jpg']) {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'assets', asset)), false, `${asset} must not ship without consent`);
}

const privacyCss = fs.readFileSync(path.join(__dirname, '..', 'coach-polish.css'), 'utf8');
assert.match(privacyCss, /\.hero-photo[^}]*display:none!important|\.hero-photo[^,]*,/s, 'legacy hero photography must be suppressed');
assert.match(privacyCss, /\.season-gallery\{display:none!important\}/, 'legacy season gallery must be suppressed');

console.log('Coach feedback regression suite passed: viewer-link import and photo-consent safeguards.');
