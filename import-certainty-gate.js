(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankImportCertainty = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CERTAINTY_THRESHOLD = 0.85;
  const AI_WEIGHT = 0.55;
  const LOCAL_WEIGHT = 0.45;
  const VALIDATED_BONUS = 0.04;
  const STYLE_ID = "tennisrank-certainty-style";
  const METER_ID = "tennisrankCertaintyMeter";

  function clamp01(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  }

  function percent(value) {
    return Math.round(clamp01(value) * 100);
  }

  function reviewConfidence(review) {
    return clamp01(review?.confidence);
  }

  function shouldEscalate(review, threshold = CERTAINTY_THRESHOLD) {
    return !review?.valid || reviewConfidence(review) < threshold;
  }

  function aiConfidenceFromRows(rows) {
    const ai = rows?.__analysis?.ai || {};
    const overall = clamp01(ai.confidence);
    if (overall) return overall;
    const mappings = Array.isArray(ai.mappings) ? ai.mappings : [];
    const usable = mappings
      .filter(item => item?.target && item.target !== "ignore")
      .map(item => clamp01(item.confidence))
      .filter(Boolean);
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
  }

  function combinedCertainty(localReview, finalReview, aiConfidence, aiUsed) {
    const local = reviewConfidence(localReview);
    const validated = reviewConfidence(finalReview || localReview);
    if (!aiUsed) return validated || local;
    const provider = clamp01(aiConfidence);
    if (!finalReview?.valid || !provider) return Math.max(local, validated);
    return clamp01(validated * LOCAL_WEIGHT + provider * AI_WEIGHT + VALIDATED_BONUS);
  }

  function cloneAnalysis(rows) {
    const analysis = rows?.__analysis || {};
    return {
      ...analysis,
      mapping: Array.isArray(analysis.mapping) ? analysis.mapping.map(item => ({ ...item })) : [],
      sheetAnalyses: Array.isArray(analysis.sheetAnalyses) ? analysis.sheetAnalyses.map(item => ({ ...item })) : analysis.sheetAnalyses,
    };
  }

  function attachCertainty(rows, detail = {}) {
    if (!Array.isArray(rows)) return rows;
    const analysis = cloneAnalysis(rows);
    const final = clamp01(detail.final);
    analysis.certainty = {
      threshold: CERTAINTY_THRESHOLD,
      local: clamp01(detail.local),
      aiUsed: detail.aiUsed === true,
      ai: clamp01(detail.ai),
      final,
      status: detail.status || (final >= CERTAINTY_THRESHOLD ? (detail.aiUsed ? "google-ai-verified" : "trusted-local") : "needs-review"),
      model: String(detail.model || analysis.ai?.model || ""),
    };
    if (detail.review) analysis.review = detail.review;
    rows.__analysis = analysis;
    return rows;
  }

  function reviewRows(rows, importer, runtime) {
    if (runtime?.reviewWithoutThrow) return runtime.reviewWithoutThrow(rows, importer);
    if (importer?.validateInterpretation) {
      try {
        const review = importer.validateInterpretation(rows);
        return review && typeof review === "object" ? review : { valid: true, confidence: 1, level: "HIGH" };
      } catch (error) {
        return { valid: false, confidence: 0, level: "LOW", reason: error?.message || "Spreadsheet interpretation failed." };
      }
    }
    return { valid: true, confidence: 1, level: "HIGH", reason: "Rule-based interpretation." };
  }

  function normalizeRows(rows, runtime) {
    if (runtime?.normalizeRows) return runtime.normalizeRows(rows);
    return rows;
  }

  function lowCertaintyError(rows, localReview, finalReview, aiUsed) {
    const certainty = rows?.__analysis?.certainty?.final || reviewConfidence(finalReview || localReview);
    const error = new Error(
      aiUsed
        ? `Certainty is ${percent(certainty)}% after Google AI verification. TennisRank needs at least 85% before publishing, so nothing was saved. Review the detected columns or clarify the sheet and try again.`
        : `Certainty is ${percent(certainty)}%. TennisRank needs at least 85% before publishing.`,
    );
    error.code = "LOW_CERTAINTY";
    error.certainty = certainty;
    error.rows = rows;
    return error;
  }

  async function interpretText(textInput, options = {}) {
    const importer = options.importer;
    const runtime = options.runtime;
    const ai = options.ai;
    const sourceName = String(options.sourceName || "Tennis spreadsheet");
    const source = String(options.source || "file");
    if (!importer?.parseText) throw new Error("The TennisRank spreadsheet importer is not ready yet.");

    const localRows = normalizeRows(importer.parseText(String(textInput || ""), sourceName), runtime);
    if (!Array.isArray(localRows) || !localRows.length) {
      const error = new Error("No usable tennis rows were found in this spreadsheet.");
      error.code = "NO_USABLE_ROWS";
      throw error;
    }
    const localReview = reviewRows(localRows, importer, runtime);
    const localCertainty = reviewConfidence(localReview);

    if (!shouldEscalate(localReview)) {
      attachCertainty(localRows, {
        local: localCertainty,
        aiUsed: false,
        ai: 0,
        final: localCertainty,
        status: "trusted-local",
        review: localReview,
      });
      return localRows;
    }

    if (!ai?.enhanceRows) {
      attachCertainty(localRows, {
        local: localCertainty,
        aiUsed: false,
        final: localCertainty,
        status: "needs-review",
        review: localReview,
      });
      throw lowCertaintyError(localRows, localReview, localReview, false);
    }

    let rawRows = runtime?.rawRowsFromText
      ? runtime.rawRowsFromText(String(textInput || ""), sourceName, importer)
      : localRows;
    if (!Array.isArray(rawRows) || !rawRows.length) rawRows = localRows;

    let aiRows;
    try {
      aiRows = await ai.enhanceRows(rawRows, {
        source,
        sourceName,
        importer,
        auth: options.auth || null,
      });
    } catch (error) {
      if (/does not look like usable tennis ranking data/i.test(String(error?.message || ""))) {
        error.code = error.code || "UNSUPPORTED_SHEET";
      }
      throw error;
    }

    aiRows = normalizeRows(aiRows, runtime);
    const finalReview = reviewRows(aiRows, importer, runtime);
    const providerConfidence = aiConfidenceFromRows(aiRows);
    const finalCertainty = combinedCertainty(localReview, finalReview, providerConfidence, true);
    const aiMeta = aiRows?.__analysis?.ai || {};

    attachCertainty(aiRows, {
      local: localCertainty,
      aiUsed: true,
      ai: providerConfidence,
      final: finalCertainty,
      status: finalReview.valid && finalCertainty >= CERTAINTY_THRESHOLD ? "google-ai-verified" : "needs-review",
      model: aiMeta.model || "Google AI",
      review: finalReview,
    });

    if (!finalReview.valid || finalCertainty < CERTAINTY_THRESHOLD) {
      throw lowCertaintyError(aiRows, localReview, finalReview, true);
    }
    return aiRows;
  }

  function isProbablyUnsupported(error) {
    return error?.code === "UNSUPPORTED_SHEET"
      || /does not look like usable tennis ranking data/i.test(String(error?.message || ""));
  }

  function sheetToCsv(XLSX, sheet) {
    return XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ",", RS: "\n" });
  }

  async function interpretWorkbookBuffer(buffer, options = {}) {
    const XLSX = options.XLSX;
    if (!XLSX?.read || !XLSX?.utils?.sheet_to_csv) throw new Error("Spreadsheet support is still loading. Try again in a moment.");
    const readType = typeof Buffer !== "undefined" && Buffer.isBuffer?.(buffer) ? "buffer" : "array";
    const workbook = XLSX.read(buffer, { type: readType, cellDates: true });
    const merged = [];
    const acceptedSheets = [];
    const ignoredSheets = [];
    const blockedSheets = [];
    const sheetAnalyses = [];

    for (const name of workbook.SheetNames || []) {
      const sheet = workbook.Sheets?.[name];
      if (!sheet) continue;
      const csv = sheetToCsv(XLSX, sheet);
      if (!String(csv || "").trim()) {
        ignoredSheets.push({ name, reason: "Empty worksheet." });
        continue;
      }
      try {
        const rows = await interpretText(csv, {
          ...options,
          source: options.source || "file",
          sourceName: name,
        });
        const bridge = options.bridge;
        rows.forEach(row => {
          if (bridge?.normalizeMatchRow) bridge.normalizeMatchRow(row, name);
          merged.push(row);
        });
        acceptedSheets.push(name);
        sheetAnalyses.push({ sheetName: name, ...(rows.__analysis || {}) });
      } catch (error) {
        if (isProbablyUnsupported(error)) ignoredSheets.push({ name, reason: error.message || "Not tennis ranking data." });
        else blockedSheets.push({ name, reason: error?.message || "Could not reach the 85% certainty threshold." });
      }
    }

    if (blockedSheets.length) {
      const details = blockedSheets.slice(0, 3).map(item => `${item.name}: ${item.reason}`).join(" ");
      const error = new Error(`This workbook was not published because ${blockedSheets.length} worksheet${blockedSheets.length === 1 ? "" : "s"} stayed below the 85% certainty threshold. ${details}`.trim());
      error.code = "WORKBOOK_CERTAINTY_BLOCKED";
      error.blockedSheets = blockedSheets;
      throw error;
    }
    if (!merged.length) {
      const details = ignoredSheets.slice(0, 3).map(item => `${item.name}: ${item.reason}`).join(" ");
      const error = new Error(`No worksheet contained verified tennis ranking data.${details ? ` ${details}` : ""}`);
      error.code = "NO_VERIFIED_WORKSHEETS";
      throw error;
    }

    const finalValues = sheetAnalyses.map(item => clamp01(item.certainty?.final)).filter(value => value > 0);
    const localValues = sheetAnalyses.map(item => clamp01(item.certainty?.local)).filter(value => value >= 0);
    const aiValues = sheetAnalyses.map(item => clamp01(item.certainty?.ai)).filter(value => value > 0);
    const finalCertainty = finalValues.length ? Math.min(...finalValues) : 0;
    const localCertainty = localValues.length ? Math.min(...localValues) : 0;
    const aiUsed = sheetAnalyses.some(item => item.certainty?.aiUsed === true);
    const aiCertainty = aiValues.length ? Math.min(...aiValues) : 0;

    merged.__analysis = {
      headerRow: 1,
      delimiter: "workbook",
      columns: [],
      mapping: sheetAnalyses.flatMap(item => item.mapping || []),
      sourceName: acceptedSheets.join(", "),
      sheets: acceptedSheets,
      rejectedSheets: ignoredSheets,
      blockedSheets,
      sheetAnalyses,
      engine: "certainty-gated-workbook-v1",
      certainty: {
        threshold: CERTAINTY_THRESHOLD,
        local: localCertainty,
        aiUsed,
        ai: aiCertainty,
        final: finalCertainty,
        status: aiUsed ? "google-ai-verified" : "trusted-local",
        model: sheetAnalyses.find(item => item.certainty?.model)?.certainty?.model || "",
      },
    };
    return merged;
  }

  function isStandardWorkbookLink(input) {
    try {
      const url = new URL(String(input || "").trim());
      if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "docs.google.com") return false;
      if (!/\/spreadsheets\/(?:u\/\d+\/)?d\/[^/]+/i.test(url.pathname) || /\/spreadsheets\/d\/e\//i.test(url.pathname)) return false;
      const hashGid = /(?:^|[&#])gid=\d+/i.test(url.hash || "");
      return !url.searchParams.has("gid") && !hashGid;
    } catch {
      return false;
    }
  }

  function workbookProxyUrl(input) {
    return `/api/sheet-workbook?url=${encodeURIComponent(String(input || "").trim())}`;
  }

  function certaintyForRows(rows) {
    return clamp01(rows?.__analysis?.certainty?.final || rows?.__analysis?.review?.confidence || rows?.__analysis?.mlConfidence);
  }

  function installStyles(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .tr-certainty-meter{margin:14px 0 4px;padding:14px 15px;border:1px solid rgba(23,26,32,.12);border-radius:14px;background:rgba(255,255,255,.72)}
      .tr-certainty-head{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:#5c5e62}
      .tr-certainty-head strong{font-size:18px;color:#171a20;letter-spacing:-.03em}
      .tr-certainty-track{height:8px;margin:10px 0 8px;border-radius:999px;background:rgba(23,26,32,.10);overflow:hidden}
      .tr-certainty-fill{display:block;height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,#f5a623,#f36b21);transition:width .35s ease}
      .tr-certainty-meter[data-trusted="true"] .tr-certainty-fill{background:linear-gradient(90deg,#8fba39,#42a846)}
      .tr-certainty-note{margin:0;font-size:12px;line-height:1.45;color:#5c5e62}
      .tr-certainty-meter[data-pending="true"] .tr-certainty-fill{animation:tr-certainty-pulse 1s ease-in-out infinite alternate}
      @keyframes tr-certainty-pulse{from{opacity:.45}to{opacity:1}}
      @media (prefers-reduced-motion:reduce){.tr-certainty-fill{transition:none!important;animation:none!important}}
    `;
    doc.head.appendChild(style);
  }

  function ensureMeter(doc) {
    if (!doc) return null;
    let meter = doc.getElementById(METER_ID);
    if (meter) return meter;
    const card = doc.querySelector("#analyzerCard");
    if (!card) return null;
    meter = doc.createElement("div");
    meter.id = METER_ID;
    meter.className = "tr-certainty-meter";
    meter.innerHTML = `
      <div class="tr-certainty-head"><span>Interpretation certainty</span><strong data-certainty-value>Waiting</strong></div>
      <div class="tr-certainty-track" role="progressbar" aria-label="Spreadsheet interpretation certainty" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="tr-certainty-fill" data-certainty-fill></span></div>
      <p class="tr-certainty-note" data-certainty-note>Auto-publish requires 85%. Google AI checks any import below that threshold.</p>
    `;
    const header = card.querySelector(".analyzer-header");
    if (header) header.insertAdjacentElement("afterend", meter);
    else card.prepend(meter);
    return meter;
  }

  function renderMeter(win, rows, state = {}) {
    const doc = win?.document;
    installStyles(doc);
    const meter = ensureMeter(doc);
    if (!meter) return;
    const detail = rows?.__analysis?.certainty || {};
    const value = clamp01(state.value !== undefined ? state.value : detail.final);
    const local = clamp01(state.local !== undefined ? state.local : detail.local);
    const ai = clamp01(state.ai !== undefined ? state.ai : detail.ai);
    const aiUsed = state.aiUsed !== undefined ? state.aiUsed === true : detail.aiUsed === true;
    const pending = state.pending === true;
    const trusted = !pending && value >= CERTAINTY_THRESHOLD;
    const valueNode = meter.querySelector("[data-certainty-value]");
    const fill = meter.querySelector("[data-certainty-fill]");
    const note = meter.querySelector("[data-certainty-note]");
    const track = meter.querySelector("[role=progressbar]");
    if (valueNode) valueNode.textContent = `${percent(value)}%`;
    if (fill) fill.style.width = `${percent(value)}%`;
    if (track) track.setAttribute("aria-valuenow", String(percent(value)));
    meter.dataset.trusted = String(trusted);
    meter.dataset.pending = String(pending);

    if (note) {
      if (pending) note.textContent = `Local parser: ${percent(local)}%. Below 85%, so Google AI is checking the spreadsheet before anything can publish.`;
      else if (trusted && aiUsed) note.textContent = `Google AI verified the schema · local ${percent(local)}% → final ${percent(value)}% · auto-publish threshold 85%.`;
      else if (trusted) note.textContent = `Local parser verified this at ${percent(value)}%. Google AI was not needed · auto-publish threshold 85%.`;
      else if (aiUsed) note.textContent = `Google AI checked this, but final certainty is ${percent(value)}%. It stays blocked until it reaches 85%.`;
      else note.textContent = `Certainty is ${percent(value)}%. Google AI verification is required below 85%.`;
    }

    const badge = doc?.querySelector("#analyzerConfidence");
    if (badge && !pending) {
      badge.textContent = `${percent(value)}%`;
      badge.className = `confidence-badge ${trusted ? "high" : value >= 0.7 ? "medium" : "check"}`;
    }
  }

  function setStatus(win, message, error) {
    if (typeof win?.setStatus === "function") win.setStatus(message, error);
  }

  function setBusy(win, button, busy) {
    if (typeof win?.setBusy === "function") return win.setBusy(button, busy);
    if (!button) return;
    button.disabled = Boolean(busy);
    button.setAttribute("aria-busy", String(Boolean(busy)));
  }

  function browserDeps(win) {
    return {
      importer: win.TennisRankImportV2,
      runtime: win.TennisRankImportRuntime,
      ai: win.TennisRankSpreadsheetAI,
      auth: win.TennisRankAuth,
      XLSX: win.XLSX,
      bridge: win.TennisRankGoogleWorkbookBridge,
    };
  }

  async function publishRows(win, rows, source, label) {
    const certainty = certaintyForRows(rows);
    if (certainty < CERTAINTY_THRESHOLD) throw lowCertaintyError(rows, rows?.__analysis?.review, rows?.__analysis?.review, rows?.__analysis?.certainty?.aiUsed === true);
    if (typeof win.loadRows !== "function") throw new Error("The TennisRank importer is not ready yet.");
    win.loadRows(rows, source);
    renderMeter(win, rows);
    setStatus(win, `${label} understood at ${percent(certainty)}% certainty. Saving...`);
    if (typeof win.syncToBackend === "function") await win.syncToBackend();
    if (source === "sheet" && typeof win.startRefresh === "function") win.startRefresh();
    setStatus(win, `${label} verified at ${percent(certainty)}% certainty and saved${rows.__analysis?.certainty?.aiUsed ? " with Google AI verification" : " without needing AI"}.`);
    win.__tennisRankLastCertaintyRows = rows;
    if (typeof win.dispatchEvent === "function" && typeof win.CustomEvent === "function") {
      win.dispatchEvent(new win.CustomEvent("tennisrank:coach-data-changed", {
        detail: { source, rows: rows.length, certainty, aiUsed: rows.__analysis?.certainty?.aiUsed === true },
      }));
    }
    return rows;
  }

  async function importText(win, text, source, sourceName, label, button) {
    const deps = browserDeps(win);
    if (!deps.importer?.parseText || !deps.runtime || !deps.ai) throw new Error("Spreadsheet intelligence is still loading. Try again in a moment.");
    const localRows = normalizeRows(deps.importer.parseText(String(text || ""), sourceName), deps.runtime);
    const localReview = reviewRows(localRows, deps.importer, deps.runtime);
    if (shouldEscalate(localReview)) renderMeter(win, localRows, { value: reviewConfidence(localReview), local: reviewConfidence(localReview), pending: true });
    else renderMeter(win, attachCertainty(localRows, { local: reviewConfidence(localReview), final: reviewConfidence(localReview), review: localReview }));
    const rows = await interpretText(text, { ...deps, source, sourceName });
    return publishRows(win, rows, source, label);
  }

  async function importFile(win, file, button) {
    if (!file) throw new Error("Choose a spreadsheet file first.");
    setBusy(win, button, true);
    try {
      setStatus(win, `Reading ${file.name} and measuring interpretation certainty...`);
      const deps = browserDeps(win);
      let rows;
      const isWorkbook = deps.runtime?.isWorkbook ? deps.runtime.isWorkbook(file) : /\.(xlsx|xlsm|xlsb|xls|ods|fods|numbers)$/i.test(String(file.name || ""));
      if (isWorkbook) {
        const buffer = await file.arrayBuffer();
        rows = await interpretWorkbookBuffer(buffer, { ...deps, source: "file" });
        return await publishRows(win, rows, "file", file.name);
      }
      const text = await file.text();
      return await importText(win, text, "file", file.name || "Uploaded spreadsheet", file.name || "Spreadsheet", button);
    } finally {
      setBusy(win, button, false);
    }
  }

  async function importGoogleSheet(win, input, button) {
    setBusy(win, button, true);
    try {
      setStatus(win, "Loading the Google Sheet and measuring interpretation certainty...");
      const deps = browserDeps(win);
      let rows;
      if (isStandardWorkbookLink(input)) {
        const response = await win.fetch(workbookProxyUrl(input), { cache: "no-store" });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || `The Google Sheet could not be loaded (${response.status}).`);
        }
        const buffer = await response.arrayBuffer();
        rows = await interpretWorkbookBuffer(buffer, { ...deps, source: "sheet" });
        win.localStorage?.setItem("tennisRankSheetUrl", input);
        return await publishRows(win, rows, "sheet", "Google Sheet");
      }

      if (!deps.importer?.googleCsvProxyUrl) throw new Error("Google Sheet support is still loading.");
      const response = await win.fetch(deps.importer.googleCsvProxyUrl(input), { cache: "no-store" });
      const text = await response.text();
      if (!response.ok) {
        let message = `The Google Sheet could not be loaded (${response.status}).`;
        try { message = JSON.parse(text).error || message; } catch {}
        throw new Error(message);
      }
      win.localStorage?.setItem("tennisRankSheetUrl", input);
      return await importText(win, text, "sheet", "Google Sheet tennis data", "Google Sheet", button);
    } finally {
      setBusy(win, button, false);
    }
  }

  function installBrowser(win) {
    if (!win?.document || win.__tennisRankCertaintyGateInstalled) return false;
    win.__tennisRankCertaintyGateInstalled = true;
    const doc = win.document;
    installStyles(doc);
    const mount = () => ensureMeter(doc);
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();

    doc.addEventListener("change", event => {
      if (event.target?.id !== "csvFile") return;
      const file = event.target.files?.[0];
      if (!file) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const button = doc.querySelector("#useCsv");
      importFile(win, file, button).catch(error => {
        if (error?.rows) renderMeter(win, error.rows);
        setStatus(win, error?.message || "The spreadsheet could not be imported.", true);
        setBusy(win, button, false);
      });
    }, true);

    doc.addEventListener("click", event => {
      const useButton = event.target?.closest?.("#useCsv");
      const sheetButton = event.target?.closest?.("#connectSheet");
      if (!useButton && !sheetButton) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      if (useButton) {
        const file = doc.querySelector("#csvFile")?.files?.[0];
        const work = file
          ? importFile(win, file, useButton)
          : importText(win, String(doc.querySelector("#csvText")?.value || ""), "csv", "Pasted tennis data", "Pasted data", useButton);
        work.catch(error => {
          if (error?.rows) renderMeter(win, error.rows);
          setStatus(win, error?.message || "The pasted data could not be imported.", true);
          setBusy(win, useButton, false);
        });
        return;
      }

      const input = String(doc.querySelector("#sheetUrl")?.value || win.localStorage?.getItem("tennisRankSheetUrl") || "").trim();
      if (!input) {
        setStatus(win, "Paste a Google Sheet link first.", true);
        return;
      }
      importGoogleSheet(win, input, sheetButton).catch(error => {
        if (error?.rows) renderMeter(win, error.rows);
        setStatus(win, error?.message || "The Google Sheet could not be imported.", true);
        setBusy(win, sheetButton, false);
      });
    }, true);

    win.setTimeout?.(() => {
      if (!win.TennisRankImportV2 || !win.TennisRankImportRuntime) return;
      win.fetchSheet = async () => {
        const input = String(doc.querySelector("#sheetUrl")?.value || win.localStorage?.getItem("tennisRankSheetUrl") || "").trim();
        if (!input) throw new Error("Paste a Google Sheet link first.");
        return importGoogleSheet(win, input, doc.querySelector("#connectSheet"));
      };
    }, 250);
    return true;
  }

  return {
    CERTAINTY_THRESHOLD,
    AI_WEIGHT,
    LOCAL_WEIGHT,
    VALIDATED_BONUS,
    clamp01,
    percent,
    reviewConfidence,
    shouldEscalate,
    aiConfidenceFromRows,
    combinedCertainty,
    attachCertainty,
    reviewRows,
    interpretText,
    interpretWorkbookBuffer,
    isStandardWorkbookLink,
    workbookProxyUrl,
    certaintyForRows,
    renderMeter,
    publishRows,
    importFile,
    importGoogleSheet,
    installBrowser,
  };
});
