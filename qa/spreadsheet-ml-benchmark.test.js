const assert = require("node:assert/strict");
const ml = require("../spreadsheet-ml.js");
const importer = require("../import-v2.js");
const fixes = require("../import-v2-fixes.js");
const runtime = require("../import-runtime-fixes.js");
fixes.patchImporter(importer);

const validFixtures = [
  {
    name: "standard match log",
    source: "Varsity Match Log",
    text: "Player,Opponent,Result,Score,Date\nAiden Shah,Leo Kim,W,6-3 6-4,2026-08-10\nMaya Lee,Zoe Rivera,L,4-6 3-6,2026-08-11",
    check: rows => rows.length === 2 && rows[0].name === "Aiden Shah" && rows[0].result === "W",
  },
  {
    name: "opaque five-column export",
    source: "Tennis Results",
    text: "Dataset,,,,\nField 1,Field 2,Field 3,Field 4,Field 5\nRavi Patel,Noah Smith,W,Boys,Singles\nEmma Wilson,Olivia Brown,L,Girls,Singles",
    check: rows => rows.length === 2 && rows[0].result === "W" && rows[0].gender === "Boys",
  },
  {
    name: "natural-language standings",
    source: "Fall Leaderboard",
    text: "Place on board,Competitor on board,Overall W-L,Team sex,Event category\n1,Aiden Shah,10-1,Boys,Singles\n2,Leo Kim,8-3,Boys,Singles",
    check: rows => rows.length === 2 && rows[0].name === "Aiden Shah" && Number(rows[0].__sourceRank) === 1,
  },
  {
    name: "separate wins and losses",
    source: "Girls Singles Standings",
    text: "Standing,Athlete Listed,Victories,Defeats\n1,Maya Lee,8,1\n2,Zoe Rivera,6,3",
    check: rows => rows.length === 2 && rows[0].name === "Maya Lee" && Number(rows[0].__aggregateWins) === 8,
  },
  {
    name: "first and last name roster standings",
    source: "Boys Singles Leaderboard",
    text: "Rank,First Name,Last Name,Record\n1,Aiden,Shah,9-0\n2,Leo,Kim,7-2",
    check: rows => rows.length === 2 && rows[0].name === "Aiden Shah" && rows[1].name === "Leo Kim",
  },
  {
    name: "winner loser match log",
    source: "Match Results",
    text: "Winner,Loser,Final Score,Played On\nAiden Shah,Leo Kim,6-2 6-4,2026-08-01\nMaya Lee,Zoe Rivera,7-5 6-3,2026-08-02",
    check: rows => rows.length === 2 && rows[0].winner === "Aiden Shah" && rows[0].loser === "Leo Kim",
  },
  {
    name: "home away winner pointers",
    source: "Dual Results",
    text: "Home,Away,Winner,Event\nAiden Shah,Leo Kim,Home,Singles\nMaya Lee,Zoe Rivera,Away,Singles",
    check: rows => rows.length === 2 && rows[0].winner === "Player A" && rows[1].winner === "Player B",
  },
  {
    name: "team a team b",
    source: "Dual Meet",
    text: "Team A,Team B,Outcome,Division\nAlex & Ben,Chris & Dan,Team A,Doubles\nMaya & Zoe,Emma & Olivia,Team B,Doubles",
    check: rows => rows.length === 2 && rows[0].player1 === "Alex & Ben" && rows[0].result === "Player A",
  },
  {
    name: "title notes before headers",
    source: "Boys Singles",
    text: "River Islands Tennis 2026,,,,\nCoach export - do not edit,,,,\n,,,,\nAthlete,Against,W/L,Score\nAiden Shah,Leo Kim,W,6-4 6-2\nRavi Patel,Noah Smith,L,4-6 5-7",
    check: rows => rows.length === 2 && rows[0].name === "Aiden Shah" && rows[0].division === "Singles",
  },
  {
    name: "repeated blocks",
    source: "Season Results",
    text: "Player,Opponent,Result\nAiden Shah,Leo Kim,W\nGirls Singles,,\nPlayer,Opponent,Result\nMaya Lee,Zoe Rivera,L",
    check: rows => rows.length === 2 && rows[0].name === "Aiden Shah" && rows[1].gender === "Girls",
  },
  {
    name: "transposed results",
    source: "Tennis Results",
    text: "Attribute,Match One,Match Two\nPlayer,Aiden Shah,Maya Lee\nOpponent,Leo Kim,Zoe Rivera\nResult,W,L\nScore,6-3 6-4,4-6 3-6\nDivision,Singles,Singles",
    check: rows => rows.length === 2 && rows.__analysis.orientation === "transposed" && rows[0].opponent === "Leo Kim",
  },
  {
    name: "round robin matrix",
    source: "Girls Singles Round Robin",
    text: ",Maya Lee,Zoe Rivera,Emma Wilson\nMaya Lee,,W,L\nZoe Rivera,L,,W\nEmma Wilson,W,L,",
    check: rows => rows.length === 3 && rows.__analysis.orientation === "outcome-matrix" && rows.every(row => row.gender === "Girls"),
  },
  {
    name: "semicolon separated aggregate",
    source: "Boys Singles Standings",
    text: "Rank;Player;Record;Gender;Division\n1;Aiden Shah;8-1;Boys;Singles\n2;Leo Kim;6-3;Boys;Singles",
    check: rows => rows.length === 2 && rows[0].name === "Aiden Shah" && rows[0].record === "8-1",
  },
  {
    name: "tab separated match export",
    source: "Girls Singles Results",
    text: "Athlete\tOpponent\tOutcome\tFinal\nMaya Lee\tZoe Rivera\tW\t6-2, 6-4\nEmma Wilson\tOlivia Brown\tL\t3-6, 5-7",
    check: rows => rows.length === 2 && rows[0].name === "Maya Lee" && rows[0].result === "W",
  },
  {
    name: "pipe separated match export",
    source: "Boys Singles Results",
    text: "Player|Opponent|Result|Score\nAiden Shah|Leo Kim|W|6-1,6-3\nRavi Patel|Noah Smith|L|4-6,2-6",
    check: rows => rows.length === 2 && rows[0].name === "Aiden Shah" && rows[0].score.includes("6-1"),
  },
  {
    name: "roster only with tennis context",
    source: "Girls Singles Roster",
    text: "Player,Gender,Division,Grade\nMaya Lee,Girls,Singles,10\nZoe Rivera,Girls,Singles,11",
    check: rows => rows.length === 2 && rows[0].name === "Maya Lee" && rows[0].division === "Singles",
  },
];

let validPasses = 0;
for (const fixture of validFixtures) {
  const rows = importer.parseText(fixture.text, fixture.source);
  const review = importer.validateInterpretation(rows);
  assert.equal(review.valid, true, `${fixture.name}: interpretation should be accepted (${review.reason})`);
  assert.equal(Boolean(fixture.check(rows)), true, `${fixture.name}: parsed semantics should match expected meaning`);
  runtime.validateRows(rows, importer);
  validPasses += 1;
}

const rejectedFixtures = [
  { name: "practice notes", source: "Practice", text: "Coach,Location,Notes\nCoach Lee,Court 3,Bring water\nCoach Kim,Court 4,New balls" },
  { name: "student contacts", source: "Contacts", text: "Student,Email,Phone\nAiden Shah,aiden@example.com,5550001\nLeo Kim,leo@example.com,5550002" },
  { name: "equipment inventory", source: "Inventory", text: "Item,Count,Location\nBalls,48,Shed\nRackets,12,Locker" },
  { name: "random colors", source: "Misc", text: "Alpha,Beta,Gamma\nred,blue,green\none,two,three" },
  { name: "calendar only", source: "Schedule", text: "Date,Court,Notes\n2026-08-20,1,Practice\n2026-08-21,2,Conditioning" },
  { name: "grades", source: "Class", text: "Name,Assignment,Grade\nAiden Shah,Quiz 1,92\nLeo Kim,Quiz 1,88" },
  { name: "expenses", source: "Budget", text: "Category,Amount,Notes\nBalls,120,Case\nTravel,450,Tournament" },
  { name: "attendance", source: "Attendance", text: "Student,Present,Date\nAiden Shah,Yes,2026-08-10\nLeo Kim,No,2026-08-10" },
];

let rejectionPasses = 0;
for (const fixture of rejectedFixtures) {
  const rows = importer.parseText(fixture.text, fixture.source);
  const review = importer.validateInterpretation(rows);
  assert.equal(review.valid, false, `${fixture.name}: importer must refuse unrelated or ambiguous data`);
  assert.throws(() => runtime.validateRows(rows, importer), /could not confidently identify|No usable tennis rows/i, `${fixture.name}: runtime publication gate must reject`);
  rejectionPasses += 1;
}

const total = validFixtures.length + rejectedFixtures.length;
const passed = validPasses + rejectionPasses;
const accuracy = passed / total;
assert.ok(accuracy === 1, `held-out fixture benchmark must be 100%; received ${(accuracy * 100).toFixed(1)}%`);
console.log(`Spreadsheet ML held-out benchmark passed: ${validPasses}/${validFixtures.length} valid layouts accepted correctly, ${rejectionPasses}/${rejectedFixtures.length} unrelated layouts safely rejected.`);
