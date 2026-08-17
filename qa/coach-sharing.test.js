const assert = require('node:assert/strict');
const sharing = require('../coach-sharing');

const rankings = [
  { name:'Aiden Brooks', gender:'boys', division:'singles', wins:4, losses:1, winRate:.8 },
  { name:'Mateo Rivera', gender:'boys', division:'singles', wins:3, losses:2, winRate:.6 },
  { name:'Maya Shah', gender:'girls', division:'singles', wins:4, losses:1, winRate:.8 },
  { name:'Liam Chen & Oliver Davis', gender:'boys', division:'doubles', wins:4, losses:1, winRate:.8 },
];
const boysSingles = sharing.filterRankings(rankings, 'boys', 'singles');
assert.equal(boysSingles.length, 2);
assert.deepEqual(sharing.rankedRows(boysSingles).map(x => x.rank), [1,2]);
const text = sharing.rankingsText(rankings, { gender:'boys', division:'singles', date:new Date('2026-08-16T12:00:00Z') });
assert.match(text, /RIHS Boys Singles Tennis Rankings/);
assert.match(text, /1\. Aiden Brooks — 4-1/);
const csv = sharing.rankingsCsv(rankings, { gender:'boys', division:'singles' });
assert.match(csv, /Rank,Player \/ Team,Gender,Type,Wins,Losses,Win Rate/);
assert.match(csv, /1,Aiden Brooks,boys,singles,4,1,80%/);

const imported = sharing.importedSnapshot([
  { winner:'Aiden Brooks', loser:'Mateo Rivera', date:'2026-08-15', score:'6-3' },
  { winner:'Aiden Brooks & Noah Patel', loser:'Other Pair', date:'2026-08-16', score:'8-4' },
  { winner:'Ethan Cole', loser:'Aiden Brooks', date:'2026-08-14', score:'7-5' },
], 'Aiden Brooks');
assert.equal(imported.wins, 2);
assert.equal(imported.losses, 1);
assert.deepEqual(imported.last.map(x => x.result), ['W','W','L']);
console.log('coach sharing tests passed');
