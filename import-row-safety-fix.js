(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankRowSafetyFix = api;
    if (root.document) {
      const install = () => root.TennisRankImportV2 && api.wrapImporter(root.TennisRankImportV2);
      if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", install, { once: true });
      else install();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATUS = /^(?:active|inactive|injured|available|unavailable|pending|hold|injury hold)$/i;
  const GENDER = /^(?:boys?|girls?|male|female|men|women|m|f)$/i;
  const DIVISION = /^(?:singles?|doubles?|2v2)$/i;
  const DATE = /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}-[A-Za-z]{3}-\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/;

  function text(value) { return String(value ?? "").trim(); }
  function key(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function gender(value) {
    const valueText = text(value);
    if (!GENDER.test(valueText)) return "";
    return /^(?:g|girl|girls|female|women)$/i.test(valueText) ? "Girls" : "Boys";
  }
  function division(value) {
    const valueText = text(value);
    if (!DIVISION.test(valueText)) return "";
    return /^(?:doubles?|2v2)$/i.test(valueText) ? "Doubles" : "Singles";
  }

  function sourceMap(rows) {
    const result = new Map();
    for (const item of rows?.__analysis?.mapping || []) {
      if (!item?.field) continue;
      const list = result.get(item.field) || [];
      list.push(item);
      result.set(item.field, list);
    }
    return result;
  }

  function hasExplicitMapping(map, field) {
    return (map.get(field) || []).some(item => /^(?:rule|semantic-rule|secondary-rule|matrix)$/.test(String(item.method || "")));
  }

  function nearestContext(matrix, sourceRow) {
    if (!Array.isArray(matrix) || !Number.isFinite(Number(sourceRow))) return {};
    const start = Math.min(matrix.length - 1, Math.max(0, Number(sourceRow) - 2));
    for (let index = start; index >= Math.max(0, start - 14); index -= 1) {
      const values = (matrix[index] || []).map(text).filter(Boolean);
      if (!values.length || values.length > 3) continue;
      const joined = values.join(" ");
      const genderValue = /\b(?:girls?|women|female)\b/i.test(joined)
        ? "Girls"
        : /\b(?:boys?|men|male)\b/i.test(joined) ? "Boys" : "";
      const divisionValue = /\b(?:doubles?|pairs?|2v2)\b/i.test(joined)
        ? "Doubles"
        : /\b(?:singles?)\b/i.test(joined) ? "Singles" : "";
      if (genderValue || divisionValue) return { gender: genderValue, division: divisionValue };
    }
    return {};
  }

  function repairRow(row, mapping, context = {}) {
    if (!row || typeof row !== "object") return row;
    const splitName = [text(row.firstName), text(row.lastName)].filter(Boolean).join(" ");
    if (splitName) row.name = splitName;

    for (const [field, value] of Object.entries(row)) {
      if (field.startsWith("__")) continue;
      const normalizedKey = key(field);
      const genderValue = gender(value);
      const divisionValue = division(value);
      if (genderValue && (!row.gender || ["squad", "group", "team", "teamsex"].includes(normalizedKey))) row.gender = genderValue;
      if (divisionValue && (!row.division || ["format", "type", "flight", "event"].includes(normalizedKey))) row.division = divisionValue;
      if (!row.date && DATE.test(text(value)) && /^(?:when|played|playedon|matchdate|date)$/i.test(normalizedKey)) row.date = text(value);
    }

    const divisionAsGender = gender(row.division);
    if (divisionAsGender) {
      row.gender = divisionAsGender;
      const fallback = division(row.division2) || division(row.format) || division(row.type) || division(row.flight) || division(context.division);
      if (fallback) row.division = fallback;
      else delete row.division;
    }
    const genderAsDivision = division(row.gender);
    if (genderAsDivision) {
      row.division = genderAsDivision;
      delete row.gender;
    }

    if (STATUS.test(text(row.name)) && !splitName) delete row.name;

    if (text(row.player1) && text(row.opponent) && /^(?:w|l|win|loss)$/i.test(text(row.result)) && !text(row.player2)) {
      row.name = text(row.player1);
      delete row.player1;
    }

    if (!text(row.winner)) {
      for (const [field, value] of Object.entries(row)) {
        if (/^(?:whowon|wonby|winneris|winningteam|winningplayer)$/i.test(key(field)) && text(value)) {
          row.winner = text(value);
          break;
        }
      }
    }
    if (text(row.winner) && text(row.player1) && text(row.winner).toLowerCase() === text(row.player1).toLowerCase()) row.winner = "Player A";
    else if (text(row.winner) && text(row.player2) && text(row.winner).toLowerCase() === text(row.player2).toLowerCase()) row.winner = "Player B";

    if (context.gender && !hasExplicitMapping(mapping, "gender")) row.gender = context.gender;
    if (context.division && !hasExplicitMapping(mapping, "division")) row.division = context.division;

    const matchLike = (text(row.name) && text(row.opponent) && /^(?:w|l|win|loss)$/i.test(text(row.result)))
      || (text(row.player1) && text(row.player2) && (text(row.winner) || text(row.result)));
    if (matchLike) {
      for (const field of ["rank", "record", "wins", "losses"]) {
        const mappings = mapping.get(field) || [];
        if (mappings.length && mappings.every(item => String(item.method || "") === "ml")) delete row[field];
      }
      if (!text(row.wins)) delete row.__aggregateWins;
      if (!text(row.losses)) delete row.__aggregateLosses;
      if (!text(row.rank)) delete row.__sourceRank;
    }
    return row;
  }

  function repairRows(rows, sourceText, importer) {
    if (!Array.isArray(rows)) return rows;
    const mapping = sourceMap(rows);
    let matrix = null;
    try { matrix = sourceText && importer?.parseDelimited ? importer.parseDelimited(sourceText).matrix : null; } catch {}
    rows.forEach(row => repairRow(row, mapping, nearestContext(matrix, row.__sourceRow)));
    return rows;
  }

  function wrapImporter(importer) {
    if (!importer || importer.__rowSafetyFix) return importer;
    const baseParseText = importer.parseText.bind(importer);
    const baseMerge = typeof importer.mergeWorksheetRows === "function" ? importer.mergeWorksheetRows.bind(importer) : null;
    importer.parseText = (sourceText, sourceName) => repairRows(baseParseText(sourceText, sourceName), sourceText, importer);
    if (baseMerge) {
      importer.mergeWorksheetRows = sheets => {
        const rows = baseMerge(sheets);
        const mapping = sourceMap(rows);
        rows.forEach(row => repairRow(row, mapping, {}));
        return rows;
      };
    }
    importer.__rowSafetyFix = true;
    return importer;
  }

  return { text, gender, division, nearestContext, repairRow, repairRows, wrapImporter };
});
