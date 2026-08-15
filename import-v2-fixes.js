(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) api.installBrowser(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function isRepeatedHeader(importer, values, expectedHeaders) {
    let compared = 0;
    let matches = 0;
    for (let i = 0; i < Math.max(values.length, expectedHeaders.length); i += 1) {
      const raw = String(values[i] ?? "").trim();
      if (!raw) continue;
      compared += 1;
      const incoming = importer.canonicalField(raw);
      const expected = String(expectedHeaders[i] || "").replace(/\d+$/, "");
      if (incoming !== "column" && incoming === expected) matches += 1;
    }
    return compared >= 2 && matches >= Math.max(2, Math.ceil(compared * 0.6));
  }

  function extractScore(value) {
    const match = String(value || "").match(/\b(?:\d{1,2}\s*[-–]\s*\d{1,2})(?:\s*,?\s*(?:\d{1,2}\s*[-–]\s*\d{1,2}))*\b/);
    return match ? match[0].replace(/–/g, "-").replace(/\s+/g, "") : "";
  }

  function normalizeResult(value) {
    const text = String(value || "").trim();
    const compact = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["home", "host", "teama", "team1", "playera", "player1", "sidea", "side1"].includes(compact)) return "Player A";
    if (["away", "visitor", "guest", "teamb", "team2", "playerb", "player2", "sideb", "side2"].includes(compact)) return "Player B";
    if (/^(w|win|won|winner)\b/i.test(text) || /\b(w|win|won)\s*$/i.test(text)) return "W";
    if (/^(l|loss|lost|loser)\b/i.test(text) || /\b(l|loss|lost)\s*$/i.test(text)) return "L";
    return text;
  }

  function postProcessRow(row) {
    if (!row.name && (row.firstName || row.lastName)) row.name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
    if (row.result) {
      const original = String(row.result).trim();
      const score = extractScore(original);
      if (!row.score && score) row.score = score;
      const won = original.match(/^(?:def\.?|beat|defeated)\s+(.+?)(?:\s+\d{1,2}\s*[-–]\s*\d{1,2}.*)?$/i);
      const lost = original.match(/^(?:lost\s+to|fell\s+to)\s+(.+?)(?:\s+\d{1,2}\s*[-–]\s*\d{1,2}.*)?$/i);
      if (!row.opponent && won) row.opponent = won[1].trim();
      if (!row.opponent && lost) row.opponent = lost[1].trim();
      row.result = won ? "W" : lost ? "L" : normalizeResult(original);
    }
    if (row.winner) row.winner = normalizeResult(row.winner);
    if (row.loser) row.loser = normalizeResult(row.loser);
    if (row.record) {
      const match = String(row.record).match(/(\d+)\s*[-–/]\s*(\d+)/);
      if (match) {
        row.__aggregateWins = Number(match[1]);
        row.__aggregateLosses = Number(match[2]);
      }
    }
    if (row.wins !== undefined && String(row.wins).trim() !== "") {
      const wins = Number(String(row.wins).replace(/[^\d.-]/g, ""));
      if (Number.isFinite(wins) && wins >= 0) row.__aggregateWins = wins;
    }
    if (row.losses !== undefined && String(row.losses).trim() !== "") {
      const losses = Number(String(row.losses).replace(/[^\d.-]/g, ""));
      if (Number.isFinite(losses) && losses >= 0) row.__aggregateLosses = losses;
    }
    if (row.rank !== undefined && String(row.rank).trim() !== "") {
      const rank = Number(String(row.rank).replace(/[^\d.]/g, ""));
      if (Number.isFinite(rank) && rank > 0) row.__sourceRank = rank;
    }
    return row;
  }

  function buildParser(importer) {
    function parseText(text, sourceName) {
      const { matrix, delimiter } = importer.parseDelimited(text);
      if (!matrix.length) return [];
      const detected = importer.detectHeaderRow(matrix);
      const headerIndex = detected.index;
      const used = new Map();
      const rawHeaders = matrix[headerIndex] || [];
      const headers = rawHeaders.map((raw, index) => {
        const mapped = detected.mapping[index] === "column" ? (importer.normalizeHeader(raw) || `column${index + 1}`) : detected.mapping[index];
        const count = used.get(mapped) || 0;
        used.set(mapped, count + 1);
        return count ? `${mapped}${count + 1}` : mapped;
      });
      const rows = [];
      matrix.slice(headerIndex + 1).forEach((values, offset) => {
        if (isRepeatedHeader(importer, values, headers)) return;
        const row = Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "").trim()]));
        row.__sourceRow = headerIndex + offset + 2;
        if (sourceName) row.__sheetName = sourceName;
        postProcessRow(row);
        if (Object.entries(row).some(([key, value]) => !key.startsWith("__") && String(value || "").trim())) rows.push(row);
      });
      rows.__analysis = {
        headerRow: headerIndex + 1,
        delimiter: delimiter === "\t" ? "tab" : delimiter === "|" ? "pipe" : delimiter,
        columns: rawHeaders.filter(Boolean),
        mapping: headers.map((header, index) => ({ source: rawHeaders[index] || header, field: header })),
        sourceName: sourceName || "",
        engine: "v2-fixed",
      };
      return rows;
    }

    function mergeWorksheetRows(sheets) {
      const merged = [];
      const names = [];
      for (const sheet of sheets || []) {
        const name = String(sheet.name || "Sheet");
        const text = String(sheet.text || "");
        if (!text.trim()) continue;
        const rows = parseText(text, name);
        if (!rows.length) continue;
        const hints = importer.sectionHints(name);
        rows.forEach(row => {
          if (hints.gender && !row.gender) row.gender = hints.gender;
          if (hints.division && !row.division) row.division = hints.division;
          merged.push(row);
        });
        names.push(name);
      }
      merged.__analysis = { headerRow: 1, delimiter: "workbook", columns: [], mapping: [], sourceName: names.join(", "), sheets: names, engine: "v2-fixed" };
      return merged;
    }

    return { parseText, mergeWorksheetRows };
  }

  function patchImporter(importer) {
    if (!importer || importer.__majorityHeaderFix) return importer;
    const fixed = buildParser(importer);
    importer.parseText = fixed.parseText;
    importer.mergeWorksheetRows = fixed.mergeWorksheetRows;
    importer.__majorityHeaderFix = true;
    return importer;
  }

  function polishImportCopy(doc) {
    const copy = doc.querySelector('#settingsPanel .panel-copy');
    if (copy) copy.textContent = 'Connect a public Google Sheet, upload an Excel / Numbers / ODS workbook, import CSV or TSV, or paste rows directly. TennisRank finds the useful headers even when the file starts with titles, notes, or blank rows.';
    const urlLabel = doc.querySelector('label[for="sheetUrl"]');
    if (urlLabel) urlLabel.textContent = 'Public or published Google Sheet link';
  }

  function installBrowser(win) {
    const apply = () => {
      const importer = patchImporter(win.TennisRankImportV2);
      if (!importer) return;
      win.parseCSV = importer.parseText;
      win.googleCsvUrl = importer.googleCsvProxyUrl;
      polishImportCopy(win.document);
    };
    if (win.document.readyState === "loading") win.document.addEventListener("DOMContentLoaded", apply, { once: true });
    else apply();
  }

  return { isRepeatedHeader, normalizeResult, postProcessRow, buildParser, patchImporter, polishImportCopy, installBrowser, csvCell };
});
