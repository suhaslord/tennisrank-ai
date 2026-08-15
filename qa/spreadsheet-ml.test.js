const assert = require("node:assert/strict");
const ml = require("../spreadsheet-ml.js");
const importer = require("../import-v2.js");
const fixes = require("../import-v2-fixes.js");
const runtime = require("../import-runtime-fixes.js");
fixes.patchImporter(importer);

function top(header, values, position = 0, totalColumns = 5, sheetName = "Tennis Export") {
  return ml.classifyColumn(header, values, { position, totalColumns, sheetName }).top;
}

assert.ok(ml.modelStats.trainingDocuments > 500, "specialized model has a substantial supervised corpus");
assert.ok(ml.modelStats.vocabularySize > 100, "specialized model learned a non-trivial vocabulary");

assert.equal(top("Column C", ["W", "L", "W", "W"], 2).label, "result", "opaque W/L column inferred from values");
assert.equal(top("Data 4", ["2026-08-01", "8/4/2026", "Aug 9 2026"], 4).label, "date", "opaque date column inferred from values");
assert.equal(top("Final", ["6-3, 6-4", "7-5, 6-2", "6-7, 6-3, 10-8"], 3).label, "score", "unfamiliar score header inferred semantically");
assert.equal(top("Who won?", ["Aiden Shah", "Maya Lee", "Ravi Patel"], 2, 5, "Match Results").label, "winner", "natural-language winner header is classified");
assert.equal(top("Current place", ["1", "2", "3", "4"], 0, 5, "Season Standings").label, "rank", "standing synonym maps to rank");

const opaque = importer.parseText([
  "Tennis export,,,,",
  "Col A,Col B,Col C,Col D,Col E",
  "Aiden Shah,Leo Kim,W,Boys,Singles",
  "Maya Lee,Zoe Rivera,L,Girls,Singles",
  "Ravi Patel,Noah Smith,W,Boys,Singles",
].join("\n"), "Match Results");
assert.equal(opaque.__analysis.engine, "v3-hybrid-ml");
assert.ok(opaque.__analysis.mapping.some(item => item.method === "ml"), "opaque schema uses ML mapping");
assert.equal(opaque[0].result, "W");
assert.equal(opaque[0].gender, "Boys");
assert.equal(opaque[0].division, "Singles");
assert.ok(importer.validateInterpretation(opaque).valid, "opaque but coherent tennis table is safe to import");

const transposed = importer.parseText([
  "Field,Match 1,Match 2",
  "Player,Aiden Shah,Maya Lee",
  "Opponent,Leo Kim,Zoe Rivera",
  "Result,W,L",
  "Gender,Boys,Girls",
  "Division,Singles,Singles",
].join("\n"), "Results");
assert.equal(transposed.__analysis.orientation, "transposed", "transposed spreadsheet is automatically re-oriented");
assert.equal(transposed.length, 2);
assert.equal(transposed[0].name, "Aiden Shah");
assert.equal(transposed[0].opponent, "Leo Kim");
assert.equal(transposed[1].result, "L");
assert.ok(importer.validateInterpretation(transposed).valid);

const matrix = importer.parseText([
  ",Aiden Shah,Leo Kim,Maya Lee",
  "Aiden Shah,,\"W 6-3,6-4\",L",
  "Leo Kim,L,,W",
  "Maya Lee,W,L,",
].join("\n"), "Boys Singles Round Robin");
assert.equal(matrix.__analysis.orientation, "outcome-matrix", "round-robin matrix layout is recognized");
assert.equal(matrix.length, 3, "symmetric round-robin pairs are deduplicated");
assert.ok(matrix.every(row => row.gender === "Boys" && row.division === "Singles"));
assert.ok(importer.validateInterpretation(matrix).valid);

const sectioned = importer.parseText([
  "Player,Opponent,Result",
  "Aiden Shah,Leo Kim,W",
  "Girls Singles,,",
  "Player,Opponent,Result",
  "Maya Lee,Zoe Rivera,L",
].join("\n"), "Boys Singles");
assert.equal(sectioned.length, 2, "section headings and repeated headers do not become fake matches");
assert.equal(sectioned[0].gender, "Boys");
assert.equal(sectioned[1].gender, "Girls");
assert.equal(sectioned[1].division, "Singles");

const aggregate = importer.parseText([
  "Current Place,Who Played?,Season W-L,Team Sex,Event Type",
  "1,Aiden Shah,9-1,Boys,Singles",
  "2,Leo Kim,7-3,Boys,Singles",
].join("\n"), "Season Standings");
assert.ok(importer.validateInterpretation(aggregate).valid, "aggregate standings are valid without individual match rows");

const nonTennis = [
  { school: "River Islands", coach: "Coach Lee", notes: "Practice moved to Thursday" },
  { school: "River Islands", coach: "Coach Kim", notes: "Bring water" },
];
const rejected = ml.assessRows(nonTennis);
assert.equal(rejected.valid, false, "non-tennis administrative spreadsheet is rejected rather than hallucinated");

const ambiguous = importer.parseText([
  "Alpha,Beta,Gamma",
  "red,blue,green",
  "one,two,three",
].join("\n"), "Misc Data");
assert.equal(importer.validateInterpretation(ambiguous).valid, false, "ambiguous arbitrary table is blocked");

assert.throws(() => runtime.validateRows(ambiguous, importer), /could not confidently identify/i, "runtime safety gate refuses low-confidence publication");

console.log(`Spreadsheet ML suite passed: ${ml.MODEL_VERSION}, ${ml.modelStats.trainingDocuments} training docs, ${ml.modelStats.vocabularySize} learned tokens.`);
