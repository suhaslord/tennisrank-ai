(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.TennisRankMatchResultCompat = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function compact(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function sameParticipant(a, b) {
    const left = compact(a);
    const right = compact(b);
    return Boolean(left && right && left === right);
  }

  function normalizeRow(row) {
    if (!row || typeof row !== 'object') return row;

    const player = String(row.name || row.player || '').trim();
    const opponent = String(row.opponent || '').trim();
    if (!player || !opponent || row.loser) return row;

    const winnerCell = String(row.winner || row.result || '').trim();
    if (!winnerCell) return row;

    if (sameParticipant(winnerCell, player)) {
      row.winner = player;
      row.loser = opponent;
      return row;
    }
    if (sameParticipant(winnerCell, opponent)) {
      row.winner = opponent;
      row.loser = player;
      return row;
    }

    if (/^(w|win|won|winner|yes|y|true)$/i.test(winnerCell)) {
      row.winner = player;
      row.loser = opponent;
      return row;
    }
    if (/^(l|loss|lost|loser|no|n|false)$/i.test(winnerCell)) {
      row.winner = opponent;
      row.loser = player;
      return row;
    }

    return row;
  }

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) return rows;
    rows.forEach(normalizeRow);
    return rows;
  }

  function installBrowser(win) {
    if (!win || typeof win.loadRows !== 'function') return false;
    if (win.loadRows.__matchResultCompat) return true;

    const base = win.loadRows;
    const wrapped = function matchResultCompatibleLoadRows(rows, source) {
      normalizeRows(rows);
      return base.call(this, rows, source);
    };
    wrapped.__matchResultCompat = true;
    wrapped.__baseLoadRows = base;
    win.loadRows = wrapped;
    return true;
  }

  return { compact, sameParticipant, normalizeRow, normalizeRows, installBrowser };
});
