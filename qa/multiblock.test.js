const assert = require("node:assert/strict");
const ml = require("../spreadsheet-ml.js");
const importer = require("../import-v2.js");
const delimiterFix = require("../import-delimiter-fix.js");
const fixes = require("../import-v2-fixes.js");
const rowSafety = require("../import-row-safety-fix.js");
const multiBlock = require("../import-multiblock-fix.js");
const calibration = require("../spreadsheet-semantic-calibration.js");

globalThis.TennisRankSpreadsheetML = ml;
delimiterFix.patchImporter(importer);
fixes.patchImporter(importer);
rowSafety.wrapImporter(importer);
multiBlock.wrapImporter(importer);
calibration.wrapImporter(importer, ml);

const source = [
  "RIHS TENNIS — IMPORT TEST,,,,,,,,",
  "ATHLETE / TEAM,VS / OTHER SIDE,W-L?,SET LINE,SQUAD,EVENT-ish,PLAYED,Court,Coach note",
  "Aiden Shah,Leo Kim,W,6-3 6-4,Boys,Singles,2026-08-04,1,steady baseline",
  "Maya Lee,Zoe Rivera,L,4-6 3-6,Girls,Singles,2026-08-04,2,close match",
  "Ravi Patel,Noah Chen,W,7-6 6-2,Boys,Singles,2026-08-05,3,",
  "BOYS SINGLES SNAPSHOT,,,,,,,,",
  "Place-ish,Student,Season W-L,W,L,Availability,Flight,Noise metric,",
  "1,Aiden Shah,11-2,11,2,active,Singles,91,",
  "2,Leo Kim,10-3,10,3,active,Singles,88,",
  "3,Ravi Patel,9-3,9,3,active,Singles,83,",
  "GIRLS SINGLES SNAPSHOT,,,,,,,,",
  "Rank #,Given,Family,Matches Won,Matches Lost,Team,Type,Status,Ignore me",
  "1,Priya,Nair,10,1,Girls,Singles,active,blue",
  "2,Maya,Lee,9,2,Girls,Singles,active,orange",
  "3,Zoe,Rivera,8,3,Girls,Singles,injured,green",
].join("\n");

const rows = importer.parseText(source, "Chaos Master");
const review = importer.validateInterpretation(rows);
assert.equal(review.valid, true, review.reason);
assert.equal(rows.__analysis.engine, "v5-multi-block");
assert.equal(rows.__analysis.blocks.length, 3, "three independent tables should be isolated");
assert.equal(rows.length, 9, "three matches + three boys standings + three girls standings");

const aidenMatch = rows.find(row => row.name === "Aiden Shah" && row.opponent === "Leo Kim");
assert.ok(aidenMatch, "opaque match-log block should be preserved");
assert.equal(aidenMatch.result, "W");
assert.equal(aidenMatch.gender, "Boys");
assert.equal(aidenMatch.division, "Singles");

const boys = rows.filter(row => row.rank && row.gender === "Boys");
assert.equal(boys.length, 3, "nearest Boys section title should apply only to boys standings");
assert.deepEqual(boys.map(row => row.name), ["Aiden Shah", "Leo Kim", "Ravi Patel"]);

const girls = rows.filter(row => row.rank && row.gender === "Girls");
assert.equal(girls.length, 3, "girls split-name standings should remain independent");
assert.deepEqual(girls.map(row => row.name), ["Priya Nair", "Maya Lee", "Zoe Rivera"]);
assert.ok(rows.every(row => !["active", "injured", "inactive"].includes(String(row.name || "").toLowerCase())), "status values must never become player names");

const synonymSections = [
  "OLD COACH SHEET — MULTIPLE MINI TABLES,,,,,,",
  "BOYS — SINGLES,,,,,,",
  "Player,Opponent,Result,Score,Date,Court,Note",
  "Aiden Shah,Omar Khan,W,6-2 6-1,8/15/26,1,",
  "Leo Kim,Daniel Brooks,W,6-4 6-3,8/15/26,2,",
  "Ravi Patel,Ethan Park,L,5-7 4-6,8/15/26,3,",
  "GIRLS — SINGLES,,,,,,",
  "Athlete,Versus,Outcome,Line,Played,Court,Note",
  "Maya Lee,Emma Wilson,W,6-1 6-2,8/15/26,1,",
  "Priya Nair,Chloe Martin,W,6-0 6-2,8/15/26,2,",
  "Zoe Rivera,Lily Nguyen,L,4-6 6-7,8/15/26,3,",
  "BOYS — DOUBLES,,,,,,",
  "Team,Other Team,W/L,Score,Date,Court,Note",
  "Aiden Shah / Leo Kim,Ravi Patel / Noah Chen,W,6-4 6-4,8/15/26,1,",
  "Mateo Ruiz / Ethan Park,Daniel Brooks / Omar Khan,L,5-7 3-6,8/15/26,2,",
].join("\n");

const synonymRows = importer.parseText(synonymSections, "Old Coach Sheet");
const synonymReview = importer.validateInterpretation(synonymRows);
assert.equal(synonymReview.valid, true, synonymReview.reason);
assert.equal(synonymRows.__analysis.engine, "v5-multi-block");
assert.equal(synonymRows.__analysis.blocks.length, 3);
assert.equal(synonymRows.length, 8, "only eight match rows should remain after section headers are isolated");
assert.ok(!synonymRows.some(row => ["Athlete", "Team", "Player"].includes(String(row.name || ""))), "synonym/repeated headers must never become player names");
assert.deepEqual(
  synonymRows.map(row => row.name),
  ["Aiden Shah", "Leo Kim", "Ravi Patel", "Maya Lee", "Priya Nair", "Zoe Rivera", "Aiden Shah / Leo Kim", "Mateo Ruiz / Ethan Park"],
);
assert.deepEqual(synonymRows.slice(3, 6).map(row => row.gender), ["Girls", "Girls", "Girls"]);
assert.deepEqual(synonymRows.slice(6).map(row => row.division), ["Doubles", "Doubles"]);

console.log("Multi-block import suite passed: mixed schemas and synonym section headers stay isolated without fake player rows.");
