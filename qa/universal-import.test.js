'use strict';

const assert = require('node:assert/strict');
const importer = require('../import-v2.js');
const ml = require('../spreadsheet-ml.js');
const universal = require('../spreadsheet-universal.js');

universal.patchImporterObject(importer, ml);

function parse(csv, source = 'Boys Singles') {
  const rows = importer.parseText(csv.trim(), source);
  assert.ok(Array.isArray(rows) && rows.length, `expected rows for ${source}`);
  return rows;
}

function assertMatchRows(rows, expected, label) {
  const complete = rows.filter(row => String(row.winner || '').trim() && String(row.loser || '').trim());
  assert.equal(complete.length, expected, `${label}: expected ${expected} complete matches, got ${complete.length}\n${JSON.stringify(rows, null, 2)}`);
}

{
  const rows = parse(`
Player,Opponent,Won?,Score
a,b,a,6-1
a,c,c,6-2
b,c,b,6-3
`);
  assertMatchRows(rows, 3, 'coach simple winner names');
  assert.equal(rows[0].winner, 'a');
  assert.equal(rows[0].loser, 'b');
}

{
  const rows = parse(`
Alpha,Beta,Champion,Scoreline
Ava Kim,Mia Shah,Ava Kim,"6-2, 6-4"
Noah Lee,Eli Chen,Eli Chen,"4-6, 6-3, 10-7"
`);
  assertMatchRows(rows, 2, 'arbitrary headers with relational winner');
  assert.equal(rows[1].winner, 'Eli Chen');
  assert.equal(rows[1].loser, 'Noah Lee');
}

{
  const rows = parse(`
Field A,Field B,Decision,Numbers
Ava Kim,Mia Shah,W,6-3
Noah Lee,Eli Chen,L,4-6
`);
  assertMatchRows(rows, 2, 'opaque headers with W/L values');
  assert.equal(rows[0].winner, 'Ava Kim');
  assert.equal(rows[1].winner, 'Eli Chen');
}

{
  const rows = parse(`
Home Side,Away Side,Decision,Final
Ava Kim,Mia Shah,Home,6-4
Noah Lee,Eli Chen,Away,3-6
`);
  assertMatchRows(rows, 2, 'home away results');
  assert.equal(rows[0].winner, 'Ava Kim');
  assert.equal(rows[1].winner, 'Eli Chen');
}

{
  const rows = parse(`
Entrant,Rival,Finish,Final
Ava Kim,Mia Shah,Win,6-1
Noah Lee,Eli Chen,Loss,2-6
`);
  assertMatchRows(rows, 2, 'natural alternative labels');
}

{
  const rows = parse(`
Side One,Side Two,Victory By,Played On,Final
Ava Kim,Mia Shah,Mia Shah,9/12/2026,4-6
Noah Lee,Eli Chen,Noah Lee,9/13/2026,7-5
`);
  assertMatchRows(rows, 2, 'winner column inferred from participant relationships');
  assert.equal(rows[0].winner, 'Mia Shah');
}

{
  const rows = parse(`
Champion,Defeated Player,Final
Ava Kim,Mia Shah,6-3
Noah Lee,Eli Chen,7-5
`);
  assertMatchRows(rows, 2, 'winner loser only layout');
}

{
  const rows = parse(`
Order,Member,Season Mark
1,Ava Kim,4-1
2,Mia Shah,3-2
3,Noah Lee,2-3
`, 'Girls Season Standings');
  assert.equal(rows.filter(row => row.name && row.record).length, 3, 'standings layout should preserve name + record');
  assert.ok(rows.every(row => row.rank), 'standings layout should infer rank/order');
}

{
  const rows = parse(`
Competitor;Against;Verdict;Scoreline
Ava Kim;Mia Shah;W;6-2
Noah Lee;Eli Chen;L;4-6
`);
  assertMatchRows(rows, 2, 'semicolon export');
}

{
  const rows = parse(`
Player\tOpponent\tOutcome\tSet Score
Ava Kim\tMia Shah\tW\t6-2
Noah Lee\tEli Chen\tL\t4-6
`);
  assertMatchRows(rows, 2, 'tsv export');
}

{
  const rows = parse(`
Date,Court,Notes
9/12/2026,1,Practice
9/13/2026,2,Conditioning
`, 'Team Schedule');
  const q = universal.quality(rows);
  assert.equal(q.matches, 0, 'non-result tennis admin sheet must not invent match winners');
}

console.log('Universal import regression pack passed: flexible headers, opaque schemas, relational winners, standings, CSV/TSV/semicolon, and safe non-match rejection.');
