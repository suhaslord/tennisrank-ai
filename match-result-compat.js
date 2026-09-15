(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.TennisRankMatchResultCompat = api;
    if (root.document) api.scheduleBrowserInstall(root);
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

  function sameParticipant(a, b) {
    const left = compact(a);
    const right = compact(b);
    return Boolean(left && right && left === right);
  }

  function valueFor(row, aliases) {
    if (!row || typeof row !== 'object') return '';
    const targets = new Set((aliases || []).map(compact));
    for (const [key, value] of Object.entries(row)) {
      if (String(key).startsWith('__') || !text(value)) continue;
      if (targets.has(compact(key))) return text(value);
    }
    return '';
  }

  function splitPairNames(value) {
    return text(value)
      .replace(/\s+(?:and|vs\.?|versus)\s+/gi, '|')
      .replace(/\s*[&+/;|]\s*/g, '|')
      .split('|')
      .map(name => text(name))
      .filter(Boolean);
  }

  function pairLabel(values) {
    const names = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : [values]) {
      for (const name of splitPairNames(value)) {
        const key = compact(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }
    }
    if (!names.length) return '';
    return names.length === 1 ? names[0] : names.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })).join(' & ');
  }

  function genderKind(value) {
    const key = compact(value);
    if (['m', 'male', 'boy', 'boys', 'man', 'men'].includes(key)) return 'boys';
    if (['f', 'female', 'girl', 'girls', 'woman', 'women'].includes(key)) return 'girls';
    if (['mixed', 'coed', 'xd', 'mxd'].includes(key)) return 'mixed';
    return '';
  }

  function pairGender(first, second) {
    const a = genderKind(first);
    const b = genderKind(second);
    if (!a || !b) return '';
    if (a === 'mixed' || b === 'mixed') return 'mixed';
    if (a !== b) return 'mixed';
    return a;
  }

  const PARTNER_HEADERS = new Map([
    ['partner', 'partner'], ['partnername', 'partner'], ['teammate', 'partner'], ['teammatename', 'partner'], ['doublespartner', 'partner'], ['playerpartner', 'partner'],
    ['opponentpartner', 'opponentPartner'], ['opponentpartnername', 'opponentPartner'], ['opposingpartner', 'opponentPartner'], ['opponentteammate', 'opponentPartner'], ['opponentteammatename', 'opponentPartner'], ['opppartner', 'opponentPartner'],
    ['partner1', 'partner1'], ['partnera', 'partner1'], ['player1partner', 'partner1'], ['team1partner', 'partner1'], ['teamapartner', 'partner1'], ['side1partner', 'partner1'], ['sideapartner', 'partner1'],
    ['partner2', 'partner2'], ['partnerb', 'partner2'], ['player2partner', 'partner2'], ['team2partner', 'partner2'], ['teambpartner', 'partner2'], ['side2partner', 'partner2'], ['sidebpartner', 'partner2'],
    ['winner1', 'winner1'], ['winnera', 'winner1'], ['winningplayer1', 'winner1'], ['winningteamplayer1', 'winner1'],
    ['winner2', 'winner2'], ['winnerb', 'winner2'], ['winnerpartner', 'winner2'], ['winningpartner', 'winner2'], ['winningplayer2', 'winner2'], ['winningteamplayer2', 'winner2'],
    ['loser1', 'loser1'], ['losera', 'loser1'], ['losingplayer1', 'loser1'], ['losingteamplayer1', 'loser1'],
    ['loser2', 'loser2'], ['loserb', 'loser2'], ['loserpartner', 'loser2'], ['losingpartner', 'loser2'], ['losingplayer2', 'loser2'], ['losingteamplayer2', 'loser2'],
    ['partnergender', 'partnerGender'], ['teammategender', 'partnerGender'], ['gender2', 'partnerGender'],
    ['playergender', 'playerGender'], ['gender1', 'playerGender'],
    ['player1gender', 'side1Gender'], ['team1gender', 'side1Gender'], ['side1gender', 'side1Gender'], ['teamagender', 'side1Gender'], ['sideagender', 'side1Gender'],
    ['partner1gender', 'side1PartnerGender'], ['team1partnergender', 'side1PartnerGender'], ['side1partnergender', 'side1PartnerGender'], ['partneragender', 'side1PartnerGender'],
    ['player2gender', 'side2Gender'], ['team2gender', 'side2Gender'], ['side2gender', 'side2Gender'], ['teambgender', 'side2Gender'], ['sidebgender', 'side2Gender'],
    ['partner2gender', 'side2PartnerGender'], ['team2partnergender', 'side2PartnerGender'], ['side2partnergender', 'side2PartnerGender'], ['partnerbgender', 'side2PartnerGender'],
  ]);

  function partnerFieldForHeader(value) {
    return PARTNER_HEADERS.get(compact(value)) || '';
  }

  function rawPartnerRows(textInput, importer) {
    if (!importer?.parseDelimited) return [];
    let parsed;
    try { parsed = importer.parseDelimited(String(textInput || '').replace(/^\uFEFF/, '')); }
    catch { return []; }
    const matrix = parsed?.matrix || [];
    if (matrix.length < 2) return [];
    let headerIndex = 0;
    try {
      const detected = importer.detectHeaderRow?.(matrix);
      if (Number.isInteger(detected?.index)) headerIndex = detected.index;
    } catch {}
    const headers = matrix[headerIndex] || [];
    const mapped = headers.map(partnerFieldForHeader);
    if (!mapped.some(Boolean)) return [];
    return matrix.slice(headerIndex + 1).map((values, offset) => {
      const row = { __sourceRow: headerIndex + offset + 2 };
      mapped.forEach((field, index) => {
        if (field && text(values?.[index])) row[field] = text(values[index]);
      });
      return row;
    });
  }

  function mergeRawPartnerColumns(rows, rawRows) {
    if (!Array.isArray(rows) || !Array.isArray(rawRows) || !rawRows.length) return rows;
    const bySource = new Map(rawRows.map(row => [Number(row.__sourceRow), row]));
    rows.forEach((row, index) => {
      const raw = bySource.get(Number(row?.__sourceRow)) || rawRows[index];
      if (!raw) return;
      Object.entries(raw).forEach(([key, value]) => {
        if (key === '__sourceRow' || !text(value) || text(row[key])) return;
        row[key] = value;
      });
    });
    return rows;
  }

  function setHidden(row, key, value) {
    try {
      Object.defineProperty(row, key, { value, writable: true, configurable: true, enumerable: false });
    } catch {
      row[key] = value;
    }
  }

  function normalizeDoublesPartners(row) {
    if (!row || typeof row !== 'object') return row;

    let partnerStyle = false;
    let primary = '';
    let selfPair = '';
    let sidePairLayout = false;

    const winner1 = valueFor(row, ['winner', 'winner1', 'winner a', 'winning player 1', 'winning team player 1']);
    const winner2 = valueFor(row, ['winner2', 'winner b', 'winner partner', 'winning partner', 'winning player 2', 'winning team player 2']);
    const loser1 = valueFor(row, ['loser', 'loser1', 'loser a', 'losing player 1', 'losing team player 1']);
    const loser2 = valueFor(row, ['loser2', 'loser b', 'loser partner', 'losing partner', 'losing player 2', 'losing team player 2']);

    if (winner1 && winner2 && loser1 && loser2) {
      row.winner = pairLabel([winner1, winner2]);
      row.loser = pairLabel([loser1, loser2]);
      partnerStyle = true;
    } else {
      primary = valueFor(row, ['name', 'player', 'athlete', 'player name']);
      const partner = valueFor(row, ['partner', 'partner name', 'teammate', 'team mate', 'doubles partner', 'player partner']);
      const opponent = valueFor(row, ['opponent', 'against', 'versus', 'opponent name']);
      const opponentPartner = valueFor(row, ['opponent partner', 'opponent partner name', 'opposing partner', 'opponent teammate', 'opponent team mate', 'opp partner', 'opponent2']);

      if (primary && partner && opponent && opponentPartner) {
        selfPair = pairLabel([primary, partner]);
        const otherPair = pairLabel([opponent, opponentPartner]);
        const signal = text(row.winner || row.result || row.outcome);
        if (sameParticipant(signal, primary) || sameParticipant(signal, selfPair) || /^(w|win|won|winner|yes|y|true)$/i.test(signal)) {
          row.winner = selfPair;
          row.loser = otherPair;
        } else if (sameParticipant(signal, opponent) || sameParticipant(signal, otherPair) || /^(l|loss|lost|loser|no|n|false)$/i.test(signal)) {
          row.winner = otherPair;
          row.loser = selfPair;
        }
        partnerStyle = true;
      } else {
        const player1 = valueFor(row, ['player1', 'player a', 'team a', 'team1', 'side1']);
        const partner1 = valueFor(row, ['partner1', 'partner a', 'player1 partner', 'team1 partner', 'team a partner', 'side1 partner']);
        const player2 = valueFor(row, ['player2', 'player b', 'team b', 'team2', 'side2']);
        const partner2 = valueFor(row, ['partner2', 'partner b', 'player2 partner', 'team2 partner', 'team b partner', 'side2 partner']);
        if (player1 && partner1 && player2 && partner2) {
          row.player1 = pairLabel([player1, partner1]);
          row.player2 = pairLabel([player2, partner2]);
          partnerStyle = true;
          sidePairLayout = true;
        }
      }
    }

    if (partnerStyle) {
      const divisionText = text(row.division || row.format || row.event || row.matchtype);
      if (!divisionText) row.division = 'Doubles';
      if (/\b(?:mixed|co[- ]?ed|coed|xd|mxd)\b/i.test(divisionText)) {
        row.gender = 'Mixed';
        row.division = 'Doubles';
      } else if (sidePairLayout) {
        const side1 = pairGender(
          valueFor(row, ['side1Gender', 'player1 gender', 'team1 gender', 'side1 gender', 'team a gender']),
          valueFor(row, ['side1PartnerGender', 'partner1 gender', 'team1 partner gender', 'side1 partner gender', 'partner a gender']),
        );
        const side2 = pairGender(
          valueFor(row, ['side2Gender', 'player2 gender', 'team2 gender', 'side2 gender', 'team b gender']),
          valueFor(row, ['side2PartnerGender', 'partner2 gender', 'team2 partner gender', 'side2 partner gender', 'partner b gender']),
        );
        if (side1 === 'mixed' || side2 === 'mixed') row.gender = 'Mixed';
        else if (side1 && side2 && side1 === side2) row.gender = side1 === 'boys' ? 'Boys' : 'Girls';
      } else {
        const playerGender = genderKind(valueFor(row, ['gender', 'player gender', 'playergender', 'gender1']));
        const partnerGender = genderKind(valueFor(row, ['partner gender', 'partnergender', 'gender2', 'teammate gender']));
        if ((playerGender === 'boys' && partnerGender === 'girls') || (playerGender === 'girls' && partnerGender === 'boys')) {
          row.gender = 'Mixed';
        }
      }
      setHidden(row, '__doublesPartnerStyle', true);
      if (primary && selfPair) {
        setHidden(row, '__doublesPrimary', compact(primary));
        setHidden(row, '__doublesPair', compact(selfPair));
      }
    }
    return row;
  }

  function normalizeTwoSideResult(row) {
    if (!row || row.loser) return row;
    const player1 = text(row.player1);
    const player2 = text(row.player2);
    const signal = text(row.winner || row.result || row.outcome);
    if (!player1 || !player2 || !signal) return row;
    const pointer = compact(signal);
    if (sameParticipant(signal, player1) || ['player1', 'playera', 'team1', 'teama', 'side1', 'sidea', '1', 'a', 'home', 'host', 'w', 'win', 'won'].includes(pointer)) {
      row.winner = player1;
      row.loser = player2;
      return row;
    }
    if (sameParticipant(signal, player2) || ['player2', 'playerb', 'team2', 'teamb', 'side2', 'sideb', '2', 'b', 'away', 'visitor', 'guest', 'l', 'loss', 'lost'].includes(pointer)) {
      row.winner = player2;
      row.loser = player1;
    }
    return row;
  }

  function normalizeRow(row) {
    if (!row || typeof row !== 'object') return row;
    normalizeDoublesPartners(row);
    normalizeTwoSideResult(row);

    const player = text(row.name || row.player || '');
    const opponent = text(row.opponent || '');
    if (!player || !opponent || row.loser) return row;

    const winnerCell = text(row.winner || row.result || '');
    if (!winnerCell) return row;

    if (sameParticipant(winnerCell, player)) {
      row.winner = player;
      row.loser = opponent;
      delete row.__importWarning;
      return row;
    }
    if (sameParticipant(winnerCell, opponent)) {
      row.winner = opponent;
      row.loser = player;
      delete row.__importWarning;
      return row;
    }

    if (/^(w|win|won|winner|yes|y|true)$/i.test(winnerCell)) {
      row.winner = player;
      row.loser = opponent;
      delete row.__importWarning;
      return row;
    }
    if (/^(l|loss|lost|loser|no|n|false)$/i.test(winnerCell)) {
      row.winner = opponent;
      row.loser = player;
      delete row.__importWarning;
      return row;
    }

    row.__importWarning = `Winner “${winnerCell}” does not match Player “${player}” or Opponent “${opponent}”.`;
    return row;
  }

  function reciprocalDuplicateSignature(row) {
    if (!row?.__doublesPartnerStyle || !row.__doublesPrimary || !row.__doublesPair) return '';
    const winner = text(row.winner);
    const loser = text(row.loser);
    const score = text(row.score || row.resultscore || row.gamescore);
    const date = text(row.date || row.matchdate || row.playedon || row.timestamp);
    if (!winner || !loser || !score || !date) return '';
    return [compact(row.gender || row.sex), compact(row.division || 'doubles'), compact(winner), compact(loser), compact(score), compact(date)].join('|');
  }

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) return rows;
    const seenPartnerMatches = new Map();
    const kept = [];

    for (const row of rows) {
      normalizeRow(row);
      const signature = reciprocalDuplicateSignature(row);
      if (signature) {
        const previous = seenPartnerMatches.get(signature);
        if (previous && previous.pair === row.__doublesPair && previous.primary !== row.__doublesPrimary) continue;
        if (!previous) seenPartnerMatches.set(signature, { primary: row.__doublesPrimary, pair: row.__doublesPair });
      }
      kept.push(row);
    }

    if (kept.length !== rows.length) rows.splice(0, rows.length, ...kept);
    return rows;
  }

  function isCompletePartnerLayout(rows) {
    if (!Array.isArray(rows) || !rows.length) return false;
    const partnerRows = rows.filter(row => row?.__doublesPartnerStyle);
    if (!partnerRows.length) return false;
    return partnerRows.length === rows.length && partnerRows.every(row => {
      const winner = text(row.winner);
      const loser = text(row.loser);
      const division = compact(row.division || row.format || row.event || row.matchtype);
      const gender = genderKind(row.gender || row.sex) || compact(row.gender || row.sex);
      return Boolean(winner && loser && !sameParticipant(winner, loser) && division === 'doubles' && ['boys', 'girls', 'mixed'].includes(gender));
    });
  }

  function installValidationCompat(importer) {
    if (!importer || typeof importer.validateInterpretation !== 'function') return false;
    if (importer.validateInterpretation.__matchResultCompatValidator) return true;
    const baseValidate = importer.validateInterpretation;
    const wrapped = function matchResultCompatibleValidation(rows) {
      if (isCompletePartnerLayout(rows)) {
        return { valid: true, confidence: 1, level: 'HIGH', reason: 'Complete doubles partner layout recognized deterministically.' };
      }
      return baseValidate.apply(this, arguments);
    };
    wrapped.__matchResultCompatValidator = true;
    wrapped.__baseValidateInterpretation = baseValidate;
    importer.validateInterpretation = wrapped;
    return true;
  }

  function installImporterCompat(win) {
    const importer = win?.TennisRankImportV2;
    if (!importer || typeof importer.parseText !== 'function') return false;
    let installed = false;
    if (!importer.parseText.__matchResultCompatParser) {
      const baseParse = importer.parseText;
      const wrapped = function matchResultCompatibleParseText(textInput) {
        const rawRows = rawPartnerRows(textInput, importer);
        const rows = baseParse.apply(this, arguments);
        mergeRawPartnerColumns(rows, rawRows);
        return normalizeRows(rows);
      };
      wrapped.__matchResultCompatParser = true;
      wrapped.__baseParseText = baseParse;
      importer.parseText = wrapped;
      installed = true;
    } else {
      installed = true;
    }
    if (installValidationCompat(importer)) installed = true;
    return installed;
  }

  function installBrowser(win) {
    if (!win) return false;
    const importerInstalled = installImporterCompat(win);
    let loaderInstalled = false;

    if (typeof win.loadRows === 'function') {
      if (win.loadRows.__matchResultCompat) {
        loaderInstalled = true;
      } else {
        const base = win.loadRows;
        const wrapped = function matchResultCompatibleLoadRows(rows, source) {
          normalizeRows(rows);
          return base.call(this, rows, source);
        };
        wrapped.__matchResultCompat = true;
        wrapped.__baseLoadRows = base;
        win.loadRows = wrapped;
        loaderInstalled = true;
      }
    }

    return importerInstalled || loaderInstalled;
  }

  function repairLoadedBackend(win) {
    if (!win || win.__matchResultCompatInitialRepairRequested) return false;
    const profile = win.TennisRankAuth?.getProfile?.();
    if (!profile || typeof win.fetchBackendRecords !== 'function' || typeof win.loadRows !== 'function') return false;
    win.__matchResultCompatInitialRepairRequested = true;
    Promise.resolve()
      .then(() => win.fetchBackendRecords())
      .catch(() => {
        // Keep the app usable if the repair read fails; a normal reload can retry.
      });
    return true;
  }

  function scheduleBrowserInstall(win) {
    const apply = () => {
      const installed = installBrowser(win);
      if (installed) repairLoadedBackend(win);
      return installed;
    };
    apply();
    if (win?.document?.readyState === 'loading') {
      win.document.addEventListener('DOMContentLoaded', apply, { once: true });
    }
    win?.addEventListener?.('tennisrank:auth-ready', apply);
    win?.addEventListener?.('tennisrank:coach-data-changed', apply);
    for (const delay of [25, 100, 300, 1000, 2000]) win?.setTimeout?.(apply, delay);
  }

  if (typeof window !== 'undefined' && window.document) scheduleBrowserInstall(window);

  return {
    compact,
    sameParticipant,
    valueFor,
    splitPairNames,
    pairLabel,
    genderKind,
    pairGender,
    partnerFieldForHeader,
    rawPartnerRows,
    mergeRawPartnerColumns,
    normalizeDoublesPartners,
    normalizeTwoSideResult,
    normalizeRow,
    normalizeRows,
    isCompletePartnerLayout,
    installValidationCompat,
    installImporterCompat,
    installBrowser,
    repairLoadedBackend,
    scheduleBrowserInstall,
  };
});
