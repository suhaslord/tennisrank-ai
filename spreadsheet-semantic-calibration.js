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

  function nonEmpty(value) {
    return String(value ?? "").trim() !== "";
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

  function wrapImporter(importer, ml) {
    if (!importer || importer.__semanticCalibration) return importer;
    const parseText = importer.parseText.bind(importer);
    const mergeWorksheetRows = importer.mergeWorksheetRows.bind(importer);
    importer.parseText = (...args) => calibrateRows(parseText(...args), ml);
    importer.mergeWorksheetRows = (...args) => calibrateRows(mergeWorksheetRows(...args), ml);
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

  return { calibrateRows, wrapImporter, chooseAggregatePersonField, hasExplicitMatchStructure, installBrowser };
});
