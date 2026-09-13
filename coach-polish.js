(function () {
  'use strict';

  function explicitGid(url) {
    return url.hash.match(/(?:^|[&#])gid=(\d+)/)?.[1] || url.searchParams.get('gid') || '';
  }

  function googleCsvTarget(input) {
    let url;
    try { url = new URL(String(input || '').trim()); }
    catch { throw new Error('Enter a valid spreadsheet link.'); }

    const host = url.hostname.toLowerCase();
    const gid = explicitGid(url);
    const gidSuffix = gid ? `&gid=${encodeURIComponent(gid)}` : '';

    if (host === 'docs.google.com') {
      const published = url.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)/i);
      if (published) return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gidSuffix}`;

      const standard = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)/i);
      if (standard) return `https://docs.google.com/spreadsheets/d/${standard[1]}/export?format=csv${gidSuffix}`;
    }

    if (host === 'drive.google.com') {
      const id = url.searchParams.get('id');
      if (id) return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gidSuffix}`;
    }

    return url.href;
  }

  function googleCsvProxy(input) {
    const target = googleCsvTarget(input);
    const parsed = new URL(target);
    return parsed.hostname.toLowerCase() === 'docs.google.com'
      ? `/api/sheet-proxy?url=${encodeURIComponent(target)}`
      : target;
  }

  function googleWorkbookProxy(input) {
    let url;
    try { url = new URL(String(input || '').trim()); }
    catch { throw new Error('Enter a valid spreadsheet link.'); }
    return `/api/sheet-workbook?url=${encodeURIComponent(url.href)}`;
  }

  function isStandardGoogleWorkbookLink(input) {
    try {
      const url = new URL(String(input || '').trim());
      return url.hostname.toLowerCase() === 'docs.google.com'
        && /\/spreadsheets\/(?:u\/\d+\/)?d\/[^/]+/i.test(url.pathname)
        && !/\/spreadsheets\/d\/e\//i.test(url.pathname)
        && !explicitGid(url);
    } catch {
      return false;
    }
  }

  function compactSheetHints(name) {
    const text = String(name || '').trim();
    const compact = text.toLowerCase().replace(/[^a-z0-9]/g, '');
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

  function normalizeCoachRow(row) {
    if (!row || typeof row !== 'object') return row;
    const hints = compactSheetHints(row.__sheetName || '');
    if (hints.gender && !row.gender) row.gender = hints.gender;
    if (hints.division && !row.division) row.division = hints.division;

    const player = String(row.name || row.player || '').trim();
    const opponent = String(row.opponent || '').trim();
    const winner = String(row.winner || '').trim();

    if (player && opponent && winner && !row.loser) {
      if (sameParticipant(winner, player)) row.loser = opponent;
      else if (sameParticipant(winner, opponent)) row.loser = player;
      else if (/^(a|1|playera|player1|first)$/i.test(winner)) {
        row.winner = player;
        row.loser = opponent;
      } else if (/^(b|2|playerb|player2|second)$/i.test(winner)) {
        row.winner = opponent;
        row.loser = player;
      } else {
        row.__importWarning = `Winner “${winner}” does not match ${player} or ${opponent}.`;
      }
    }

    return row;
  }

  function normalizeCoachRows(rows) {
    if (!Array.isArray(rows)) return rows;
    rows.forEach(normalizeCoachRow);
    return rows;
  }

  function installRowNormalization(win) {
    if (win.__tennisRankCoachLoadRowsWrapped || typeof win.loadRows !== 'function') return;
    const original = win.loadRows;
    win.loadRows = function coachReadyLoadRows(rows, source) {
      normalizeCoachRows(rows);
      return original.call(this, rows, source);
    };
    win.__tennisRankCoachLoadRowsWrapped = true;
  }

  function installSheetLinkFix(win) {
    win.googleCsvUrl = googleCsvProxy;
    if (win.TennisRankImportV2) {
      win.TennisRankImportV2.googleCsvUrl = googleCsvTarget;
      win.TennisRankImportV2.googleCsvProxyUrl = googleCsvProxy;
    }
  }

  function installDataGuide(win) {
    const guide = win.document.querySelector('.format-guide');
    if (!guide || guide.dataset.matchFormatReady === 'true') return;
    guide.dataset.matchFormatReady = 'true';
    const strong = guide.querySelector('strong');
    const code = guide.querySelector('code');
    const note = guide.querySelector('span');
    if (strong) strong.textContent = 'Supported match columns';
    if (code) code.textContent = 'Player · Opponent · Won? · Score  OR  Player 1 · Player 2 · Winner · Loser · Score';
    if (note) note.textContent = 'Tabs named BoysS, GirlsS, BoysD, or GirlsD are recognized automatically. In “Won?”, enter the winning player or team name. Score and Date are optional.';
  }

  function setBusyFallback(win, button, busy) {
    if (typeof win.setBusy === 'function') {
      win.setBusy(button, busy);
      return;
    }
    if (!button) return;
    button.disabled = Boolean(busy);
    button.setAttribute('aria-busy', String(Boolean(busy)));
  }

  function setStatusFallback(win, message, error) {
    if (typeof win.setStatus === 'function') {
      win.setStatus(message, error);
      return;
    }
    const status = win.document.querySelector('#importStatus, #dataStatus, .data-status');
    if (status) {
      status.textContent = String(message || '');
      status.classList.toggle('error', Boolean(error));
    }
  }

  async function responseError(response, fallback) {
    try {
      const body = await response.clone().json();
      if (body?.error) return body.error;
    } catch {}
    return `${fallback} (${response.status}).`;
  }

  async function loadGoogleWorkbookRows(win, input) {
    if (!win.XLSX || typeof win.XLSX.read !== 'function') {
      throw new Error('Spreadsheet support is still loading. Try again in a moment.');
    }
    if (!win.TennisRankImportV2 || typeof win.TennisRankImportV2.parseText !== 'function') {
      throw new Error('The TennisRank importer is not ready yet.');
    }

    const response = await win.fetch(googleWorkbookProxy(input), { cache: 'no-store' });
    if (!response.ok) throw new Error(await responseError(response, 'The workbook could not be loaded'));
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error('The workbook did not contain any data.');

    const workbook = win.XLSX.read(buffer, { type: 'array', cellDates: true });
    const merged = [];
    const sheetNames = [];
    for (const name of workbook.SheetNames || []) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const text = win.XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ',', RS: '\n' });
      if (!String(text || '').trim()) continue;
      const rows = win.TennisRankImportV2.parseText(text, name);
      if (!rows.length) continue;
      normalizeCoachRows(rows);
      rows.forEach(row => {
        if (!row.__sheetName) row.__sheetName = name;
        normalizeCoachRow(row);
        merged.push(row);
      });
      sheetNames.push(name);
    }

    if (!merged.length) throw new Error('No usable tennis rows were found in this Google Sheet.');
    merged.__analysis = {
      headerRow: 1,
      delimiter: 'workbook',
      columns: [],
      mapping: [],
      sourceName: sheetNames.join(', '),
      sheets: sheetNames,
      engine: 'coach-workbook-v1',
    };
    return merged;
  }

  async function connectGoogleWorkbook(win, button, input) {
    setBusyFallback(win, button, true);
    setStatusFallback(win, 'Loading every worksheet from Google Sheets...');
    try {
      const rows = await loadGoogleWorkbookRows(win, input);
      win.localStorage?.setItem('tennisRankSheetUrl', input);
      if (typeof win.loadRows !== 'function') throw new Error('The TennisRank importer is not ready yet.');
      win.loadRows(rows, 'sheet');

      let saved = false;
      if (typeof win.syncToBackend === 'function') {
        try {
          await win.syncToBackend();
          saved = true;
        } catch (error) {
          setStatusFallback(win, `Loaded ${rows.length} rows from ${rows.__analysis?.sheets?.length || 1} worksheet(s). ${error.message}`, true);
        }
      }
      if (typeof win.startRefresh === 'function') win.startRefresh();
      if (saved) setStatusFallback(win, `Loaded and saved ${rows.length} rows from ${rows.__analysis?.sheets?.length || 1} worksheet(s).`);
      else if (typeof win.syncToBackend !== 'function') setStatusFallback(win, `Loaded ${rows.length} rows from ${rows.__analysis?.sheets?.length || 1} worksheet(s).`);
      win.dispatchEvent(new CustomEvent('tennisrank:coach-data-changed', { detail: { source: 'google-workbook', rows: rows.length } }));
    } catch (error) {
      setStatusFallback(win, error.message || 'The Google Sheet could not be loaded.', true);
    } finally {
      setBusyFallback(win, button, false);
    }
  }

  function installGoogleWorkbookImport(win) {
    const button = win.document.querySelector('#connectSheet');
    if (!button || button.dataset.workbookImportReady === 'true') return;
    button.dataset.workbookImportReady = 'true';
    button.addEventListener('click', event => {
      const input = win.document.querySelector('#sheetUrl')?.value?.trim() || '';
      if (!isStandardGoogleWorkbookLink(input)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      connectGoogleWorkbook(win, button, input);
    }, true);
  }

  function scrollTo(win, selector) {
    const target = win.document.querySelector(selector);
    if (!target) return false;
    if (target.hidden) target.hidden = false;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  function button(label, icon, action) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'secondary-button coach-quick-action';
    el.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i><span>${label}</span>`;
    el.addEventListener('click', action);
    return el;
  }

  function install(win) {
    installSheetLinkFix(win);
    installDataGuide(win);
    installRowNormalization(win);
    installGoogleWorkbookImport(win);

    const dashboard = win.document.querySelector('#coachOpsDashboard');
    if (!dashboard || dashboard.dataset.polished === 'true') return false;
    dashboard.dataset.polished = 'true';

    const heading = dashboard.querySelector('.coach-ops-heading');
    if (heading) {
      const existingRefresh = heading.querySelector('#refreshCoachOps');
      const actions = win.document.createElement('div');
      actions.className = 'coach-heading-actions';
      actions.append(
        button('Import results', 'ph-upload-simple', () => {
          const opener = win.document.querySelector('#openSettings');
          if (opener) opener.click();
          win.setTimeout(() => scrollTo(win, '#settingsPanel'), 50);
        }),
        button('Player accounts', 'ph-users-three', () => scrollTo(win, '#accountsPanel')),
        button('Rankings', 'ph-ranking', () => scrollTo(win, '#rankingsSection')),
      );
      if (existingRefresh) actions.append(existingRefresh);
      heading.append(actions);
    }

    const guide = win.document.createElement('div');
    guide.className = 'coach-workflow-guide';
    guide.setAttribute('aria-label', 'Coach workflow');
    guide.innerHTML = `
      <div><b>1</b><span><strong>Import</strong><small>Connect the latest team results.</small></span></div>
      <div><b>2</b><span><strong>Review</strong><small>Check warnings and rank changes.</small></span></div>
      <div><b>3</b><span><strong>Publish</strong><small>Save only after the preview looks right.</small></span></div>
      <div><b>4</b><span><strong>Approve</strong><small>Handle pending scores and challenges.</small></span></div>`;
    const attention = dashboard.querySelector('#coachAttentionGrid');
    if (attention) {
      attention.setAttribute('aria-live', 'polite');
      attention.parentNode.insertBefore(guide, attention);
    }

    const needsAttention = dashboard.querySelector('#coachNeedsAttention');
    if (needsAttention) needsAttention.setAttribute('aria-live', 'polite');
    return true;
  }

  function boot(win) {
    installSheetLinkFix(win);
    installDataGuide(win);
    installRowNormalization(win);
    installGoogleWorkbookImport(win);
    if (install(win)) return;
    let attempts = 0;
    const timer = win.setInterval(() => {
      attempts += 1;
      installSheetLinkFix(win);
      installDataGuide(win);
      installRowNormalization(win);
      installGoogleWorkbookImport(win);
      if (install(win) || attempts >= 80) win.clearInterval(timer);
    }, 100);
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      explicitGid,
      googleCsvTarget,
      googleCsvProxy,
      googleWorkbookProxy,
      isStandardGoogleWorkbookLink,
      compactSheetHints,
      normalizeCoachRow,
      normalizeCoachRows,
    };
  }

  if (typeof window !== 'undefined' && window.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(window), { once: true });
    else boot(window);
    window.addEventListener('tennisrank:auth-ready', () => boot(window));
    window.addEventListener('tennisrank:coach-data-changed', () => boot(window));
  }
})();
