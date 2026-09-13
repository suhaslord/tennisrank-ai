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
    return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
  }

  function normalizeMatchRow(row, sheetName) {
    if (!row || typeof row !== 'object') return row;
    const hints = compactSheetHints(sheetName || row.__sheetName || '');
    if (hints.gender && !row.gender) row.gender = hints.gender;
    if (hints.division && !row.division) row.division = hints.division;
    if (sheetName && !row.__sheetName) row.__sheetName = sheetName;

    const player = String(row.name || row.player || '').trim();
    const opponent = String(row.opponent || '').trim();
    const winner = String(row.winner || '').trim();
    if (!player || !opponent || !winner || row.loser) return row;

    if (sameParticipant(winner, player)) {
      row.winner = player;
      row.loser = opponent;
    } else if (sameParticipant(winner, opponent)) {
      row.winner = opponent;
      row.loser = player;
    } else if (/^(w|win|won|yes|y|true)$/i.test(winner)) {
      row.winner = player;
      row.loser = opponent;
    } else if (/^(l|loss|lost|no|n|false)$/i.test(winner)) {
      row.winner = opponent;
      row.loser = player;
    } else if (/^(player\s*a|player\s*1|side\s*a|side\s*1|first)$/i.test(winner)) {
      row.winner = player;
      row.loser = opponent;
    } else if (/^(player\s*b|player\s*2|side\s*b|side\s*2|second)$/i.test(winner)) {
      row.winner = opponent;
      row.loser = player;
    } else {
      row.__importWarning = `Winner “${winner}” does not match Player “${player}” or Opponent “${opponent}”.`;
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

  async function parseWorkbook(buffer) {
    const importer = win.TennisRankImportV2;
    const XLSX = win.XLSX;
    if (!importer?.parseText) throw new Error('The TennisRank spreadsheet importer is still loading.');
    if (!XLSX?.read || !XLSX?.utils?.sheet_to_csv) throw new Error('Spreadsheet support is still loading. Try again in a moment.');

    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const merged = [];
    const acceptedSheets = [];
    const ignoredSheets = [];

    for (const name of workbook.SheetNames || []) {
      const sheet = workbook.Sheets?.[name];
      if (!sheet) continue;
      const text = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ',', RS: '\n' });
      if (!String(text || '').trim()) {
        ignoredSheets.push(name);
        continue;
      }
      const rows = importer.parseText(text, name);
      if (!Array.isArray(rows) || !rows.length) {
        ignoredSheets.push(name);
        continue;
      }
      rows.forEach(row => {
        normalizeMatchRow(row, name);
        merged.push(row);
      });
      acceptedSheets.push(name);
    }

    if (!merged.length) throw new Error('No usable tennis rows were found in this Google Sheet.');
    merged.__analysis = {
      headerRow: 1,
      delimiter: 'workbook',
      columns: [],
      mapping: [],
      sourceName: acceptedSheets.join(', '),
      sheets: acceptedSheets,
      rejectedSheets: ignoredSheets.map(name => ({ name, reason: 'Empty or no usable rows.' })),
      engine: 'google-full-workbook-v1',
    };
    return merged;
  }

  async function importGoogleWorkbook(input, button) {
    setBusy(button, true);
    setStatus('Loading the full Google Sheet workbook...');
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
        note.textContent = `Warning: ${warnings} row${warnings === 1 ? '' : 's'} have a winner that does not match Player or Opponent. Those results were not guessed.`;
      }

      if (warnings) {
        setStatus(`Loaded ${rows.length} rows from ${rows.__analysis.sheets.length} worksheet(s), with ${warnings} result warning${warnings === 1 ? '' : 's'}. Review the preview before publishing.`, true);
      } else {
        setStatus(`Loaded ${rows.length} rows from ${rows.__analysis.sheets.length} worksheet(s). Review the preview before publishing.`);
      }

      if (typeof win.syncToBackend === 'function') await win.syncToBackend();
      if (typeof win.startRefresh === 'function') win.startRefresh();
      setStatus(warnings
        ? `Published the valid workbook data with ${warnings} unresolved result warning${warnings === 1 ? '' : 's'} left unguessed.`
        : 'Google Sheet verified and saved.');
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
    parseWorkbook,
    importGoogleWorkbook,
  };
})(window);
