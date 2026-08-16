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

  function sidePointer(value) {
    const raw = String(value || "").trim();
    const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["home", "host", "teama", "team1", "playera", "player1", "sidea", "side1"].includes(normalized)) return "Player A";
    if (["away", "visitor", "guest", "teamb", "team2", "playerb", "player2", "sideb", "side2"].includes(normalized)) return "Player B";
    return raw;
  }

  function normalizeRows(rows) {
    for (const row of rows || []) {
      if (row && row.winner) row.winner = sidePointer(row.winner);
      if (row && row.loser) row.loser = sidePointer(row.loser);
      if (row && row.result) row.result = sidePointer(row.result);
    }
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

  function reviewWithoutThrow(rows, importer) {
    try {
      return validateRows(rows, importer);
    } catch (error) {
      return { valid: false, confidence: Number(rows?.__analysis?.review?.confidence || 0), level: "LOW", reason: error.message };
    }
  }

  async function prepareWorksheet(sheet, importer, options = {}) {
    const name = String(sheet?.name || "Sheet");
    const text = String(sheet?.text || "");
    if (!text.trim()) return { accepted: false, name, reason: "Empty worksheet." };
    if (!importer || typeof importer.parseText !== "function") throw new Error("The TennisRank spreadsheet importer is not ready yet.");

    let rows = normalizeRows(importer.parseText(text, name));
    if (!rows.length) return { accepted: false, name, reason: "No usable rows." };

    let review = reviewWithoutThrow(rows, importer);
    const shouldAskAi = options.useAi !== false && (!review.valid || Number(review.confidence || 0) < 0.72);
    if (shouldAskAi) {
      try {
        rows = normalizeRows(await maybeEnhanceRows(rows, importer, name));
        review = reviewWithoutThrow(rows, importer);
      } catch (error) {
        return { accepted: false, name, reason: error.message || "AI verification rejected this worksheet." };
      }
    }

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
      engine: "v3-workbook-isolated",
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
    let rows = normalizeRows(importer.parseText(text, file.name || "Uploaded file"));
    rows = normalizeRows(await maybeEnhanceRows(rows, importer, file?.name || "Uploaded text file"));
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
      if (useButton && !useButton.dataset.selectedFileGuard) {
        useButton.dataset.selectedFileGuard = "true";
        useButton.addEventListener("click", async event => {
          const file = doc.querySelector("#csvFile")?.files?.[0];
          if (!file) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            await importSelectedFile(win, file);
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
    sidePointer,
    normalizeRows,
    validateRows,
    reviewWithoutThrow,
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
    setFileButtonLabel,
    installBrowser,
  };
});
