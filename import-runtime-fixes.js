(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankImportRuntime = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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

  async function workbookRows(file, XLSX, importer) {
    if (!XLSX || typeof XLSX.read !== "function") throw new Error("Spreadsheet support is still loading. Try again in a moment.");
    if (!importer || typeof importer.mergeWorksheetRows !== "function") throw new Error("The TennisRank spreadsheet importer is not ready yet.");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheets = [];
    for (const name of workbook.SheetNames || []) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const text = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ",", RS: "\n" });
      if (text.trim()) sheets.push({ name, text });
    }
    const rows = normalizeRows(importer.mergeWorksheetRows(sheets));
    validateRows(rows, importer);
    return rows;
  }

  async function textRows(file, importer) {
    if (!importer || typeof importer.parseText !== "function") throw new Error("The TennisRank spreadsheet importer is not ready yet.");
    const text = await file.text();
    if (!String(text || "").trim()) throw new Error("This file is empty.");
    const rows = normalizeRows(importer.parseText(text, file.name || "Uploaded file"));
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

  function installBrowser(win) {
    const doc = win.document;
    const boot = () => {
      // Register before import-v2 and the legacy FileReader listener. One path
      // now owns every uploaded spreadsheet, so CSV/TSV and binary workbooks
      // receive the same normalization and confidence validation.
      const input = doc.querySelector("#csvFile");
      if (input && !input.dataset.importRuntimeBound) {
        input.dataset.importRuntimeBound = "true";
        input.addEventListener("change", async event => {
          const file = event.target.files?.[0];
          if (!file) return;
          event.stopImmediatePropagation();
          const button = doc.querySelector("#useCsv");
          try {
            if (typeof win.setBusy === "function") win.setBusy(button, true);
            if (typeof win.setStatus === "function") win.setStatus(`Reading ${file.name} with TennisRank Spreadsheet Intelligence...`);
            const rows = await rowsFromFile(file, win.XLSX, win.TennisRankImportV2);
            if (typeof win.loadRows !== "function") throw new Error("The TennisRank importer is not ready yet.");
            win.loadRows(rows, "file");
            if (typeof win.setStatus === "function") {
              const sheets = rows.__analysis?.sheets?.length;
              const confidence = Math.round(Number(rows.__analysis?.review?.confidence || rows.__analysis?.mlConfidence || 0) * 100);
              win.setStatus(sheets
                ? `Loaded ${rows.length} rows from ${sheets} worksheet(s) at ${confidence}% interpretation confidence. Saving...`
                : `Loaded ${rows.length} rows from ${file.name} at ${confidence}% interpretation confidence. Saving...`);
            }
            if (typeof win.syncToBackend === "function") {
              try {
                await win.syncToBackend();
                if (typeof win.setStatus === "function") win.setStatus(`Loaded, validated, and saved ${file.name}.`);
              } catch (error) {
                if (typeof win.setStatus === "function") win.setStatus(`Loaded the file, but it was not published: ${error.message}`, true);
              }
            }
          } catch (error) {
            if (typeof win.setStatus === "function") win.setStatus(error.message, true);
          } finally {
            if (typeof win.setBusy === "function") win.setBusy(button, false);
          }
        }, true);
      }

      // import-v2 boots on the same DOMContentLoaded event. Run after importer
      // modules initialize so pasted, uploaded, Google-Sheet and restored data
      // all pass through the same safety gate.
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
            if (source !== "sample") validateRows(rows, importer);
            return baseLoadRows(rows, source);
          };
          validatedLoadRows.__tennisrankValidated = true;
          win.loadRows = validatedLoadRows;
        }
      }, 0);
    };

    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }

  return { sidePointer, normalizeRows, validateRows, workbookRows, textRows, rowsFromFile, isWorkbook, installBrowser };
});
