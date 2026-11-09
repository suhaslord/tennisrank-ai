const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const XLSX = require('xlsx');
const ml = require('../spreadsheet-ml.js');
const importer = require('../import-v2.js');
const fixes = require('../import-v2-fixes.js');
const calibration = require('../spreadsheet-semantic-calibration.js');
const universal = require('../spreadsheet-universal.js');
const runtime = require('../import-runtime-fixes.js');

fixes.patchImporter(importer);
calibration.wrapImporter(importer, ml);
universal.patchImporterObject(importer, ml);

for (const [sheetName, expected] of [
  ['BoysS', { gender: 'Boys', division: 'Singles' }],
  ['GirlsS', { gender: 'Girls', division: 'Singles' }],
  ['BoysSL', { gender: 'Boys', division: 'Singles' }],
  ['GirlsSL', { gender: 'Girls', division: 'Singles' }],
  ['BoysD', { gender: 'Boys', division: 'Doubles' }],
  ['GirlsD', { gender: 'Girls', division: 'Doubles' }],
  ['BSL', { gender: 'Boys', division: 'Singles' }],
  ['G-D', { gender: 'Girls', division: 'Doubles' }],
  ['Boys S Ladder', { gender: 'Boys', division: 'Singles' }],
  ['Girls D Ladder', { gender: 'Girls', division: 'Doubles' }],
  ['MD', { gender: 'Mixed', division: 'Doubles' }],
]) {
  assert.deepEqual(importer.sectionHints(sheetName), expected, `${sheetName}: infer team and division from the tab name`);
}

function loadLegacyCalculate() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const prefix = source.split("$$('[data-gender]')")[0]
    + '\n;globalThis.__calc = calculateRankings;';
  const sandbox = {
    URL,
    cancelAnimationFrame() {}, clearInterval, clearTimeout, console,
    document: { querySelector: () => null, querySelectorAll: () => [] },
    performance: { now: () => 0 }, requestAnimationFrame: () => 0,
    setInterval, setTimeout, window: { matchMedia: () => ({ matches: true }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(prefix, sandbox);
  return sandbox.__calc;
}

const legacyCalculate = loadLegacyCalculate();

function makeWorkbook() {
  const wb = XLSX.utils.book_new();
  const boys = XLSX.utils.aoa_to_sheet([
    ['RIHS Tennis — coach export'],
    [],
    ['Player', 'Opponent', 'Result'],
    ['Aiden Shah', 'Leo Kim', 'W'],
    ['Player', 'Opponent', 'Result'],
    ['Noah Patel', 'Aiden Shah', 'L'],
  ]);
  const girls = XLSX.utils.aoa_to_sheet([
    ['Rank', 'Player', 'Record'],
    [1, 'Maya Lee', '8-1'],
    [2, 'Zoe Chen', '6-3'],
  ]);
  const inventory = XLSX.utils.aoa_to_sheet([
    ['Item', 'Count', 'Location', 'Condition'],
    ['Practice rackets', 18, 'Locker 2', 'Mixed'],
    ['Score cards', 8, 'Coach office', 'Good'],
    ['Cones', 36, 'Shed B', 'Good'],
  ]);
  XLSX.utils.book_append_sheet(wb, boys, 'Boys Singles');
  XLSX.utils.book_append_sheet(wb, girls, 'Girls Singles');
  XLSX.utils.book_append_sheet(wb, inventory, 'Equipment Inventory');
  return wb;
}

function fakeFile(name, buffer) {
  return {
    name,
    type: '',
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

async function run() {
  const formats = [
    ['xlsx', 'xlsx'],
    ['xls', 'xls'],
    ['xlsb', 'xlsb'],
    ['ods', 'ods'],
  ];

  for (const [extension, bookType] of formats) {
    const buffer = XLSX.write(makeWorkbook(), { type: 'buffer', bookType });
    assert.ok(buffer.length > 100, `${extension}: generated binary workbook`);
    const rows = await runtime.workbookRows(fakeFile(`season.${extension}`, buffer), XLSX, importer);
    const result = importer.enhancedCalculateRankings(rows, legacyCalculate);
    assert.deepEqual(rows.__analysis.sheets, ['Boys Singles', 'Girls Singles'], `${extension}: only trusted tennis worksheets loaded`);
    assert.equal(rows.__analysis.rejectedSheets.length, 1, `${extension}: non-tennis worksheet rejected`);
    assert.equal(rows.__analysis.rejectedSheets[0].name, 'Equipment Inventory', `${extension}: inventory tab identified as rejected`);
    assert.equal(rows.some(row => Object.values(row).some(value => String(value) === 'Practice rackets')), false, `${extension}: junk equipment values never enter canonical rows`);
    assert.ok(result.matches.length >= 2, `${extension}: match log parsed`);
    assert.ok(result.rankings.some(player => player.name === 'Aiden Shah'), `${extension}: Boys player recognized`);
    const maya = result.rankings.find(player => player.name === 'Maya Lee');
    assert.ok(maya, `${extension}: aggregate Girls record recognized`);
    assert.equal(maya.wins, 8, `${extension}: aggregate wins preserved`);
  }

  const abbreviatedBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(abbreviatedBook, XLSX.utils.aoa_to_sheet([
    ['Date', 'Player', 'Opponent', 'Won?', 'Score'],
    ['11/2/2026', 'QA Boy One', 'QA Boy Two', 'QA Boy Two', '6-4'],
    ['11/2/2026', 'QA Boy Three', 'QA Boy Four', 'QA Boy Three', '4-3'],
  ]), 'BoysS');
  XLSX.utils.book_append_sheet(abbreviatedBook, XLSX.utils.aoa_to_sheet([
    ['Date', 'Player', 'Opponent', 'Won?', 'Score'],
    ['11/2/2026', 'QA Girl One', 'QA Girl Two', 'QA Girl One', '6-3'],
  ]), 'GirlsS');
  const abbreviatedBuffer = XLSX.write(abbreviatedBook, { type: 'buffer', bookType: 'xlsx' });
  const abbreviatedRows = await runtime.workbookRows(fakeFile('rihs-tennis.xlsx', abbreviatedBuffer), XLSX, importer);
  assert.ok(abbreviatedRows.filter(row => row.__sheetName === 'BoysS').every(row => row.gender === 'Boys' && row.division === 'Singles'), 'BoysS results receive Boys Singles metadata');
  assert.ok(abbreviatedRows.filter(row => row.__sheetName === 'GirlsS').every(row => row.gender === 'Girls' && row.division === 'Singles'), 'GirlsS results receive Girls Singles metadata');
  assert.equal(abbreviatedRows.length, 3, 'abbreviated boys/girls result tabs both import');

  const textFile = {
    name: 'Boys Singles.tsv',
    type: 'text/tab-separated-values',
    async text() {
      return 'Player\tOpponent\tResult\nAiden Shah\tLeo Kim\tW';
    },
  };
  const textRows = await runtime.textRows(textFile, importer);
  const textResult = importer.enhancedCalculateRankings(textRows, legacyCalculate);
  assert.equal(textResult.matches.length, 1, 'TSV upload is parsed through the v2 runtime');
  assert.equal(textResult.rankings[0].gender, 'boys', 'filename supplies missing Boys context');
  assert.equal(textResult.rankings[0].division, 'singles', 'filename supplies missing Singles context');

  console.log('Workbook format suite passed: XLSX, XLS, XLSB, ODS binary round-trips + per-sheet junk rejection + filename-aware TSV upload.');
}

run().catch(error => {
  const message = String(error?.stack || error?.message || error).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error(`::error file=qa/workbook-formats.test.js::${message}`);
  process.exit(1);
});
