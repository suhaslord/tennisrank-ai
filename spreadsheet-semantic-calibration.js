(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankSpreadsheetCalibration = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PERSON_FIELDS = ["opponent", "player1", "player2", "winner", "loser"];
  const AGGREGATE_FIELDS = ["rank", "record", "wins", "losses"];
  const STRONG_TENNIS_FIELDS = new Set(["result", "score", "gender", "division", "opponent", "winner", "loser", "player1", "player2"]);

  function nonEmpty(value) {
    return String(value ?? "").trim() !== "";
  }

  function identity(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
  }

  function matrixIdentityOverlap(matrix) {
    if (!Array.isArray(matrix) || matrix.length < 3) return false;
    for (let headerIndex = 0; headerIndex < Math.min(matrix.length - 2, 12); headerIndex += 1) {
      const headerIdentities = new Set((matrix[headerIndex] || []).slice(1).map(identity).filter(Boolean));
      if (headerIdentities.size < 2) continue;
      const rowIdentities = new Set(matrix.slice(headerIndex + 1, headerIndex + 14).map(row => identity(row?.[0])).filter(Boolean));
      let overlap = 0;
      headerIdentities.forEach(value => { if (rowIdentities.has(value)) overlap += 1; });
      if (overlap >= 2 && overlap / Math.min(headerIdentities.size, rowIdentities.size) >= 0.5) return true;
    }
    return false;
  }

  function hardenMatrixDetector(ml) {
    if (!ml || ml.__matrixIdentityGuard || typeof ml.parseOutcomeMatrix !== "function") return ml;
    const base = ml.parseOutcomeMatrix.bind(ml);
    ml.parseOutcomeMatrix = (matrix, sourceName) => matrixIdentityOverlap(matrix) ? base(matrix, sourceName) : null;
    ml.__matrixIdentityGuard = true;
    return ml;
  }

  function rowHasAggregate(row) {
    return AGGREGATE_FIELDS.some(field => nonEmpty(row?.[field]))
      || Number.isFinite(Number(row?.__sourceRank))
      || Number.isFinite(Number(row?.__aggregateWins))
      || Number.isFinite(Number(row?.__aggregateLosses));
  }

  function hasExplicitMatchStructure(rows) {
    return rows.some(row => nonEmpty(row?.result) || nonEmpty(row?.score))
      || rows.some(row => nonEmpty(row?.player1) && nonEmpty(row?.player2))
      || rows.some(row => nonEmpty(row?.winner) && nonEmpty(row?.loser));
  }

  function personQuality(rows, field, ml) {
    const values = rows.map(row => row?.[field]).filter(nonEmpty);
    if (!values.length) return 0;
    const nameLike = ml?.looksName ? values.filter(value => ml.looksName(value)).length : values.filter(value => /[A-Za-z]/.test(String(value))).length;
    return nameLike / values.length;
  }

  function chooseAggregatePersonField(rows, ml) {
    return PERSON_FIELDS
      .map(field => ({ field, quality: personQuality(rows, field, ml), coverage: rows.filter(row => nonEmpty(row?.[field])).length / Math.max(rows.length, 1) }))
      .filter(item => item.quality >= 0.6 && item.coverage >= 0.5)
      .sort((a, b) => b.quality - a.quality || b.coverage - a.coverage)[0]?.field || "";
  }

  function calibrateRows(rows, ml) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    const aggregateRatio = rows.filter(rowHasAggregate).length / rows.length;
    const hasName = rows.some(row => nonEmpty(row?.name));
    if (aggregateRatio < 0.5 || hasName || hasExplicitMatchStructure(rows)) return rows;

    const personField = chooseAggregatePersonField(rows, ml);
    if (!personField) return rows;

    rows.forEach(row => {
      if (!nonEmpty(row?.name) && nonEmpty(row?.[personField])) {
        row.name = String(row[personField]).trim();
        delete row[personField];
      }
    });

    const analysis = rows.__analysis;
    if (analysis) {
      analysis.mapping = (analysis.mapping || []).map(item => item.field === personField
        ? { ...item, field: "name", method: item.method === "rule" ? "semantic-rule" : "ml+semantic", confidence: Math.max(Number(item.confidence || 0), 0.8) }
        : item);
      analysis.semanticCalibration = `aggregate:${personField}->name`;
      analysis.review = ml?.assessRows ? ml.assessRows(rows) : analysis.review;
    }
    return rows;
  }

  function sourceHasTennisContext(rows) {
    const source = String(rows?.__analysis?.sourceName || "");
    return /\b(?:tennis|singles?|doubles?|match|results?|ladder|rankings?|standings?|leaderboard|roster|varsity|jv|boys?|girls?)\b/i.test(source);
  }

  function mappingHasRule(rows, fields) {
    return (rows?.__analysis?.mapping || []).some(item => fields.has(item.field) && /^(?:rule|semantic-rule|secondary-rule|matrix)$/.test(String(item.method || "")));
  }

  function rowHasStrongTennisValue(row, ml) {
    if (nonEmpty(row?.result) && /^(?:w|l|win|loss|player\s*[ab])$/i.test(String(row.result).trim())) return true;
    if (nonEmpty(row?.score) && (ml?.looksScore ? ml.looksScore(row.score) : /\d+\s*-\s*\d+/.test(String(row.score)))) return true;
    if (nonEmpty(row?.gender) && /^(?:boys?|girls?|male|female|m|f)$/i.test(String(row.gender).trim())) return true;
    if (nonEmpty(row?.division) && /\b(?:singles?|doubles?|2v2)\b/i.test(String(row.division))) return true;
    return false;
  }

  function applyDomainEvidenceGate(rows, review, ml) {
    if (!review?.valid || !Array.isArray(rows) || !rows.length) return review;
    const sourceEvidence = sourceHasTennisContext(rows);
    const strongValueRatio = rows.filter(row => rowHasStrongTennisValue(row, ml)).length / rows.length;
    const strongRuleEvidence = mappingHasRule(rows, STRONG_TENNIS_FIELDS);
    const aggregateRuleEvidence = mappingHasRule(rows, new Set(AGGREGATE_FIELDS));
    const aggregateRatio = rows.filter(rowHasAggregate).length / rows.length;
    const matchStructure = hasExplicitMatchStructure(rows) || rows.some(row => nonEmpty(row?.opponent));

    // Match-like data may be accepted from unmistakable result/score semantics.
    if (matchStructure && (sourceEvidence || strongRuleEvidence || strongValueRatio >= 0.5)) return review;

    // Aggregate tables are especially easy to hallucinate from generic numeric
    // spreadsheets. A rank/record inference therefore needs explicit aggregate
    // headers or clear tennis context/value evidence; ML confidence alone is not
    // sufficient to publish team rankings.
    if (aggregateRatio >= 0.5) {
      if (sourceEvidence || aggregateRuleEvidence || strongValueRatio >= 0.5) return review;
      return {
        valid: false,
        confidence: Math.min(Number(review.confidence || 0), 0.44),
        level: "LOW",
        reason: "The columns resemble standings, but the sheet does not contain enough tennis-specific evidence to publish them safely.",
      };
    }

    // Roster-only imports need an explicit player/name mapping plus team context.
    const nameRuleEvidence = mappingHasRule(rows, new Set(["name"]));
    if (nameRuleEvidence && (sourceEvidence || strongValueRatio >= 0.5)) return review;

    if (!sourceEvidence && !strongRuleEvidence && strongValueRatio < 0.5) {
      return {
        valid: false,
        confidence: Math.min(Number(review.confidence || 0), 0.44),
        level: "LOW",
        reason: "The sheet is structurally plausible, but it does not contain enough tennis-specific evidence to publish safely.",
      };
    }
    return review;
  }

  function wrapImporter(importer, ml) {
    if (!importer || importer.__semanticCalibration) return importer;
    hardenMatrixDetector(ml);
    const parseText = importer.parseText.bind(importer);
    const mergeWorksheetRows = importer.mergeWorksheetRows.bind(importer);
    const validateInterpretation = typeof importer.validateInterpretation === "function"
      ? importer.validateInterpretation.bind(importer)
      : rows => ml?.assessRows?.(rows) || { valid: true, confidence: 1, level: "HIGH" };
    importer.parseText = (...args) => calibrateRows(parseText(...args), ml);
    importer.mergeWorksheetRows = (...args) => calibrateRows(mergeWorksheetRows(...args), ml);
    importer.validateInterpretation = rows => {
      const review = applyDomainEvidenceGate(rows, validateInterpretation(rows), ml);
      if (rows?.__analysis) rows.__analysis.review = review;
      return review;
    };
    importer.__semanticCalibration = true;
    return importer;
  }

  function installBrowser(win) {
    const apply = () => {
      const importer = win.TennisRankImportV2;
      const ml = win.TennisRankSpreadsheetML;
      if (!importer || !ml) return;
      wrapImporter(importer, ml);
      win.parseCSV = importer.parseText;
    };
    if (win.document.readyState === "loading") win.document.addEventListener("DOMContentLoaded", () => setTimeout(apply, 0), { once: true });
    else setTimeout(apply, 0);
  }

  return {
    calibrateRows,
    wrapImporter,
    chooseAggregatePersonField,
    hasExplicitMatchStructure,
    matrixIdentityOverlap,
    hardenMatrixDetector,
    applyDomainEvidenceGate,
    installBrowser,
  };
});
