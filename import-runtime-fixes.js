(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankImportRuntime = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WORKBOOK_ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.xls,.ods,.fods,.numbers,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet";
  const STRUCTURAL_HEADER_FIELDS = new Set(["name", "firstName", "lastName", "opponent", "player1", "player2", "winner", "loser", "record", "rank"]);

  function sidePointer(value) {
    const raw = String(value || "").trim();
    const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["home", "host", "teama", "team1", "playera", "player1", "sidea", "side1"].includes(normalized)) return "Player A";
    if (["away", "visitor", "guest", "teamb", "team2", "playerb", "player2", "sideb", "side2"].includes(normalized)) return "Player B";
    return raw;
  }

  function normalizeResult(value) {
    const pointed = sidePointer(value);
    if (pointed === "Player A" || pointed === "Player B") return pointed;
    const text = String(pointed || "").trim();
    if (/^(?:w|win|won|winner)$/i.test(text)) return "W";
    if (/^(?:l|loss|lost|loser)$/i.test(text)) return "L";
    return text;
  }

  function normalizeCanonicalRow(row) {
    if (!row) return row;
    if (row.winner) row.winner = sidePointer(row.winner);
    if (row.loser) row.loser = sidePointer(row.loser);
    if (row.result) row.result = normalizeResult(row.result);
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

  function normalizeRows(rows) {
    for (const row of rows || []) normalizeCanonicalRow(row);
    return rows;
  }

  function validateRows(rows, importer) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("No usable tennis rows were found in this spreadsheet.");
    if (!importer || typeof importer.validateInterpretation !== "function") return { valid: true, confidence: 1, level: "HIGH" };
    const review = importer.validateInterpretation(rows);
    if (rows.__analysis) rows.__analysis.review = review;
    if (!review.valid) {
      const percent = Math.round(Number(review.confidence || 0) * 100);
      throw new Error(`${review.reason} Confidence ${percent}%. Rename ambiguous columns or add Player/Opponent/Result, Winner/Loser, or Rank/Record fields and try again.`);
    }
    return review;
  }

  function reviewWithoutThrow(rows, importer) {
    try {
      return validateRows(rows, importer);
    } catch (error) {
      return { valid: false, confidence: Number(rows?.__analysis?.review?.confidence || 0), level: "LOW", reason: error.message };
    }
  }

  function structuralHeaderIndex(matrix, importer) {
    const semantic = typeof importer?.detectHeaderRow === "function" ? importer.detectHeaderRow(matrix) : null;
    const semanticStructural = (semantic?.mapping || []).filter(field => STRUCTURAL_HEADER_FIELDS.has(field)).length;
    // Values such as W, Boys and Singles are legitimate data and can also look
    // like result/gender/division headers. Never let those value-like semantics
    // alone select a data row as the header. A semantic header needs at least
    // two structural labels (Player/Opponent, Winner/Loser, Rank/Player, etc.).
    if (semanticStructural >= 2 && Number.isInteger(semantic.index)) return semantic.index;

    let best = { index: 0, score: -Infinity };
    for (let index = 0; index < Math.min(matrix.length, 40); index += 1) {
      const row = matrix[index] || [];
      const nonEmpty = row.filter(value => String(value || "").trim()).length;
      if (nonEmpty < 2) continue;
      const width = row.length;
      const followers = matrix.slice(index + 1, index + 7).filter(candidate => (candidate || []).some(value => String(value || "").trim()));
      const similar = followers.filter(candidate => Math.abs(candidate.length - width) <= 1 && candidate.filter(value => String(value || "").trim()).length >= Math.max(2, Math.floor(nonEmpty * 0.55))).length;
      const unique = new Set(row.map(value => String(value || "").trim().toLowerCase()).filter(Boolean)).size;
      const score = nonEmpty * 2 + similar * 3 + Math.min(unique, nonEmpty) * 0.35 - index * 0.08;
      if (score > best.score) best = { index, score };
    }
    return best.index;
  }

  function uniqueRawHeaders(values) {
    const seen = new Map();
    return (values || []).map((value, index) => {
      const base = String(value || "").trim() || `Column ${index + 1}`;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count ? `${base} (${count + 1})` : base;
    });
  }

  function rawRowsFromText(text, sourceName, importer) {
    if (!importer || typeof importer.parseDelimited !== "function") return [];
    const parsed = importer.parseDelimited(String(text || "").replace(/^\uFEFF/, ""));
    const matrix = parsed.matrix || [];
    if (!matrix.length) return [];
    const headerIndex = structuralHeaderIndex(matrix, importer);
    const headers = uniqueRawHeaders(matrix[headerIndex] || []);
    const rows = matrix.slice(headerIndex + 1).map((values, offset) => {
      const row = Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "").trim()]));
      row.__sourceRow = headerIndex + offset + 2;
      if (sourceName) row.__sheetName = sourceName;
      return row;
    }).filter(row => Object.entries(row).some(([key, value]) => !key.startsWith("__") && String(value || "").trim()));
    rows.__analysis = {
      headerRow: headerIndex + 1,
      delimiter: parsed.delimiter === "\t" ? "tab" : parsed.delimiter === "|" ? "pipe" : parsed.delimiter,
      columns: headers,
      mapping: headers.map(header => ({ source: header, field: header, method: "raw-source", confidence: 1 })),
      sourceName: sourceName || "",
      engine: "raw-source-for-ai",
    };
    return rows;
  }

  async function processTextWithAi(win, text, source, sourceName) {
    const importer = win?.TennisRankImportV2 || (typeof globalThis !== "undefined" ? globalThis.TennisRankImportV2 : null);
    if (!importer || typeof importer.parseText !== "function") throw new Error("The TennisRank spreadsheet importer is not ready yet.");
    const localRows = normalizeRows(importer.parseText(String(text || ""), sourceName || "Tennis spreadsheet"));
    const localReview = reviewWithoutThrow(localRows, importer);
    const ai = win?.TennisRankSpreadsheetAI || (typeof globalThis !== "undefined" ? globalThis.TennisRankSpreadsheetAI : null);
    if (!ai || typeof ai.enhanceRows !== "function") {
      validateRows(localRows, importer);
      return localRows;
    }

    const rawRows = rawRowsFromText(text, sourceName, importer);
    if (!rawRows.length) {
      validateRows(localRows, importer);
      return localRows;
    }

    try {
      let aiRows = await ai.enhanceRows(rawRows, {
        source: source || "file",
        sourceName: sourceName || "Tennis spreadsheet",
        importer,
        auth: win?.TennisRankAuth || (typeof globalThis !== "undefined" ? globalThis.TennisRankAuth : null),
      });
      aiRows = normalizeRows(aiRows);
      const aiReview = reviewWithoutThrow(aiRows, importer);
      if (aiReview.valid) {
        if (aiRows.__analysis) aiRows.__analysis.review = aiReview;
        return aiRows;
      }
      if (localReview.valid) return localRows;
      throw new Error(aiReview.reason || localReview.reason || "The spreadsheet could not be interpreted safely.");
    } catch (error) {
      const fallbackCodes = new Set(["AI_NOT_CONFIGURED", "AI_AUTH_UNAVAILABLE"]);
      if (localReview.valid && (fallbackCodes.has(error?.code) || error?.status === 429 || Number(error?.status) >= 500)) return localRows;
      throw error;
    }
  }

  async function maybeEnhanceRows(rows, importer, sourceName) {
    const ai = typeof globalThis !== "undefined" ? globalThis.TennisRankSpreadsheetAI : null;
    if (!ai || typeof ai.enhanceRows !== "function") return rows;
    return ai.enhanceRows(rows, {
      source: "file",
      sourceName: sourceName || "Uploaded spreadsheet",
      importer,
      auth: typeof globalThis !== "undefined" ? globalThis.TennisRankAuth : null,
    });
  }

  async function prepareWorksheet(sheet, importer, options = {}) {
    const name = String(sheet?.name || "Sheet");
    const text = String(sheet?.text || "");
    if (!text.trim()) return { accepted: false, name, reason: "Empty worksheet." };
    if (!importer || typeof importer.parseText !== "function") throw new Error("The TennisRank spreadsheet importer is not ready yet.");

    let rows;
    const browserLike = typeof globalThis !== "undefined" && globalThis.TennisRankSpreadsheetAI && globalThis.TennisRankImportV2;
    if (options.useAi !== false && browserLike) {
      try {
        rows = await processTextWithAi(globalThis, text, "file", name);
      } catch (error) {
        return { accepted: false, name, reason: error.message || "AI verification rejected this worksheet." };
      }
    } else {
      rows = normalizeRows(importer.parseText(text, name));
    }

    if (!rows.length) return { accepted: false, name, reason: "No usable rows." };
    const review = reviewWithoutThrow(rows, importer);
    if (!review.valid) return { accepted: false, name, reason: review.reason || "Worksheet did not pass tennis validation." };
    if (rows.__analysis) rows.__analysis.review = review;
    return { accepted: true, name, rows, review };
  }

  function mergeAcceptedWorksheets(results, importer) {
    const accepted = (results || []).filter(result => result?.accepted && Array.isArray(result.rows));
    const rejected = (results || []).filter(result => !result?.accepted);
    if (!accepted.length) {
      const reasons = rejected.slice(0, 4).map(item => `${item.name}: ${item.reason}`).join(" ");
      throw new Error(`No worksheet contained safe tennis ranking data.${reasons ? ` ${reasons}` : ""}`);
    }

    const merged = [];
    accepted.forEach(result => result.rows.forEach(row => merged.push(row)));
    const sheetAnalyses = accepted.map(result => ({
      ...(result.rows.__analysis || {}),
      sheetName: result.name,
      review: result.review,
    }));
    const confidences = accepted.map(result => Number(result.review?.confidence || 0)).filter(Number.isFinite);
    const averageConfidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0;
    merged.__analysis = {
      headerRow: 1,
      delimiter: "workbook",
      columns: [],
      mapping: sheetAnalyses.flatMap(item => item.mapping || []),
      sourceName: accepted.map(item => item.name).join(", "),
      sheets: accepted.map(item => item.name),
      rejectedSheets: rejected.map(item => ({ name: item.name, reason: item.reason })),
      sheetAnalyses,
      engine: "v4-workbook-isolated-raw-ai",
      mlConfidence: averageConfidence,
    };
    const finalReview = validateRows(merged, importer);
    merged.__analysis.review = finalReview;
    return merged;
  }

  async function workbookRows(file, XLSX, importer) {
    if (!XLSX || typeof XLSX.read !== "function") throw new Error("Spreadsheet support is still loading. Try again in a moment.");
    if (!importer || typeof importer.parseText !== "function") throw new Error("The TennisRank spreadsheet importer is not ready yet.");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheets = [];
    for (const name of workbook.SheetNames || []) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const text = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ",", RS: "\n" });
      if (text.trim()) sheets.push({ name, text });
    }
    const results = [];
    for (const sheet of sheets) results.push(await prepareWorksheet(sheet, importer));
    return mergeAcceptedWorksheets(results, importer);
  }

  async function textRows(file, importer) {
    if (!importer || typeof importer.parseText !== "function") throw new Error("The TennisRank spreadsheet importer is not ready yet.");
    const text = await file.text();
    if (!String(text || "").trim()) throw new Error("This file is empty.");
    const browserLike = typeof globalThis !== "undefined" && globalThis.TennisRankSpreadsheetAI && globalThis.TennisRankImportV2;
    const rows = browserLike
      ? await processTextWithAi(globalThis, text, "file", file.name || "Uploaded file")
      : normalizeRows(importer.parseText(text, file.name || "Uploaded file"));
    validateRows(rows, importer);
    return rows;
  }

  function isWorkbook(file) {
    const name = String(file?.name || "").toLowerCase();
    return /\.(xlsx|xlsm|xlsb|xls|ods|fods|numbers)$/i.test(name)
      || /spreadsheet|excel|opendocument|numbers/i.test(String(file?.type || ""));
  }

  async function rowsFromFile(file, XLSX, importer) {
    return isWorkbook(file) ? workbookRows(file, XLSX, importer) : textRows(file, importer);
  }

  function aiLabel(rows) {
    const ai = rows?.__analysis?.ai;
    if (!ai) return "local parser verified";
    if (ai.status === "applied-and-validated") return `${ai.model || "AI"} + local validation`;
    if (ai.status === "cached-schema") return `${ai.model || "AI"} cached schema + local validation`;
    if (ai.status === "verified-kept-local" || ai.status === "disagreed-kept-local") return `${ai.model || "AI"} checked; local interpretation kept`;
    if (ai.status === "not-configured") return "local parser verified; AI key not configured";
    if (ai.status === "unavailable") return "local parser verified; AI temporarily unavailable";
    return "AI + local validation";
  }

  function ignoredSheetSummary(rows) {
    const ignored = rows?.__analysis?.rejectedSheets || [];
    if (!ignored.length) return "";
    const names = ignored.slice(0, 3).map(item => item.name).join(", ");
    return ` Ignored ${ignored.length} non-tennis/unsafe worksheet${ignored.length === 1 ? "" : "s"}${names ? ` (${names}${ignored.length > 3 ? ", …" : ""})` : ""}.`;
  }

  async function importSelectedFile(win, file) {
    if (!file) throw new Error("Choose a spreadsheet file first.");
    const importer = win.TennisRankImportV2;
    const button = win.document.querySelector("#useCsv");
    if (typeof win.setBusy === "function") win.setBusy(button, true);
    try {
      if (typeof win.setStatus === "function") win.setStatus(`Reading ${file.name} and validating each worksheet independently...`);
      const rows = await rowsFromFile(file, win.XLSX, importer);
      if (typeof win.loadRows !== "function") throw new Error("The TennisRank importer is not ready yet.");
      win.loadRows(rows, "file");
      const sheets = rows.__analysis?.sheets?.length;
      const confidence = Math.round(Number(rows.__analysis?.review?.confidence || rows.__analysis?.mlConfidence || 0) * 100);
      if (typeof win.setStatus === "function") {
        win.setStatus(sheets
          ? `Loaded ${rows.length} rows from ${sheets} trusted worksheet${sheets === 1 ? "" : "s"} at ${confidence}% confidence.${ignoredSheetSummary(rows)} Saving...`
          : `Loaded ${rows.length} rows from ${file.name} at ${confidence}% confidence. Saving...`);
      }
      if (typeof win.syncToBackend === "function") {
        try {
          await win.syncToBackend();
          if (typeof win.setStatus === "function") win.setStatus(`Loaded and saved ${file.name}.${ignoredSheetSummary(rows)}`);
        } catch (error) {
          if (typeof win.setStatus === "function") win.setStatus(`Loaded the file, but it was not published: ${error.message}`, true);
        }
      }
      return rows;
    } finally {
      if (typeof win.setBusy === "function") win.setBusy(button, false);
    }
  }

  async function importPastedText(win) {
    const text = String(win.document.querySelector("#csvText")?.value || "");
    if (!text.trim()) throw new Error("Paste spreadsheet data first.");
    const button = win.document.querySelector("#useCsv");
    if (typeof win.setBusy === "function") win.setBusy(button, true);
    try {
      if (typeof win.setStatus === "function") win.setStatus("Reading the original columns, then asking TennisRank AI to verify the schema...");
      const rows = await processTextWithAi(win, text, "csv", "Pasted tennis data");
      win.loadRows(rows, "csv");
      if (typeof win.setStatus === "function") win.setStatus(`Loaded ${rows.length} verified rows. Saving...`);
      if (typeof win.syncToBackend === "function") await win.syncToBackend();
      if (typeof win.setStatus === "function") win.setStatus(`Loaded, verified, and saved ${rows.length} rows.`);
      return rows;
    } finally {
      if (typeof win.setBusy === "function") win.setBusy(button, false);
    }
  }

  async function fetchGoogleSheetRows(win, input) {
    const importer = win.TennisRankImportV2;
    if (!importer?.googleCsvProxyUrl) throw new Error("Google Sheet support is still loading.");
    const proxyUrl = importer.googleCsvProxyUrl(input);
    const response = await fetch(proxyUrl, { cache: "no-store" });
    const text = await response.text();
    if (!response.ok) {
      let message = `The sheet could not be loaded (${response.status}).`;
      try { message = JSON.parse(text).error || message; } catch {}
      throw new Error(message);
    }
    return processTextWithAi(win, text, "sheet", "Google Sheet tennis data");
  }

  async function connectGoogleSheet(win) {
    const doc = win.document;
    const button = doc.querySelector("#connectSheet");
    if (typeof win.setBusy === "function") win.setBusy(button, true);
    try {
      const input = String(doc.querySelector("#sheetUrl")?.value || localStorage.getItem("tennisRankSheetUrl") || "").trim();
      if (!input) throw new Error("Paste a Google Sheet link first.");
      if (typeof win.setStatus === "function") win.setStatus("Loading the Google Sheet through the secure server proxy, then validating its original columns...");
      const rows = await fetchGoogleSheetRows(win, input);
      localStorage.setItem("tennisRankSheetUrl", input);
      win.loadRows(rows, "sheet");
      if (typeof win.setStatus === "function") win.setStatus(`Loaded ${rows.length} verified Google Sheet rows. Saving...`);
      if (typeof win.syncToBackend === "function") await win.syncToBackend();
      if (typeof win.startRefresh === "function") win.startRefresh();
      if (typeof win.setStatus === "function") win.setStatus("Google Sheet verified and saved.");
      return rows;
    } finally {
      if (typeof win.setBusy === "function") win.setBusy(button, false);
    }
  }

  function setFileButtonLabel(doc, file) {
    const button = doc.querySelector("#useCsv");
    const label = button?.querySelector("span");
    if (!label) return;
    label.textContent = file ? `Analyze ${file.name}` : "Use pasted data";
  }

  function installBrowser(win) {
    const doc = win.document;
    const boot = () => {
      const input = doc.querySelector("#csvFile");
      if (input) {
        input.accept = WORKBOOK_ACCEPT;
        const label = doc.querySelector('label[for="csvFile"]');
        if (label) label.textContent = "Upload CSV, Excel, Numbers, or ODS";
      }

      if (input && !input.dataset.importRuntimeBound) {
        input.dataset.importRuntimeBound = "true";
        input.addEventListener("change", async event => {
          const file = event.target.files?.[0];
          if (!file) return;
          event.stopImmediatePropagation();
          setFileButtonLabel(doc, file);
          try {
            await importSelectedFile(win, file);
          } catch (error) {
            if (typeof win.setStatus === "function") win.setStatus(error.message, true);
          }
        }, true);
      }

      const useButton = doc.querySelector("#useCsv");
      if (useButton && !useButton.dataset.importRuntimeActionBound) {
        useButton.dataset.importRuntimeActionBound = "true";
        useButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            const file = doc.querySelector("#csvFile")?.files?.[0];
            if (file) await importSelectedFile(win, file);
            else await importPastedText(win);
          } catch (error) {
            if (typeof win.setStatus === "function") win.setStatus(error.message, true);
          }
        }, true);
      }

      const sheetButton = doc.querySelector("#connectSheet");
      if (sheetButton && !sheetButton.dataset.importRuntimeActionBound) {
        sheetButton.dataset.importRuntimeActionBound = "true";
        sheetButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            await connectGoogleSheet(win);
          } catch (error) {
            if (typeof win.setStatus === "function") win.setStatus(error.message, true);
          }
        }, true);
      }

      setTimeout(() => {
        const importer = win.TennisRankImportV2;
        if (!importer || importer.__runtimeNormalized) return;
        importer.__runtimeNormalized = true;
        const baseParse = importer.parseText.bind(importer);
        const baseMerge = importer.mergeWorksheetRows.bind(importer);
        importer.parseText = (...args) => normalizeRows(baseParse(...args));
        importer.mergeWorksheetRows = (...args) => normalizeRows(baseMerge(...args));
        win.parseCSV = importer.parseText;
        win.googleCsvUrl = importer.googleCsvProxyUrl;
        win.fetchSheet = async () => {
          const inputUrl = String(doc.querySelector("#sheetUrl")?.value || localStorage.getItem("tennisRankSheetUrl") || "").trim();
          if (!inputUrl) throw new Error("Paste a Google Sheet link first.");
          const rows = await fetchGoogleSheetRows(win, inputUrl);
          win.loadRows(rows, "sheet");
          return rows;
        };

        if (typeof win.loadRows === "function" && !win.loadRows.__tennisrankValidated) {
          const baseLoadRows = win.loadRows;
          const validatedLoadRows = function (rows, source) {
            let candidate = rows;
            if (source !== "sample" && win.TennisRankSpreadsheetAI?.applyCachedMapping) {
              candidate = win.TennisRankSpreadsheetAI.applyCachedMapping(candidate);
              candidate = normalizeRows(candidate);
            }
            if (source !== "sample") validateRows(candidate, importer);
            return baseLoadRows(candidate, source);
          };
          validatedLoadRows.__tennisrankValidated = true;
          win.loadRows = validatedLoadRows;
        }
      }, 0);
    };

    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }

  return {
    WORKBOOK_ACCEPT,
    STRUCTURAL_HEADER_FIELDS,
    sidePointer,
    normalizeResult,
    normalizeCanonicalRow,
    normalizeRows,
    validateRows,
    reviewWithoutThrow,
    structuralHeaderIndex,
    uniqueRawHeaders,
    rawRowsFromText,
    processTextWithAi,
    maybeEnhanceRows,
    prepareWorksheet,
    mergeAcceptedWorksheets,
    workbookRows,
    textRows,
    rowsFromFile,
    isWorkbook,
    aiLabel,
    ignoredSheetSummary,
    importSelectedFile,
    importPastedText,
    fetchGoogleSheetRows,
    connectGoogleSheet,
    setFileButtonLabel,
    installBrowser,
  };
});
