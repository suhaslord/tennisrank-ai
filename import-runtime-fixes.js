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
    if (!rows.length) throw new Error("No usable tennis rows were found in this workbook.");
    return rows;
  }

  function isWorkbook(file) {
    const name = String(file?.name || "").toLowerCase();
    return /\.(xlsx|xlsm|xlsb|xls|ods|fods|numbers)$/i.test(name)
      || /spreadsheet|excel|opendocument|numbers/i.test(String(file?.type || ""));
  }

  function installBrowser(win) {
    const doc = win.document;
    const boot = () => {
      // Register before import-v2's workbook capture listener. This handler owns
      // binary workbook imports and stops the legacy FileReader text path.
      const input = doc.querySelector("#csvFile");
      if (input && !input.dataset.importRuntimeBound) {
        input.dataset.importRuntimeBound = "true";
        input.addEventListener("change", async event => {
          const file = event.target.files?.[0];
          if (!file || !isWorkbook(file)) return;
          event.stopImmediatePropagation();
          const button = doc.querySelector("#useCsv");
          try {
            if (typeof win.setBusy === "function") win.setBusy(button, true);
            if (typeof win.setStatus === "function") win.setStatus(`Reading ${file.name}...`);
            const rows = await workbookRows(file, win.XLSX, win.TennisRankImportV2);
            if (typeof win.loadRows !== "function") throw new Error("The TennisRank importer is not ready yet.");
            win.loadRows(rows, "file");
            if (typeof win.setStatus === "function") {
              win.setStatus(`Loaded ${rows.length} rows from ${rows.__analysis?.sheets?.length || 1} worksheet(s). Saving to the shared database...`);
            }
            if (typeof win.syncToBackend === "function") {
              try {
                await win.syncToBackend();
                if (typeof win.setStatus === "function") win.setStatus(`Loaded and saved ${file.name}.`);
              } catch (error) {
                if (typeof win.setStatus === "function") win.setStatus(`Loaded the workbook, but it was not published: ${error.message}`, true);
              }
            }
          } catch (error) {
            if (typeof win.setStatus === "function") win.setStatus(error.message, true);
          } finally {
            if (typeof win.setBusy === "function") win.setBusy(button, false);
          }
        }, true);
      }

      // import-v2 boots on the same DOMContentLoaded event. Run immediately
      // afterwards so text and pasted imports get the same side normalization.
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
      }, 0);
    };

    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }

  return { sidePointer, normalizeRows, workbookRows, isWorkbook, installBrowser };
});
