const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const importer = require("../import-v2.js");
const delimiterFix = require("../import-delimiter-fix.js");
const fixes = require("../import-v2-fixes.js");
const runtime = require("../import-runtime-fixes.js");
const autoSync = require("../import-auto-sync.js");
const coachOps = require("../coach-ops.js");
const fixtures = require("./fixtures/ugly-imports.js");

delimiterFix.patchImporter(importer);
fixes.patchImporter(importer);

function loadLegacyImporter() {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const importerSource = appSource.split("$$('[data-gender]')")[0] + "\n;globalThis.__legacyImporter = { calculateRankings };";
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

function calculate(text) {
  const rows = runtime.normalizeRows(importer.parseText(text, "Tennis Results"));
  const result = importer.enhancedCalculateRankings(rows, legacy.calculateRankings);
  return { rows, result };
}

for (const fixture of fixtures) {
  const { rows, result } = calculate(fixture.text);
  assert.ok(rows.length > 0, `${fixture.name}: importer returned rows`);
  if (fixture.minRankings !== undefined) assert.ok(result.rankings.length >= fixture.minRankings, `${fixture.name}: ranking count`);
  if (fixture.minMatches !== undefined) assert.ok(result.matches.length >= fixture.minMatches, `${fixture.name}: match count`);
  if (fixture.exactNames) {
    const names = new Set(result.rankings.map(item => item.name));
    for (const name of fixture.exactNames) assert.ok(names.has(name), `${fixture.name}: preserves ${name}`);
  }
  if (fixture.boards) {
    const boards = new Set(coachOps.boardEntries(result.rankings).map(item => item.board));
    for (const board of fixture.boards) assert.ok(boards.has(board), `${fixture.name}: detects ${board}`);
  }
  if (fixture.metadata) {
    for (const [name, expected] of Object.entries(fixture.metadata)) {
      assert.deepEqual(autoSync.rosterMetadata(rows, name), expected, `${fixture.name}: metadata for ${name}`);
    }
  }
  if (fixture.metadataSample) {
    const { name, ...expected } = fixture.metadataSample;
    assert.deepEqual(autoSync.rosterMetadata(rows, name), expected, `${fixture.name}: sample metadata`);
  }
}

console.log(`Ugly import regression pack passed: ${fixtures.length} fixture families including 140-player roster.`);
