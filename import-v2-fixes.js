(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) api.installBrowser(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function getSpreadsheetModel() {
    if (typeof globalThis !== "undefined" && globalThis.TennisRankSpreadsheetML) return globalThis.TennisRankSpreadsheetML;
    if (typeof require === "function") {
      try { return require("./spreadsheet-ml.js"); } catch {}
    }
    return null;
  }

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

  function uniqueHeaders(rawHeaders, mappedFields, importer) {
    const used = new Map();
    return rawHeaders.map((raw, index) => {
      const mapped = mappedFields[index] || "column";
      const field = mapped === "column" ? (importer.normalizeHeader(raw) || `column${index + 1}`) : mapped;
      const count = used.get(field) || 0;
      used.set(field, count + 1);
      return count ? `${field}${count + 1}` : field;
    });
  }

  function deterministicHeaderStrength(importer, matrix) {
    const detected = importer.detectHeaderRow(matrix);
    const recognized = (detected.mapping || []).filter(field => field !== "column").length;
    const anchors = (detected.mapping || []).filter(field => ["name", "opponent", "player1", "player2", "winner", "loser", "result", "record", "rank"].includes(field)).length;
    return { detected, recognized, anchors };
  }

  function semanticSecondaryHeader(importer, values) {
    const nonEmpty = values.filter(value => String(value || "").trim()).length;
    if (nonEmpty < 2) return null;
    const mapping = values.map(importer.canonicalField);
    const recognized = mapping.filter(field => field !== "column").length;
    const structuralAnchors = mapping.filter(field => ["name", "opponent", "player1", "player2", "winner", "loser", "result", "record", "rank"].includes(field)).length;
    return structuralAnchors >= 2 && recognized / nonEmpty >= 0.6 ? mapping : null;
  }

  function buildParser(importer) {
    function parseText(text, sourceName) {
      const ml = getSpreadsheetModel();
      const parsed = importer.parseDelimited(text);
      if (!parsed.matrix.length) return [];

      if (ml?.parseOutcomeMatrix) {
        const matrixRows = ml.parseOutcomeMatrix(parsed.matrix, sourceName);
        if (matrixRows?.length) return matrixRows;
      }

      const originalDeterministic = deterministicHeaderStrength(importer, parsed.matrix);
      let workingMatrix = parsed.matrix;
      let orientation = "rows";
      let inferred = null;
      if (ml?.inferTable && (originalDeterministic.recognized < 2 || originalDeterministic.anchors < 1)) {
        inferred = ml.inferTable(parsed.matrix, sourceName);
        if (inferred?.matrix?.length) {
          workingMatrix = inferred.matrix;
          orientation = inferred.orientation || "rows";
        }
      }

      const deterministic = workingMatrix === parsed.matrix
        ? originalDeterministic
        : deterministicHeaderStrength(importer, workingMatrix);
      const useMlHeader = Boolean(inferred && inferred.orientation === orientation && inferred.semanticCount >= 2
        && (deterministic.recognized < 2 || deterministic.anchors < 1));
      const headerIndex = useMlHeader ? inferred.index : deterministic.detected.index;
      const rawHeaders = workingMatrix[headerIndex] || [];

      let mlMapping = null;
      if (ml?.reconcilePredictions) {
        const predictions = useMlHeader ? inferred.predictions : null;
        mlMapping = ml.reconcilePredictions(rawHeaders, workingMatrix, headerIndex, sourceName, predictions);
      }

      const mappingMeta = rawHeaders.map((raw, index) => {
        const deterministicField = importer.canonicalField(raw);
        if (deterministicField !== "column") {
          return { source: raw || deterministicField, field: deterministicField, method: "rule", confidence: 1 };
        }
        const mlItem = mlMapping?.[index];
        if (mlItem?.field && mlItem.field !== "column") {
          return { source: raw || `Column ${index + 1}`, field: mlItem.field, method: "ml", confidence: Number(mlItem.confidence || 0) };
        }
        return { source: raw || `Column ${index + 1}`, field: "column", method: "raw", confidence: Number(mlItem?.confidence || 0) };
      });

      let currentHeaders = uniqueHeaders(rawHeaders, mappingMeta.map(item => item.field), importer);
      const rows = [];
      const preHeaderText = workingMatrix.slice(0, headerIndex).flat().join(" ");
      const sourceHints = importer.sectionHints(`${sourceName || ""} ${preHeaderText}`);
      let activeHints = { ...sourceHints };
      const extraMappings = [];

      workingMatrix.slice(headerIndex + 1).forEach((values, offset) => {
        const nonEmpty = values.map(value => String(value ?? "").trim()).filter(Boolean);
        if (!nonEmpty.length) return;

        const rowHints = importer.sectionHints(nonEmpty.join(" "));
        if (nonEmpty.length <= 2 && (rowHints.gender || rowHints.division)) {
          if (rowHints.gender) activeHints.gender = rowHints.gender;
          if (rowHints.division) activeHints.division = rowHints.division;
          return;
        }

        const secondaryMapping = semanticSecondaryHeader(importer, values);
        if (secondaryMapping) {
          currentHeaders = uniqueHeaders(values, secondaryMapping, importer);
          extraMappings.push(...values.map((source, index) => ({ source, field: currentHeaders[index], method: "secondary-rule", confidence: 1 })));
          return;
        }

        if (isRepeatedHeader(importer, values, currentHeaders)) return;
        const row = Object.fromEntries(currentHeaders.map((header, index) => [header, String(values[index] ?? "").trim()]));
        row.__sourceRow = headerIndex + offset + 2;
        if (sourceName) row.__sheetName = sourceName;
        if (activeHints.gender && !row.gender) row.gender = activeHints.gender;
        if (activeHints.division && !row.division) row.division = activeHints.division;
        postProcessRow(row);
        if (Object.entries(row).some(([key, value]) => !key.startsWith("__") && String(value || "").trim())) rows.push(row);
      });

      const mlItems = mappingMeta.filter(item => item.method === "ml");
      const mlConfidence = mlItems.length
        ? mlItems.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / mlItems.length
        : (deterministic.recognized >= 2 ? 1 : Number(inferred?.confidence || 0));
      const review = ml?.assessRows ? ml.assessRows(rows) : null;
      rows.__analysis = {
        headerRow: headerIndex + 1,
        delimiter: orientation === "transposed" ? "transposed" : parsed.delimiter === "\t" ? "tab" : parsed.delimiter === "|" ? "pipe" : parsed.delimiter,
        orientation,
        columns: rawHeaders.filter(Boolean),
        mapping: [...mappingMeta, ...extraMappings],
        sourceName: sourceName || "",
        engine: ml ? "v3-hybrid-ml" : "v2-fixed",
        modelVersion: ml?.MODEL_VERSION || null,
        mlConfidence,
        review,
      };
      return rows;
    }

    function mergeWorksheetRows(sheets) {
      const merged = [];
      const names = [];
      const analyses = [];
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
        if (rows.__analysis) analyses.push(rows.__analysis);
      }
      const ml = getSpreadsheetModel();
      const confidenceValues = analyses.map(item => Number(item.mlConfidence || item.confidence || 0)).filter(Number.isFinite);
      const mlConfidence = confidenceValues.length ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length : 0;
      merged.__analysis = {
        headerRow: 1,
        delimiter: "workbook",
        columns: [],
        mapping: analyses.flatMap(item => item.mapping || []),
        sourceName: names.join(", "),
        sheets: names,
        sheetAnalyses: analyses,
        engine: ml ? "v3-hybrid-ml" : "v2-fixed",
        modelVersion: ml?.MODEL_VERSION || null,
        mlConfidence,
        review: ml?.assessRows ? ml.assessRows(merged) : null,
      };
      return merged;
    }

    return { parseText, mergeWorksheetRows };
  }

  function patchImporter(importer) {
    if (!importer || importer.__majorityHeaderFix) return importer;
    const fixed = buildParser(importer);
    importer.parseText = fixed.parseText;
    importer.mergeWorksheetRows = fixed.mergeWorksheetRows;
    importer.validateInterpretation = rows => {
      const ml = getSpreadsheetModel();
      return ml?.assessRows ? ml.assessRows(rows) : { valid: true, confidence: 1, level: "HIGH", reason: "Rule-based parser." };
    };
    importer.__majorityHeaderFix = true;
    importer.__spreadsheetML = Boolean(getSpreadsheetModel());
    return importer;
  }

  function polishImportCopy(doc) {
    const copy = doc.querySelector('#settingsPanel .panel-copy');
    if (copy) copy.textContent = 'Connect a public Google Sheet, upload an Excel / Numbers / ODS workbook, import CSV or TSV, or paste rows directly. TennisRank uses a tennis-trained schema model plus deterministic validation to understand unfamiliar layouts without silently guessing.';
    const urlLabel = doc.querySelector('label[for="sheetUrl"]');
    if (urlLabel) urlLabel.textContent = 'Public or published Google Sheet link';
    const guide = doc.querySelector('.format-guide span');
    if (guide) guide.textContent = 'The importer can recover unfamiliar column names, title rows, sectioned Boys/Girls or Singles/Doubles blocks, transposed tables, outcome matrices, aggregate standings, and player/opponent W-L logs. Low-confidence interpretations are blocked from publishing.';
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

  return { isRepeatedHeader, normalizeResult, postProcessRow, buildParser, patchImporter, polishImportCopy, installBrowser, csvCell, getSpreadsheetModel };
});
