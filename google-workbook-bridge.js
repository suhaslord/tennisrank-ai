(function (win) {
  'use strict';

  const doc = win.document;
  if (!doc || win.__tennisRankGoogleWorkbookBridge) return;
  win.__tennisRankGoogleWorkbookBridge = true;

  function isStandardGoogleSheet(input) {
    try {
      const url = new URL(String(input || '').trim());
      return url.protocol === 'https:'
        && url.hostname.toLowerCase() === 'docs.google.com'
        && /\/spreadsheets\/(?:u\/\d+\/)?d\/[^/]+/i.test(url.pathname)
        && !/\/spreadsheets\/d\/e\//i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function workbookProxyUrl(input) {
    return `/api/sheet-workbook?url=${encodeURIComponent(String(input || '').trim())}`;
  }

  function compactSheetHints(name) {
    const compact = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    let gender = '';
    let division = '';
    if (/^(boys?|men|male)/.test(compact) || /^(bs|bd)$/.test(compact)) gender = 'Boys';
    else if (/^(girls?|women|female)/.test(compact) || /^(gs|gd)$/.test(compact)) gender = 'Girls';
    if (/singles?/.test(compact) || /^(boyss|girlss|bs|gs)$/.test(compact)) division = 'Singles';
    else if (/doubles?/.test(compact) || /^(boysd|girlsd|bd|gd)$/.test(compact)) division = 'Doubles';
    return { gender, division };
  }

  function comparable(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function sameParticipant(a, b) {
    const left = comparable(a);
    const right = comparable(b);
    return Boolean(left && right && left === right);
  }

  function normalizeMatchRow(row, sheetName) {
    if (!row || typeof row !== 'object') return row;
    const hints = compactSheetHints(sheetName || row.__sheetName || '');
    if (hints.gender && !row.gender) row.gender = hints.gender;
    if (hints.division && !row.division) row.division = hints.division;
    if (sheetName && !row.__sheetName) row.__sheetName = sheetName;

    if (win.TennisRankUniversalImport?.normalizeCanonicalRow) {
      win.TennisRankUniversalImport.normalizeCanonicalRow(row);
    }

    const player = String(row.name || row.player || '').trim();
    const opponent = String(row.opponent || '').trim();
    const player1 = String(row.player1 || '').trim();
    const player2 = String(row.player2 || '').trim();
    const winner = String(row.winner || row.result || '').trim();

    if (!row.loser && player && opponent && winner) {
      if (sameParticipant(winner, player) || /^(w|win|won|yes|y|true|home|host|first)$/i.test(winner)) {
        row.winner = player; row.loser = opponent;
      } else if (sameParticipant(winner, opponent) || /^(l|loss|lost|no|n|false|away|visitor|guest|second)$/i.test(winner)) {
        row.winner = opponent; row.loser = player;
      }
    }

    if (!row.loser && player1 && player2 && winner) {
      const pointer = comparable(winner);
      if (sameParticipant(winner, player1) || /^(w|win|won|yes|y|true|home|host|first)$/i.test(winner) || ['a','1','playera','player1','teama','team1','sidea','side1'].includes(pointer)) {
        row.winner = player1; row.loser = player2;
      } else if (sameParticipant(winner, player2) || /^(l|loss|lost|no|n|false|away|visitor|guest|second)$/i.test(winner) || ['b','2','playerb','player2','teamb','team2','sideb','side2'].includes(pointer)) {
        row.winner = player2; row.loser = player1;
      }
    }

    if ((player && opponent && winner) || (player1 && player2 && winner)) {
      if (!row.loser) row.__importWarning = `Result “${winner}” could not be matched safely to the two competitors.`;
      else delete row.__importWarning;
    }
    return row;
  }

  function warningCount(rows) {
    return (rows || []).filter(row => String(row?.__importWarning || '').trim()).length;
  }

  async function errorMessage(response, fallback) {
    try {
      const payload = await response.clone().json();
      if (payload?.error) return payload.error;
    } catch {}
    return `${fallback} (${response.status}).`;
  }

  function setBusy(button, busy) {
    if (typeof win.setBusy === 'function') return win.setBusy(button, busy);
    if (!button) return;
    button.disabled = Boolean(busy);
    button.setAttribute('aria-busy', String(Boolean(busy)));
  }

  function setStatus(message, error) {
    if (typeof win.setStatus === 'function') win.setStatus(message, error);
  }

  async function parseWorksheet(name, text, importer) {
    const runtime = win.TennisRankImportRuntime;
    if (runtime?.prepareWorksheet) {
      const prepared = await runtime.prepareWorksheet({ name, text }, importer);
      if (!prepared?.accepted || !Array.isArray(prepared.rows) || !prepared.rows.length) {
        return { accepted: false, reason: prepared?.reason || 'No usable tennis rows.' };
      }
      return { accepted: true, rows: prepared.rows, review: prepared.review };
    }
    const rows = importer.parseText(text, name);
    return Array.isArray(rows) && rows.length ? { accepted: true, rows } : { accepted: false, reason: 'No usable tennis rows.' };
  }

  async function parseWorkbook(buffer) {
    const importer = win.TennisRankImportV2;
    const XLSX = win.XLSX;
    if (!importer?.parseText) throw new Error('The TennisRank spreadsheet importer is still loading.');
    if (!XLSX?.read || !XLSX?.utils?.sheet_to_csv) throw new Error('Spreadsheet support is still loading. Try again in a moment.');

    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const merged = [];
    const acceptedSheets = [];
    const ignoredSheets = [];
    const sheetAnalyses = [];

    for (const name of workbook.SheetNames || []) {
      const sheet = workbook.Sheets?.[name];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ',', RS: '\n' });
      if (!String(csv || '').trim()) {
        ignoredSheets.push({ name, reason: 'Empty worksheet.' });
        continue;
      }

      let prepared;
      try {
        prepared = await parseWorksheet(name, csv, importer);
      } catch (error) {
        ignoredSheets.push({ name, reason: error?.message || 'Could not interpret worksheet.' });
        continue;
      }
      if (!prepared.accepted) {
        ignoredSheets.push({ name, reason: prepared.reason });
        continue;
      }

      prepared.rows.forEach(row => {
        normalizeMatchRow(row, name);
        merged.push(row);
      });
      acceptedSheets.push(name);
      if (prepared.rows.__analysis) sheetAnalyses.push({ sheetName: name, ...prepared.rows.__analysis });
    }

    if (!merged.length) {
      const details = ignoredSheets.slice(0, 3).map(item => `${item.name}: ${item.reason}`).join(' ');
      throw new Error(`No usable tennis rows were found in this Google Sheet.${details ? ` ${details}` : ''}`);
    }
    merged.__analysis = {
      headerRow: 1,
      delimiter: 'workbook',
      columns: [],
      mapping: sheetAnalyses.flatMap(item => item.mapping || []),
      sourceName: acceptedSheets.join(', '),
      sheets: acceptedSheets,
      rejectedSheets: ignoredSheets,
      sheetAnalyses,
      engine: 'google-full-workbook-universal-v2',
    };
    return merged;
  }

  async function importGoogleWorkbook(input, button) {
    setBusy(button, true);
    setStatus('Loading every worksheet and detecting its tennis data structure...');
    try {
      const response = await win.fetch(workbookProxyUrl(input), { cache: 'no-store' });
      if (!response.ok) throw new Error(await errorMessage(response, 'The Google Sheet could not be loaded'));
      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength) throw new Error('Google returned an empty workbook.');

      const rows = await parseWorkbook(buffer);
      const warnings = warningCount(rows);
      win.localStorage?.setItem('tennisRankSheetUrl', input);
      if (typeof win.loadRows !== 'function') throw new Error('The TennisRank importer is not ready yet.');
      win.loadRows(rows, 'sheet');

      const note = doc.querySelector('#analyzerNote');
      if (note && warnings) {
        note.dataset.coachImportWarning = 'true';
        note.textContent = `Warning: ${warnings} row${warnings === 1 ? '' : 's'} could not be resolved safely. TennisRank kept them visible for review instead of guessing.`;
      }

      const rejected = rows.__analysis.rejectedSheets?.length || 0;
      if (warnings || rejected) {
        setStatus(`Loaded ${rows.length} rows from ${rows.__analysis.sheets.length} worksheet(s). ${warnings ? `${warnings} row warning${warnings === 1 ? '' : 's'}. ` : ''}${rejected ? `${rejected} non-data/ambiguous tab${rejected === 1 ? '' : 's'} skipped. ` : ''}Review before publishing.`, Boolean(warnings));
      } else {
        setStatus(`Loaded ${rows.length} rows from ${rows.__analysis.sheets.length} worksheet(s). Structure detected automatically.`);
      }

      if (typeof win.syncToBackend === 'function') await win.syncToBackend();
      if (typeof win.startRefresh === 'function') win.startRefresh();
      setStatus(warnings
        ? `Published all safely understood results; ${warnings} unresolved row${warnings === 1 ? '' : 's'} were left unguessed.`
        : 'Google Sheet understood, verified, and saved.');
      win.dispatchEvent(new CustomEvent('tennisrank:coach-data-changed', { detail: { source: 'google-workbook', rows: rows.length, warnings } }));
      return rows;
    } finally {
      setBusy(button, false);
    }
  }

  doc.addEventListener('click', event => {
    const button = event.target?.closest?.('#connectSheet');
    if (!button) return;
    const input = String(doc.querySelector('#sheetUrl')?.value || win.localStorage?.getItem('tennisRankSheetUrl') || '').trim();
    if (!isStandardGoogleSheet(input)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    importGoogleWorkbook(input, button).catch(error => {
      setStatus(error?.message || 'The Google Sheet could not be imported.', true);
      setBusy(button, false);
    });
  }, true);

  win.TennisRankGoogleWorkbookBridge = {
    isStandardGoogleSheet,
    workbookProxyUrl,
    compactSheetHints,
    normalizeMatchRow,
    warningCount,
    parseWorksheet,
    parseWorkbook,
    importGoogleWorkbook,
  };
})(window);
