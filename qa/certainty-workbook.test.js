'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const ml = require('../spreadsheet-ml.js');
globalThis.TennisRankSpreadsheetML = ml;
const importer = require('../import-v2.js');
require('../import-v2-fixes.js').patchImporter(importer);
require('../spreadsheet-universal.js').patchImporterObject(importer, ml);
const runtime = require('../import-runtime-fixes.js');
const certainty = require('../import-certainty-gate.js');

function workbookBuffer(sheets) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

function aiMapper(confidence = 0.96) {
  const state = { calls: 0 };
  state.client = {
    async enhanceRows(rows) {
      state.calls += 1;
      const mapped = rows.map(row => {
        const player1 = String(row.C1 || row['Side Left'] || '').trim();
        const player2 = String(row.C2 || row['Side Right'] || '').trim();
        const signal = String(row.C3 || row['Decision Name'] || '').trim();
        const same = (a, b) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');
        const winner = same(signal, player2) ? player2 : player1;
        const loser = same(winner, player1) ? player2 : player1;
        return {
          player1,
          player2,
          winner,
          loser,
          score: String(row.C4 || row.Numbers || '').trim(),
          gender: String(row.C5 || row.Squad || '').trim(),
          division: String(row.C6 || row.Type || '').trim(),
          __sourceRow: row.__sourceRow,
          __sheetName: row.__sheetName,
        };
      });
      mapped.__analysis = {
        ...(rows.__analysis || {}),
        engine: 'qa-google-ai-remap',
        ai: {
          status: 'applied-and-validated',
          model: 'Google AI QA',
          confidence,
          mappings: [
            { inputKey: 'C1', target: 'player1', confidence },
            { inputKey: 'C2', target: 'player2', confidence },
            { inputKey: 'C3', target: 'winner', confidence },
            { inputKey: 'C4', target: 'score', confidence },
            { inputKey: 'C5', target: 'gender', confidence },
            { inputKey: 'C6', target: 'division', confidence },
          ],
        },
      };
      return mapped;
    },
  };
  return state;
}

test('certainty threshold is strict at 85 percent', () => {
  assert.equal(certainty.CERTAINTY_THRESHOLD, 0.85);
  assert.equal(certainty.shouldEscalate({ valid: true, confidence: 0.8499 }), true);
  assert.equal(certainty.shouldEscalate({ valid: true, confidence: 0.85 }), false);
  assert.equal(certainty.shouldEscalate({ valid: false, confidence: 0.99 }), true);
});

test('clean spreadsheet stays local and does not spend a Google AI call', async () => {
  const ai = aiMapper();
  const buffer = workbookBuffer([['Clean Results', [
    ['Player', 'Opponent', 'Result', 'Score', 'Gender', 'Division'],
    ['Noah Williams', 'Ethan Kim', 'W', '6-3', 'Boys', 'Singles'],
    ['Ava Patel', 'Mia Rodriguez', 'W', '6-4', 'Girls', 'Singles'],
  ]]]);

  const rows = await certainty.interpretWorkbookBuffer(buffer, { XLSX, importer, runtime, ai: ai.client, source: 'file' });
  assert.equal(ai.calls, 0, 'Google AI must not run for a >=85% local interpretation');
  assert.ok(rows.__analysis.certainty.final >= 0.85);
  assert.equal(rows.__analysis.certainty.aiUsed, false);
  assert.equal(rows.length, 2);
});

test('opaque columns in a real XLSX escalate to Google AI and finish above threshold', async () => {
  const ai = aiMapper(0.96);
  const buffer = workbookBuffer([
    ['Clean Results', [
      ['Player', 'Opponent', 'Result', 'Score', 'Gender', 'Division'],
      ['Ava Patel', 'Mia Rodriguez', 'W', '6-4', 'Girls', 'Singles'],
    ]],
    ['Mystery Tab', [
      ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
      ['Noah Williams', 'Ethan Kim', 'Noah Williams', '6-3', 'Boys', 'Singles'],
      ['Noah Williams', 'Liam Chen', 'Liam Chen', '4-6', 'Boys', 'Singles'],
      ['Liam Chen', 'Ethan Kim', 'Liam Chen', '7-5', 'Boys', 'Singles'],
    ]],
  ]);

  const rows = await certainty.interpretWorkbookBuffer(buffer, { XLSX, importer, runtime, ai: ai.client, source: 'file' });
  assert.equal(ai.calls, 1, 'only the low-certainty worksheet should use Google AI');
  assert.equal(rows.__analysis.certainty.aiUsed, true);
  assert.ok(rows.__analysis.certainty.final >= 0.85, `expected >=85%, got ${rows.__analysis.certainty.final}`);
  assert.deepEqual(rows.__analysis.sheets, ['Clean Results', 'Mystery Tab']);
  const opaqueRows = rows.filter(row => row.__sheetName === 'Mystery Tab');
  assert.equal(opaqueRows.length, 3);
  assert.deepEqual(opaqueRows.map(row => [row.winner, row.loser, row.score]), [
    ['Noah Williams', 'Ethan Kim', '6-3'],
    ['Liam Chen', 'Noah Williams', '4-6'],
    ['Liam Chen', 'Ethan Kim', '7-5'],
  ]);
});

test('Google AI cannot force publication when the combined certainty stays below 85 percent', async () => {
  const ai = aiMapper(0.70);
  const buffer = workbookBuffer([['Mystery Tab', [
    ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    ['Noah Williams', 'Ethan Kim', 'Noah Williams', '6-3', 'Boys', 'Singles'],
    ['Noah Williams', 'Liam Chen', 'Liam Chen', '4-6', 'Boys', 'Singles'],
    ['Liam Chen', 'Ethan Kim', 'Liam Chen', '7-5', 'Boys', 'Singles'],
  ]]]);

  await assert.rejects(
    certainty.interpretWorkbookBuffer(buffer, { XLSX, importer, runtime, ai: ai.client, source: 'file' }),
    error => error?.code === 'WORKBOOK_CERTAINTY_BLOCKED' && /85% certainty threshold/.test(error.message),
  );
  assert.equal(ai.calls, 1);
});

test('a workbook imports valid score sheets while ignoring empty divisions and reference tabs', async () => {
  const ai = { calls: 0 };
  ai.client = {
    async enhanceRows(rows, { sourceName }) {
      ai.calls += 1;
      const hints = importer.sectionHints(sourceName);
      const mapped = rows.map(row => {
        const player1 = String(row.Player || '').trim();
        const player2 = String(row.Opponent || '').trim();
        const winner = String(row['Won?'] || '').trim();
        return {
          player1,
          player2,
          winner,
          loser: winner.toLowerCase() === player1.toLowerCase() ? player2 : player1,
          score: String(row.Score || '').trim(),
          ...hints,
          __sourceRow: row.__sourceRow,
          __sheetName: sourceName,
        };
      });
      mapped.__analysis = { ai: { confidence: 0.96, model: 'QA', mappings: [{ target: 'winner', confidence: 0.96 }] } };
      return mapped;
    },
  };
  const results = [
    ['Date', 'Player', 'Opponent', 'Won?', 'Score'],
    ['2026-10-19', 'Player A', 'Player B', 'Player A', '6-3'],
    ['2026-10-20', 'Player A', 'Player C', 'Player C', '6-4'],
  ];
  const buffer = workbookBuffer([
    ['BoysS', results],
    ['GirlsS', [
      ['Date', 'Player', 'Opponent', 'Won?', 'Score'],
      ['2026-10-19', 'Player C', 'Player D', 'Player C', '6-4'],
      ['2026-10-20', 'Player C', 'Player A', 'Player A', '6-2'],
    ]],
    ['GirlsD', [['Date', 'Team 1', 'Team 2', 'Won?', 'Score']]],
    ['MD', [['Date', 'Team 1', 'Team 2', 'Won?', 'Score']]],
    ['Rules', [['Description', 'Win points'], ['Win without tiebreak', 1]]],
    ['Enums', [['Boys', 'Player A', 'Player B'], ['Girls', 'Player C', 'Player D']]],
  ]);

  const rows = await certainty.interpretWorkbookBuffer(buffer, { XLSX, importer, runtime, ai: ai.client, source: 'file' });

  assert.ok(ai.calls <= 2, 'empty and reference worksheets must not reach verification');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.__analysis.sheets, ['BoysS', 'GirlsS']);
  assert.deepEqual(rows.__analysis.rejectedSheets.map(sheet => sheet.name), ['GirlsD', 'MD', 'Rules', 'Enums']);
  assert.deepEqual(rows.slice(0, 2).map(row => [row.gender, row.division]), [
    ['Boys', 'Singles'],
    ['Boys', 'Singles'],
  ]);
  assert.deepEqual(rows.slice(2).map(row => [row.gender, row.division]), [
    ['Girls', 'Singles'],
    ['Girls', 'Singles'],
  ]);

  const emptyOnly = workbookBuffer([
    ['GirlsD', [['Date', 'Team 1', 'Team 2', 'Won?', 'Score']]],
    ['MD', [['Date', 'Team 1', 'Team 2', 'Won?', 'Score']]],
  ]);
  await assert.rejects(
    certainty.interpretWorkbookBuffer(emptyOnly, { XLSX, importer, runtime, ai: ai.client, source: 'file' }),
    error => error?.code === 'NO_VERIFIED_WORKSHEETS' && !/85% certainty threshold/.test(error.message),
  );
});

console.log('Certainty workbook tests passed: clear sheets skip AI, ambiguous sheets are checked, and empty/reference tabs are safely ignored.');
