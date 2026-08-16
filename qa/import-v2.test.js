const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const importer = require("../import-v2.js");
const delimiterFix = require("../import-delimiter-fix.js");
const fixes = require("../import-v2-fixes.js");
const runtime = require("../import-runtime-fixes.js");
delimiterFix.patchImporter(importer);
fixes.patchImporter(importer);

function loadLegacyImporter() {
  const appPath = path.join(__dirname, "..", "app.js");
  const appSource = fs.readFileSync(appPath, "utf8");
  const importerSource = appSource.split("$$('[data-gender]')")[0]
    + "\n;globalThis.__legacyImporter = { parseCSV, calculateRankings, googleCsvUrl };";
  const sandbox = {
    URL,
    cancelAnimationFrame() {}, clearInterval, clearTimeout, console,
    document: { querySelector: () => null, querySelectorAll: () => [] },
    performance: { now: () => 0 }, requestAnimationFrame: () => 0,
    setInterval, setTimeout, window: { matchMedia: () => ({ matches: true }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(importerSource, sandbox);
  return sandbox.__legacyImporter;
}

const legacy = loadLegacyImporter();
function calculate(text, sheetName) {
  const rows = runtime.normalizeRows(importer.parseText(text, sheetName));
  return { rows, result: importer.enhancedCalculateRankings(rows, legacy.calculateRankings) };
}

const cases = [
  { name: "repeated headers", text: "Player,Opponent,Result,Gender,Event\nAiden,Leo,W,Boys,Singles\nPlayer,Opponent,Result,Gender,Event\nMaya,Zoe,L,Girls,Singles", players: 4, matches: 2, rows: 2 },
  { name: "home away columns", text: "Home,Away,Winner,Gender,Event\nAiden,Leo,Home,Boys,Singles\nMaya,Zoe,Away,Girls,Singles", players: 4, matches: 2 },
  { name: "score embedded in W result", text: "Player,Opponent,Result,Gender,Event\nAiden,Leo,\"W 6-3,6-4\",Boys,Singles", players: 2, matches: 1, score: "6-3,6-4" },
  { name: "defeated opponent prose", text: "Player,Result,Gender,Event\nAiden,def. Leo 6-2,Boys,Singles", players: 2, matches: 1 },
  { name: "lost to opponent prose", text: "Athlete,Outcome,Sex,Format\nMaya,lost to Zoe 4-6,F,Singles", players: 2, matches: 1 },
  { name: "first and last name columns", text: "First Name,Last Name,Opponent,Result,Gender,Division\nAiden,Shah,Leo Kim,W,Boys,Singles", players: 2, matches: 1 },
  { name: "pipe delimiter", text: "Player|Opponent|Result|Gender|Event\nAiden|Leo|W|Boys|Singles", players: 2, matches: 1, delimiter: "pipe" },
  { name: "quoted comma in player name", text: "Player,Opponent,Result,Gender,Event\n\"Smith, Alex\",Leo,W,Boys,Singles", players: 2, matches: 1 },
  { name: "UTF8 BOM with title rows", text: "\uFEFFRIHS Tennis,,,,\nCoach export,,,,\nPlayer,Opponent,Result,Gender,Event\nAiden,Leo,W,Boys,Singles", players: 2, matches: 1, headerRow: 3 },
  { name: "aggregate season record", text: "Rank,Player,Record,Gender,Division\n1,Aiden Shah,8-1,Boys,Singles\n2,Leo Kim,6-3,Boys,Singles", players: 2, matches: 0, top: "Aiden Shah", topWins: 8 },
  { name: "separate wins and losses", text: "Standing,Athlete,Wins,Losses,Sex,Event\n1,Maya Shah,9,2,F,Singles\n2,Zoe Lee,7,4,F,Singles", players: 2, matches: 0, top: "Maya Shah", topWins: 9 },
  { name: "source standing preserved", text: "Position,Player,Record,Gender,Division\n2,Leo Kim,5-2,Boys,Singles\n1,Aiden Shah,5-2,Boys,Singles", players: 2, matches: 0, top: "Aiden Shah" },
  { name: "semicolon coaching export", text: "Student;Against;W/L;Sex;Category\nAiden;Leo;W;M;Singles", players: 2, matches: 1 },
  { name: "TSV with commas inside cells", text: "Player\tOpponent\tResult\tScore\tNote\nSmith, Alex\tKim, Leo\tW\t6-3, 6-4\tWindy, late", players: 2, matches: 1, delimiter: "tab", score: "6-3, 6-4" },
  { name: "doubles home away pairs", text: "Home,Away,Winner,Gender,Event\nAlex & Ben,Chris & Dan,Home,Boys,Doubles", players: 2, matches: 1 },
];

for (const sample of cases) {
  const { rows, result } = calculate(sample.text, sample.sheetName);
  assert.equal(result.rankings.length, sample.players, `${sample.name}: player/team count`);
  assert.equal(result.matches.length, sample.matches, `${sample.name}: match count`);
  if (sample.rows) assert.equal(rows.length, sample.rows, `${sample.name}: normalized row count`);
  if (sample.delimiter) assert.equal(rows.__analysis.delimiter, sample.delimiter, `${sample.name}: delimiter`);
  if (sample.headerRow) assert.equal(rows.__analysis.headerRow, sample.headerRow, `${sample.name}: header row`);
  if (sample.score) assert.equal(result.matches[0]?.score, sample.score, `${sample.name}: score extraction`);
  if (sample.top) assert.equal(result.rankings[0]?.name, sample.top, `${sample.name}: top ranking`);
  if (sample.topWins !== undefined) assert.equal(result.rankings[0]?.wins, sample.topWins, `${sample.name}: aggregate wins`);
}

const workbookRows = runtime.normalizeRows(importer.mergeWorksheetRows([
  { name: "Boys Singles", text: "Player,Opponent,Result\nAiden,Leo,W" },
  { name: "Girls Singles", text: "Player,Opponent,Result\nMaya,Zoe,L" },
  { name: "Girls Doubles", text: "Team A,Team B,Winner\nMaya & Zoe,Ella & Mia,Team A" },
]));
const workbookResult = importer.enhancedCalculateRankings(workbookRows, legacy.calculateRankings);
assert.equal(workbookRows.__analysis.sheets.length, 3, "multi-sheet workbook tracks all non-empty tabs");
assert.equal(workbookResult.matches.length, 3, "sheet names supply Boys/Girls + Singles/Doubles context");
assert.equal(workbookResult.rankings.length, 6, "workbook combines singles players and doubles teams");
assert.equal(runtime.sidePointer("Home"), "Player A");
assert.equal(runtime.sidePointer("Team B"), "Player B");

assert.equal(importer.googleCsvUrl("https://docs.google.com/spreadsheets/u/0/d/abc123/edit?gid=42#gid=42"), "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=42");
assert.equal(importer.googleCsvUrl("https://docs.google.com/spreadsheets/d/e/pubABC/pubhtml?gid=77&single=true"), "https://docs.google.com/spreadsheets/d/e/pubABC/pub?output=csv&gid=77");
assert.equal(importer.googleCsvUrl("https://drive.google.com/open?id=driveABC"), "https://docs.google.com/spreadsheets/d/driveABC/export?format=csv&gid=0");
assert.match(importer.googleCsvProxyUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=0"), /^\/api\/sheet-proxy\?url=/);
assert.equal(importer.fileKind({ name: "season.xlsx", type: "" }), "workbook");
assert.equal(importer.fileKind({ name: "season.xlsb", type: "" }), "workbook");
assert.equal(importer.fileKind({ name: "season.ods", type: "" }), "workbook");
assert.equal(importer.fileKind({ name: "season.numbers", type: "" }), "workbook");
assert.equal(importer.fileKind({ name: "season.tsv", type: "" }), "text");

console.log(`Import v2 suite passed: ${cases.length} text layouts + multi-sheet workbook + Google URL/file compatibility.`);
