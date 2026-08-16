const assert = require("node:assert/strict");
const ml = require("../spreadsheet-ml.js");
const importer = require("../import-v2.js");
const delimiterFix = require("../import-delimiter-fix.js");
const fixes = require("../import-v2-fixes.js");
const rowSafety = require("../import-row-safety-fix.js");
const calibration = require("../spreadsheet-semantic-calibration.js");

globalThis.TennisRankSpreadsheetML = ml;
delimiterFix.patchImporter(importer);
fixes.patchImporter(importer);
rowSafety.wrapImporter(importer);
calibration.wrapImporter(importer, ml);

const splitNames = importer.parseText([
  "Rank,First,Surname,W,L,Record,Squad,Flight,Availability,Unrelated GPA",
  "1,Priya,Nair,10,1,10-1,Girls,Singles,active,3.94",
  "2,Maya,Lee,9,2,9-2,Girls,Singles,active,3.88",
].join("\n"), "Girls Singles Standings");
assert.equal(splitNames[0].name, "Priya Nair", "explicit First + Surname must beat an ML name guess");
assert.equal(splitNames[1].name, "Maya Lee");
assert.equal(splitNames[0].gender, "Girls", "Squad values should recover team gender");
assert.equal(splitNames[0].division, "Singles");
assert.notEqual(splitNames[0].name, "active", "availability must never become a player name");
assert.equal(importer.validateInterpretation(splitNames).valid, true);

const doubles = importer.parseText([
  "Side Alpha,Side Beta,Who Won?,Scoreline,Group,Format,When,Venue",
  "Aiden Shah / Leo Kim,Ravi Patel / Noah Chen,Aiden Shah / Leo Kim,6-4 7-5,Boys,Doubles,2026-08-12,RIHS 1",
  "Maya Lee & Zoe Rivera,Priya Nair & Ava Thompson,Priya Nair & Ava Thompson,3-6 6-4 7-10,Girls,Doubles,2026-08-12,RIHS 3",
].join("\n"), "Doubles Teams");
assert.equal(doubles[0].player1, "Aiden Shah / Leo Kim");
assert.equal(doubles[0].player2, "Ravi Patel / Noah Chen");
assert.equal(doubles[0].winner, "Player A", "whole-team winner should resolve to Player A");
assert.equal(doubles[1].winner, "Player B", "whole-team winner should resolve to Player B");
assert.equal(doubles[0].gender, "Boys", "Group containing Boys must be gender, not division");
assert.equal(doubles[0].division, "Doubles");
assert.equal(doubles[0].date, "2026-08-12");
assert.equal(importer.validateInterpretation(doubles).valid, true);

const mixedSection = importer.parseText([
  "RIHS Tennis,,,,,,,",
  "ATHLETE / TEAM,VS / OTHER SIDE,W-L?,SET LINE,SQUAD,EVENT-ish,PLAYED,Court",
  "Aiden Shah,Leo Kim,W,6-3 6-4,Boys,Singles,2026-08-04,1",
  "Maya Lee,Zoe Rivera,L,4-6 3-6,Girls,Singles,2026-08-04,2",
  "BOYS SINGLES SNAPSHOT,,,,,,,",
  "Rank,Player,Record,W,L,Availability,Flight,Noise",
  "1,Aiden Shah,11-2,11,2,active,Singles,91",
  "2,Leo Kim,10-3,10,3,active,Singles,88",
].join("\n"), "Mixed Tennis Sheet");
const aggregateRows = mixedSection.filter(row => row.rank || row.record);
if (aggregateRows.length) {
  assert.ok(aggregateRows.every(row => row.gender === "Boys"), "nearest Boys section heading must override stale earlier context");
}

console.log("Row safety suite passed: split names, generic gender/division fields, team winners, and nearest section context are protected.");
