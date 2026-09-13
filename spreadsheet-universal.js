(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.TennisRankUniversalImport = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const AGGREGATE_FIELDS = new Set(['rank', 'record', 'wins', 'losses']);
  const MATCH_METADATA_FIELDS = ['score', 'date', 'gender', 'division'];

  function text(value) { return String(value ?? '').trim(); }
  function compact(value) {
    return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function same(a, b) {
    const left = compact(a); const right = compact(b);
    return Boolean(left && right && left === right);
  }
  function ratio(values, predicate) {
    const usable = (values || []).map(text).filter(Boolean);
    return usable.length ? usable.filter(predicate).length / usable.length : 0;
  }
  function looksScore(value) { return /\d{1,2}\s*[-–]\s*\d{1,2}/.test(text(value)); }
  function looksDate(value) {
    const valueText = text(value);
    return /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})$/.test(valueText)
      || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(valueText);
  }
  function looksGender(value) { return /^(?:boys?|girls?|male|female|men|women|m|f)$/i.test(text(value)); }
  function looksDivision(value) { return /\b(?:singles?|doubles?|pairs?|2v2|varsity|jv)\b/i.test(text(value)); }
  function looksResult(value) {
    return /^(?:w|l|win|loss|won|lost|winner|loser|yes|no|true|false|home|away|host|visitor|guest|player\s*[ab12]|team\s*[ab12]|side\s*[ab12]|first|second)$/i.test(text(value));
  }
  function looksRecord(value) { return /^\d{1,3}\s*[-/]\s*\d{1,3}$/.test(text(value)); }
  function looksNumber(value) { return /^[-+]?\d+(?:\.\d+)?$/.test(text(value)); }
  function looksPerson(value) {
    const valueText = text(value);
    if (!valueText || valueText.length > 90 || looksScore(valueText) || looksDate(valueText) || looksGender(valueText) || looksDivision(valueText) || looksResult(valueText) || looksRecord(valueText) || looksNumber(valueText)) return false;
    if (/^(?:notes?|comments?|round|court|school|venue|season|year|n\/a|null|none)$/i.test(valueText)) return false;
    return /[A-Za-z]/.test(valueText) && !/@/.test(valueText);
  }

  function valuesFor(matrix, headerIndex, column) {
    return (matrix || []).slice(headerIndex + 1, headerIndex + 61).map(row => row?.[column]).map(text).filter(Boolean);
  }

  function headerField(importer, ml, header, values, context) {
    const deterministic = importer?.canonicalField?.(header) || 'column';
    if (deterministic !== 'column') return { field: deterministic, confidence: 1, method: 'rule' };

    const normalized = compact(header);
    const looseRules = [
      ['name', /^(who|member|entrant|person|studentname|playerlabel|competitorname)$/],
      ['opponent', /^(rival|otherplayer|otherside|playedagainst|opposition)$/],
      ['winner', /^(champion|victoryby|winningname|winningside|winnerteam)$/],
      ['loser', /^(defeatedplayer|defeatedteam|losingside)$/],
      ['score', /^(scoreline|final|finalresult|setsplayed)$/],
      ['result', /^(decision|finish|verdict|wlresult)$/],
      ['rank', /^(order|place|ladderposition|seednumber)$/],
      ['wins', /^(victories|wonmatches|matchwins)$/],
      ['losses', /^(defeats|lostmatches|matchlosses)$/],
      ['record', /^(seasonmark|overallmark)$/],
    ];
    const loose = looseRules.find(([, rule]) => rule.test(normalized));
    if (loose) return { field: loose[0], confidence: 0.9, method: 'semantic-rule' };

    const typed = [
      ['score', ratio(values, looksScore), 0.62],
      ['date', ratio(values, looksDate), 0.68],
      ['gender', ratio(values, looksGender), 0.72],
      ['division', ratio(values, looksDivision), 0.68],
      ['result', ratio(values, looksResult), 0.72],
      ['record', ratio(values, looksRecord), 0.78],
    ].sort((a, b) => b[1] - a[1])[0];
    if (typed && typed[1] >= typed[2]) return { field: typed[0], confidence: typed[1], method: 'value-type' };

    if (ml?.classifyColumn) {
      try {
        const classified = ml.classifyColumn(header, values, context || {});
        const top = classified?.top;
        const threshold = ['score', 'date', 'gender', 'division', 'result', 'record'].includes(top?.label) ? 0.42
          : ['rank', 'wins', 'losses'].includes(top?.label) ? 0.5
          : ['name', 'opponent', 'player1', 'player2', 'winner', 'loser'].includes(top?.label) ? 0.58 : 1;
        if (top?.label && top.label !== 'column' && Number(top.confidence || 0) >= threshold) {
          return { field: top.label, confidence: Number(top.confidence), method: 'ml-content' };
        }
      } catch {}
    }
    return { field: 'column', confidence: 0, method: 'unknown' };
  }

  function personColumnScore(values) {
    const usable = (values || []).map(text).filter(Boolean);
    if (!usable.length) return 0;
    const personRatio = ratio(usable, looksPerson);
    const uniqueness = new Set(usable.map(compact)).size / usable.length;
    return personRatio * 0.78 + Math.min(1, uniqueness) * 0.22;
  }

  function relationalWinnerScore(matrix, headerIndex, first, second, outcome) {
    let usable = 0; let matched = 0;
    for (const row of matrix.slice(headerIndex + 1, headerIndex + 101)) {
      const a = text(row?.[first]); const b = text(row?.[second]); const result = text(row?.[outcome]);
      if (!a || !b || !result || same(a, b)) continue;
      usable += 1;
      if (same(result, a) || same(result, b)) matched += 1;
    }
    return { usable, score: usable ? matched / usable : 0 };
  }

  function setRole(mapping, index, field, confidence, method, force = false) {
    if (!mapping[index]) return;
    if (!force && mapping[index].field !== 'column') return;
    mapping[index] = { ...mapping[index], field, confidence, method };
  }

  function inferMapping(matrix, headerIndex, sourceName, importer, ml) {
    const header = matrix[headerIndex] || [];
    const total = Math.max(header.length, ...matrix.slice(headerIndex + 1, headerIndex + 8).map(row => row?.length || 0), 0);
    const mapping = Array.from({ length: total }, (_, column) => {
      const values = valuesFor(matrix, headerIndex, column);
      const guessed = headerField(importer, ml, header[column] || `Column ${column + 1}`, values, { position: column, totalColumns: total, sheetName: sourceName });
      return { source: text(header[column]) || `Column ${column + 1}`, column, ...guessed, personScore: personColumnScore(values) };
    });

    const personCandidates = mapping
      .filter(item => ['column', 'name', 'opponent', 'player1', 'player2', 'winner', 'loser'].includes(item.field) && item.personScore >= 0.6)
      .sort((a, b) => b.personScore - a.personScore || a.column - b.column);

    let bestRelation = null;
    for (let i = 0; i < personCandidates.length; i += 1) {
      for (let j = i + 1; j < personCandidates.length; j += 1) {
        const first = personCandidates[i].column; const second = personCandidates[j].column;
        for (const item of mapping) {
          if ([first, second].includes(item.column)) continue;
          if (['score', 'date', 'gender', 'division', 'record', 'rank', 'wins', 'losses'].includes(item.field)) continue;
          const relation = relationalWinnerScore(matrix, headerIndex, first, second, item.column);
          if (relation.usable < 2 || relation.score < 0.58) continue;
          const strength = relation.score + Math.min(relation.usable, 8) * 0.02;
          if (!bestRelation || strength > bestRelation.strength) bestRelation = { first, second, outcome: item.column, strength, score: relation.score };
        }
      }
    }

    if (bestRelation) {
      setRole(mapping, bestRelation.first, 'player1', Math.max(0.72, personCandidates.find(item => item.column === bestRelation.first)?.personScore || 0), 'relational');
      setRole(mapping, bestRelation.second, 'player2', Math.max(0.72, personCandidates.find(item => item.column === bestRelation.second)?.personScore || 0), 'relational');
      if (!['winner', 'loser'].includes(mapping[bestRelation.outcome].field)) {
        mapping[bestRelation.outcome] = { ...mapping[bestRelation.outcome], field: 'winner', confidence: Math.max(0.8, bestRelation.score), method: 'relational-match' };
      }
    }

    const resultColumn = mapping.find(item => item.field === 'result');
    if (resultColumn && !bestRelation) {
      const availablePeople = personCandidates.filter(item => item.column !== resultColumn.column).slice(0, 2);
      if (availablePeople.length === 2) {
        const existingStructural = new Set(mapping.map(item => item.field));
        if (existingStructural.has('player1') || existingStructural.has('player2')) {
          setRole(mapping, availablePeople[0].column, 'player1', 0.7, 'result-pair');
          setRole(mapping, availablePeople[1].column, 'player2', 0.7, 'result-pair');
        } else {
          setRole(mapping, availablePeople[0].column, 'name', 0.7, 'result-pair');
          setRole(mapping, availablePeople[1].column, 'opponent', 0.7, 'result-pair');
        }
      }
    }

    const fields = new Set(mapping.map(item => item.field));
    const hasAggregate = [...AGGREGATE_FIELDS].some(field => fields.has(field));
    if (hasAggregate && !fields.has('name')) {
      const candidate = personCandidates.find(item => mapping[item.column].field === 'column');
      if (candidate) setRole(mapping, candidate.column, 'name', Math.max(0.68, candidate.personScore), 'aggregate-person');
    }

    const bestByField = new Map();
    for (const item of mapping) {
      if (item.field === 'column') continue;
      const current = bestByField.get(item.field);
      if (!current || item.confidence > current.confidence) bestByField.set(item.field, item);
    }
    for (const item of mapping) {
      if (item.field === 'column') continue;
      if (bestByField.get(item.field) !== item && !['player1', 'player2'].includes(item.field)) item.field = 'column';
    }
    return mapping;
  }

  function normalizeOutcome(value) {
    const valueText = text(value);
    if (/^(?:w|win|won|winner|yes|y|true|home|host|first)$/i.test(valueText)) return 'W';
    if (/^(?:l|loss|lost|loser|no|n|false|away|visitor|guest|second)$/i.test(valueText)) return 'L';
    return valueText;
  }

  function normalizeCanonicalRow(row) {
    if (!row || typeof row !== 'object') return row;
    const name = text(row.name); const opponent = text(row.opponent);
    const player1 = text(row.player1); const player2 = text(row.player2);
    const signal = text(row.winner || row.result);

    if (!row.loser && name && opponent && signal) {
      const normalized = normalizeOutcome(signal);
      if (same(signal, name) || normalized === 'W') { row.winner = name; row.loser = opponent; }
      else if (same(signal, opponent) || normalized === 'L') { row.winner = opponent; row.loser = name; }
    }

    if (!row.loser && player1 && player2 && signal) {
      const normalized = normalizeOutcome(signal);
      const pointer = compact(signal);
      if (same(signal, player1) || normalized === 'W' || ['a', '1', 'playera', 'player1', 'teama', 'team1', 'sidea', 'side1'].includes(pointer)) {
        row.winner = player1; row.loser = player2;
      } else if (same(signal, player2) || normalized === 'L' || ['b', '2', 'playerb', 'player2', 'teamb', 'team2', 'sideb', 'side2'].includes(pointer)) {
        row.winner = player2; row.loser = player1;
      }
    }

    if (row.result) row.result = normalizeOutcome(row.result);
    return row;
  }

  function applyHints(row, sourceName, importer) {
    const hints = importer?.sectionHints?.(sourceName) || {};
    if (hints.gender && !row.gender) row.gender = hints.gender;
    if (hints.division && !row.division) row.division = hints.division;
    return row;
  }

  function buildRows(matrix, headerIndex, mapping, sourceName, importer) {
    const rows = [];
    const headerValues = matrix[headerIndex] || [];
    for (let offset = headerIndex + 1; offset < matrix.length; offset += 1) {
      const values = matrix[offset] || [];
      if (!values.some(value => text(value))) continue;
      const row = {};
      for (const item of mapping) {
        if (item.field === 'column') continue;
        const value = text(values[item.column]);
        if (value && row[item.field] === undefined) row[item.field] = value;
      }
      row.__sourceRow = offset + 1;
      if (sourceName) row.__sheetName = sourceName;
      applyHints(row, sourceName, importer);
      normalizeCanonicalRow(row);
      const publicValues = Object.entries(row).filter(([key, value]) => !key.startsWith('__') && text(value));
      if (publicValues.length) rows.push(row);
    }
    rows.__analysis = {
      headerRow: headerIndex + 1,
      delimiter: 'universal',
      columns: headerValues.filter(value => text(value)),
      mapping: mapping.filter(item => item.field !== 'column').map(item => ({ source: item.source, field: item.field, method: item.method, confidence: item.confidence })),
      sourceName: sourceName || '',
      engine: 'universal-relational-v4',
    };
    return rows;
  }

  function quality(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let matches = 0; let aggregates = 0; let interpreted = 0; let completeMatches = 0; let metadata = 0;
    for (const row of list) {
      normalizeCanonicalRow(row);
      const match = Boolean((text(row.winner) && text(row.loser))
        || (text(row.name) && text(row.opponent) && text(row.result))
        || (text(row.player1) && text(row.player2) && (text(row.winner) || text(row.result))));
      const aggregate = Boolean(text(row.name) && (text(row.record) || text(row.rank) || text(row.wins) || text(row.losses)));
      const roster = Boolean(text(row.name) && (text(row.gender) || text(row.division)));
      const rowMetadata = MATCH_METADATA_FIELDS.filter(field => text(row[field])).length;
      metadata += rowMetadata;
      if (match) matches += 1;
      if (match && text(row.score)) completeMatches += 1;
      if (aggregate) aggregates += 1;
      if (match || aggregate || roster) interpreted += 1;
    }
    const total = Math.max(list.length, 1);
    const metadataRatio = metadata / (total * MATCH_METADATA_FIELDS.length);
    return {
      matches,
      aggregates,
      interpreted,
      completeMatches,
      metadata,
      score: (matches / total) * 0.6
        + (aggregates / total) * 0.16
        + (interpreted / total) * 0.08
        + (completeMatches / total) * 0.1
        + metadataRatio * 0.06,
    };
  }

  function normalizeRows(rows) {
    if (!Array.isArray(rows)) return rows;
    rows.forEach(normalizeCanonicalRow);
    return rows;
  }

  function candidateHeader(matrix, index, sourceName, importer, ml) {
    const header = matrix[index] || [];
    const nonEmpty = header.map(text).filter(Boolean);
    if (nonEmpty.length < 2) return { index, score: -Infinity, count: 0, structuralCount: 0, guesses: [] };
    const total = Math.max(header.length, ...matrix.slice(index + 1, index + 8).map(row => row?.length || 0), 0);
    const guesses = Array.from({ length: total }, (_, column) => headerField(
      importer,
      ml,
      header[column] || `Column ${column + 1}`,
      valuesFor(matrix, index, column),
      { position: column, totalColumns: total, sheetName: sourceName },
    ));
    const strong = guesses.filter(item => item.field !== 'column' && Number(item.confidence || 0) >= 0.6);
    const structural = strong.filter(item => !['score', 'date', 'gender', 'division'].includes(item.field));
    const explicitHeaders = guesses.filter((item, column) => {
      if (!['rule', 'semantic-rule'].includes(item.method)) return false;
      const raw = text(header[column]);
      return raw && !looksResult(raw) && !looksScore(raw) && !looksDate(raw) && !looksRecord(raw) && !looksNumber(raw);
    }).length;
    const dataPenalty = guesses.reduce((sum, item, column) => {
      const raw = text(header[column]);
      if (!raw) return sum;
      if (looksPerson(raw) && !['rule', 'semantic-rule'].includes(item.method)) return sum + 2.8;
      if (looksResult(raw) || looksScore(raw) || looksDate(raw) || looksRecord(raw) || looksNumber(raw)) return sum + 2.2;
      return sum;
    }, 0);
    const followers = matrix.slice(index + 1, index + 6).filter(row => (row || []).filter(value => text(value)).length >= Math.max(2, Math.floor(nonEmpty.length * 0.55))).length;
    const score = strong.length * 2.2 + structural.length * 1.45 + explicitHeaders * 1.35 + followers * 0.25 - dataPenalty - index * 0.08;
    return { index, score, count: strong.length, structuralCount: structural.length, guesses };
  }

  function chooseHeader(matrix, sourceName, importer, ml) {
    let best = { index: 0, score: -Infinity, count: 0, structuralCount: 0, guesses: [] };
    const limit = Math.min(Math.max(matrix.length - 1, 1), 16);
    for (let index = 0; index < limit; index += 1) {
      const candidate = candidateHeader(matrix, index, sourceName, importer, ml);
      if (candidate.score > best.score) best = candidate;
    }
    return best;
  }

  function semanticHeaderStrength(matrix, headerIndex, sourceName, importer, ml) {
    return candidateHeader(matrix, headerIndex, sourceName, importer, ml);
  }

  function inferRows(textInput, sourceName, importer, ml) {
    const parsed = importer?.parseDelimited?.(String(textInput || '').replace(/^\uFEFF/, ''));
    if (!parsed?.matrix?.length) return [];
    let matrix = parsed.matrix;
    const chosen = chooseHeader(matrix, sourceName, importer, ml);
    let headerIndex = Number.isInteger(chosen.index) ? chosen.index : 0;
    let orientation = 'rows';

    if (ml?.inferTable && (chosen.count < 2 || chosen.structuralCount < 1)) {
      try {
        const inferred = ml.inferTable(matrix, sourceName || '');
        if (inferred?.matrix?.length && Number(inferred.semanticCount || 0) >= 2 && Number(inferred.anchorCount || 0) >= 1) {
          const inferredHeader = candidateHeader(inferred.matrix, Number(inferred.index || 0), sourceName, importer, ml);
          if (inferredHeader.score > chosen.score + 0.75) {
            matrix = inferred.matrix;
            headerIndex = Number(inferred.index || 0);
            orientation = inferred.orientation || 'rows';
          }
        }
      } catch {}
    }

    const mapping = inferMapping(matrix, headerIndex, sourceName, importer, ml);
    const rows = buildRows(matrix, headerIndex, mapping, sourceName, importer);
    rows.__analysis.orientation = orientation;
    rows.__analysis.headerConfidence = chosen.score;
    return rows;
  }

  function createParser(importer, ml, baseParse) {
    return function universalParse(textInput, sourceName) {
      const baseRows = normalizeRows(baseParse.call(importer, textInput, sourceName));
      const baseQuality = quality(baseRows);
      const inferredRows = inferRows(textInput, sourceName, importer, ml);
      const inferredQuality = quality(inferredRows);

      const noCoreRegression = inferredQuality.matches >= baseQuality.matches
        && inferredQuality.aggregates >= baseQuality.aggregates;
      const richerMatchData = noCoreRegression && (
        inferredQuality.completeMatches > baseQuality.completeMatches
        || inferredQuality.metadata > baseQuality.metadata
      );
      const chooseInferred = inferredRows.length && (
        inferredQuality.matches > baseQuality.matches
        || inferredQuality.aggregates > baseQuality.aggregates
        || (baseQuality.matches === 0 && inferredQuality.matches > 0)
        || richerMatchData
        || inferredQuality.score > baseQuality.score + 0.08
      );
      if (!chooseInferred) return baseRows;
      inferredRows.__analysis = {
        ...(inferredRows.__analysis || {}),
        fallbackFrom: baseRows.__analysis?.engine || 'existing-parser',
        quality: inferredQuality,
      };
      return inferredRows;
    };
  }

  function patchImporterObject(importer, ml) {
    if (!importer || typeof importer.parseText !== 'function' || importer.__universalRelationalImport) return importer;
    const baseParse = importer.parseText;
    importer.parseText = createParser(importer, ml, baseParse);
    importer.normalizeUniversalRows = normalizeRows;
    importer.__universalRelationalImport = true;
    return importer;
  }

  function installBrowser(win) {
    const apply = () => patchImporterObject(win?.TennisRankImportV2, win?.TennisRankSpreadsheetML);
    apply();
    win?.document?.addEventListener?.('DOMContentLoaded', apply, { once: true });
    for (const delay of [25, 100, 300, 1000]) win?.setTimeout?.(apply, delay);
  }

  return {
    compact,
    same,
    looksScore,
    looksDate,
    looksGender,
    looksDivision,
    looksResult,
    looksRecord,
    looksPerson,
    headerField,
    inferMapping,
    normalizeCanonicalRow,
    normalizeRows,
    quality,
    candidateHeader,
    chooseHeader,
    semanticHeaderStrength,
    inferRows,
    createParser,
    patchImporterObject,
    installBrowser,
  };
});
