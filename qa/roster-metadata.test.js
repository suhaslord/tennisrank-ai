const assert = require('node:assert/strict');
const sync = require('../import-auto-sync.js');
const seed = require('../api/admin/seed-ladder.js');

assert.equal(sync.normalizeRosterDivision('JV'), 'jv');
assert.equal(sync.normalizeRosterDivision('Junior Varsity'), 'jv');
assert.equal(sync.normalizeRosterDivision('Varsity'), 'varsity');
assert.equal(sync.normalizeRosterDivision('Singles'), null);
assert.equal(sync.normalizeGradeLevel('9th'), 9);
assert.equal(sync.normalizeGradeLevel('Sophomore'), 10);
assert.equal(sync.normalizeGradeLevel('Junior'), 11);
assert.equal(sync.normalizeGradeLevel('Senior'), 12);
assert.equal(sync.normalizeGradeLevel('Junior Varsity'), null);

const rows = [
  { Name: 'Alex Rivera', Gender: 'Boys', Format: 'Singles', TeamLevel: 'JV', Grade: '10th' },
  { Name: 'Morgan Lee', Gender: 'Girls', Format: 'Singles', Squad: 'Varsity', SchoolYear: 'Senior' },
];
const teams = sync.rankingsToTeams([
  { name: 'Alex Rivera', gender: 'boys', division: 'singles' },
  { name: 'Morgan Lee', gender: 'girls', division: 'singles' },
], rows);
assert.deepEqual(teams.boys, [{ name: 'Alex Rivera', division: 'jv', gradeLevel: 10 }]);
assert.deepEqual(teams.girls, [{ name: 'Morgan Lee', division: 'varsity', gradeLevel: 12 }]);

assert.equal(seed.cleanDivision('JV'), 'jv');
assert.equal(seed.cleanDivision('varsity'), 'varsity');
assert.equal(seed.cleanDivision('singles'), null);
assert.equal(seed.cleanGradeLevel(9), 9);
assert.equal(seed.cleanGradeLevel('12'), 12);
assert.equal(seed.cleanGradeLevel(8), null);

console.log('roster metadata tests passed');
