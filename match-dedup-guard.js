(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.TennisRankMatchDedupGuard = api;
    if (root.document) api.schedule(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function text(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function compact(value) {
    return text(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function valueFor(row, aliases) {
    if (!row || typeof row !== 'object') return '';
    const compat = typeof globalThis !== 'undefined' ? globalThis.TennisRankMatchResultCompat : null;
    if (compat?.valueFor) return compat.valueFor(row, aliases);
    const targets = new Set((aliases || []).map(compact));
    for (const [key, value] of Object.entries(row)) {
      if (String(key).startsWith('__') || !text(value)) continue;
      if (targets.has(compact(key))) return text(value);
    }
    return '';
  }

  function setHidden(row, key, value) {
    try { Object.defineProperty(row, key, { value, writable: true, configurable: true, enumerable: false }); }
    catch { row[key] = value; }
  }

  function matchParts(row) {
    const winner = text(row?.winner || valueFor(row, ['winner', 'wonby', 'victor', 'winningplayer']));
    const loser = text(row?.loser || valueFor(row, ['loser', 'lostto', 'defeated', 'losingplayer']));
    const score = text(valueFor(row, ['score', 'resultscore', 'gamescore', 'sets']));
    const date = text(valueFor(row, ['date', 'matchdate', 'playedon', 'timestamp']));
    if (!winner || !loser || !score || !date) return null;
    const gender = text(row?.gender || row?.sex || row?.__contextGender);
    const division = text(row?.division || row?.format || row?.event || row?.matchtype || row?.__contextDivision);
    const matchId = text(valueFor(row, ['matchid', 'match id', 'fixtureid', 'fixture id', 'matchnumber', 'match number', 'matchno']));
    const round = text(valueFor(row, ['round', 'flight', 'drawround']));
    const court = text(valueFor(row, ['court', 'courtname', 'court number', 'courtnumber']));
    const time = text(valueFor(row, ['time', 'matchtime', 'starttime']));
    const qualifier = [matchId, round, court, time].map(compact).join('|');
    return { winner, loser, score, date, gender, division, qualifier };
  }

  function exactMatchSignature(row) {
    const part = matchParts(row);
    if (!part) return '';
    return [part.gender, part.division, part.winner, part.loser, part.score, part.date, part.qualifier].map(compact).join('|');
  }

  function contestSignature(row) {
    const part = matchParts(row);
    if (!part) return '';
    const sides = [compact(part.winner), compact(part.loser)].sort();
    return [compact(part.gender), compact(part.division), sides[0], sides[1], compact(part.score), compact(part.date), part.qualifier].join('|');
  }

  function normalizeRows(rows, compatOverride) {
    if (!Array.isArray(rows)) return rows;
    const compat = compatOverride || (typeof globalThis !== 'undefined' ? globalThis.TennisRankMatchResultCompat : null);
    if (compat?.normalizeRows && compat.normalizeRows !== normalizeRows) compat.normalizeRows(rows);

    const exact = new Set();
    const contests = new Map();
    const kept = [];
    let duplicatesRemoved = 0;
    let conflicts = 0;

    for (const row of rows) {
      compat?.normalizeRow?.(row);
      const exactKey = exactMatchSignature(row);
      if (exactKey && exact.has(exactKey)) {
        duplicatesRemoved += 1;
        continue;
      }
      if (exactKey) exact.add(exactKey);

      const contestKey = contestSignature(row);
      if (contestKey) {
        const part = matchParts(row);
        const previous = contests.get(contestKey);
        if (previous && compact(previous.part.winner) !== compact(part.winner)) {
          const message = `Conflicting duplicate match: ${part.winner} and ${previous.part.winner} are both marked as the winner for the same dated score.`;
          setHidden(previous.row, '__importConflict', message);
          setHidden(row, '__importConflict', message);
          conflicts += 1;
        } else if (!previous) {
          contests.set(contestKey, { row, part });
        }
      }
      kept.push(row);
    }

    if (kept.length !== rows.length) rows.splice(0, rows.length, ...kept);
    setHidden(rows, '__duplicatesRemoved', duplicatesRemoved);
    setHidden(rows, '__matchConflicts', conflicts);
    return rows;
  }

  function conflictRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row => text(row?.__importConflict));
  }

  function conflictError(rows) {
    const conflicts = conflictRows(rows);
    const error = new Error(`${conflicts.length} conflicting duplicate match row${conflicts.length === 1 ? '' : 's'} were found. Fix the winner/result for that match or add a Match ID/round/time so separate matches can be distinguished.`);
    error.code = 'CONFLICTING_MATCH_ROWS';
    error.rows = rows;
    return error;
  }

  function installImporter(importer, compat) {
    if (!importer?.parseText) return false;

    if (!importer.parseText.__matchDedupGuard) {
      const baseParse = importer.parseText;
      const wrappedParse = function matchDedupParse() {
        const rows = normalizeRows(baseParse.apply(this, arguments), compat);
        if (conflictRows(rows).length) throw conflictError(rows);
        return rows;
      };
      wrappedParse.__matchDedupGuard = true;
      wrappedParse.__baseParseText = baseParse;
      importer.parseText = wrappedParse;
    }

    if (typeof importer.validateInterpretation === 'function' && !importer.validateInterpretation.__matchDedupGuard) {
      const baseValidate = importer.validateInterpretation;
      const wrappedValidate = function matchDedupValidation(rows) {
        normalizeRows(rows, compat);
        const conflicts = conflictRows(rows);
        if (conflicts.length) {
          return { valid: false, confidence: 0, level: 'LOW', reason: conflictError(rows).message };
        }
        return baseValidate.apply(this, arguments);
      };
      wrappedValidate.__matchDedupGuard = true;
      wrappedValidate.__baseValidateInterpretation = baseValidate;
      importer.validateInterpretation = wrappedValidate;
    }
    return true;
  }

  function install(win) {
    if (!win) return false;
    const compat = win.TennisRankMatchResultCompat;
    const importer = win.TennisRankImportV2;
    const importerReady = installImporter(importer, compat);
    let loaderReady = false;

    if (typeof win.loadRows === 'function') {
      if (!win.loadRows.__matchDedupGuard) {
        const baseLoad = win.loadRows;
        const wrappedLoad = function matchDedupLoad(rows) {
          normalizeRows(rows, compat);
          return baseLoad.apply(this, arguments);
        };
        wrappedLoad.__matchDedupGuard = true;
        wrappedLoad.__baseLoadRows = baseLoad;
        win.loadRows = wrappedLoad;
      }
      loaderReady = true;
    }
    return importerReady || loaderReady;
  }

  function schedule(win) {
    const apply = () => install(win);
    apply();
    win?.document?.addEventListener?.('DOMContentLoaded', apply, { once: true });
    win?.addEventListener?.('tennisrank:auth-ready', apply);
    win?.addEventListener?.('tennisrank:coach-data-changed', apply);
    for (const delay of [25, 100, 300, 800, 1800]) win?.setTimeout?.(apply, delay);
  }

  return {
    text,
    compact,
    matchParts,
    exactMatchSignature,
    contestSignature,
    normalizeRows,
    conflictRows,
    conflictError,
    installImporter,
    install,
    schedule,
  };
});
