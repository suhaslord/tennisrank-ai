const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadImporter() {
  const appSource = fs.readFileSync(new URL("../app.js", `file://${__dirname}/`), "utf8");
  const importerSource = appSource.split("$$('[data-gender]')")[0]
    + "\n;globalThis.__importer = { parseCSV, calculateRankings, googleCsvUrl };";
  const sandbox = {
    URL,
    cancelAnimationFrame() {},
    clearInterval,
    clearTimeout,
    console,
    document: { querySelector: () => null, querySelectorAll: () => [] },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    setInterval,
    setTimeout,
    window: { matchMedia: () => ({ matches: true }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(importerSource, sandbox);
  return sandbox.__importer;
}

const importer = loadImporter();
const datasets = [
  {
    name: "explicit winner and loser with roster rows",
    text: "Name,Gender,Division,Winner,Loser,Score,Date\nAva Patel,Girls,Singles,,,,\nMia Chen,Girls,Singles,,,,\n,Girls,Singles,Ava Patel,Mia Chen,6-3,2026-08-01",
    players: 2,
    matches: 1,
  },
  {
    name: "row-per-player W/L results",
    text: "Player,Opponent,Result,Gender,Event\nLiam,Noah,W,Boys,Singles\nEmma,Sophia,L,Girls,Singles",
    players: 4,
    matches: 2,
  },
  {
    name: "title rows and semicolon delimiter",
    text: "River Islands Tennis;;;;\nUpdated weekly;;;;\nAthlete;Sex;Category;Won By;Defeated\nJack;M;Singles;Jack;Owen\nElla;F;Singles;Maya;Ella",
    players: 4,
    matches: 2,
    headerRow: 3,
  },
  {
    name: "side-by-side match with numeric and named winner pointers",
    text: "Side A,Side B,Winner,Gender,Match Type\nBen,Sam,Player A,Boys,Singles\nNora,Chloe,2,Girls,Singles",
    players: 4,
    matches: 2,
  },
  {
    name: "doubles pairs",
    text: "Gender,Event,Team 1,Team 2,Winner,Score\nBoys,Doubles,Alex & Ben,Chris & Dan,Alex & Ben,8-5\nGirls,Doubles,Ella + Mia,Nora + Zoe,Nora + Zoe,8-6",
    players: 4,
    matches: 2,
  },
  {
    name: "standalone grouped section rows",
    text: "Player,Opponent,Result,Section\nBoys Singles,,,\nAiden,Leo,W,\nGirls Singles,,,\nMaya,Zoe,L,",
    players: 4,
    matches: 2,
  },
  {
    name: "tab-delimited accented names",
    text: "Athlète\tSex\tFormat\tOpponent\tOutcome\nJosé Álvarez\tM\tSingles\tNoah Kim\tWon\nChloë Lee\tF\tSingles\tMaya Shah\tLost",
    players: 4,
    matches: 2,
  },
  {
    name: "roster-only players start at zero",
    text: "Student,Gender,Division\nSofia,Girls,Singles\nZoe,Girls,Singles",
    players: 2,
    matches: 0,
    allZero: true,
  },
];

for (const dataset of datasets) {
  const rows = importer.parseCSV(dataset.text);
  const result = importer.calculateRankings(rows);
  assert.equal(result.rankings.length, dataset.players, `${dataset.name}: player count`);
  assert.equal(result.matches.length, dataset.matches, `${dataset.name}: match count`);
  if (dataset.headerRow) assert.equal(rows.__analysis.headerRow, dataset.headerRow, `${dataset.name}: header row`);
  if (dataset.allZero) assert.ok(result.rankings.every(player => player.wins === 0 && player.losses === 0), `${dataset.name}: 0-0 records`);
}

assert.equal(
  importer.googleCsvUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=42"),
  "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=42",
);

console.log(`Import regression suite passed: ${datasets.length} dataset formats.`);
