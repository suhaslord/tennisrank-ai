(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankSpreadsheetAI = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const APPLY_THRESHOLD = 0.62;
  const BLOCK_UNSUPPORTED_THRESHOLD = 0.86;
  const schemaCache = new Map();

  function nonEmpty(value) {
    return String(value ?? "").trim() !== "";
  }

  function cloneAnalysis(rows) {
    const source = rows?.__analysis || {};
    return {
      ...source,
      mapping: Array.isArray(source.mapping) ? source.mapping.map(item => ({ ...item })) : [],
      review: source.review ? { ...source.review } : source.review,
    };
  }

  function sampleRows(rows, limit = 80) {
    if (!Array.isArray(rows) || rows.length <= limit) return Array.isArray(rows) ? rows.map(row => ({ ...row })) : [];
    const selected = [];
    const seen = new Set();
    const add = index => {
      if (index < 0 || index >= rows.length || seen.has(index)) return;
      seen.add(index);
      selected.push({ ...rows[index] });
    };
    for (let i = 0; i < Math.min(20, rows.length); i += 1) add(i);
    const middleSlots = Math.max(0, limit - 40);
    for (let i = 1; i <= middleSlots; i += 1) add(Math.floor((i * (rows.length - 1)) / (middleSlots + 1)));
    for (let i = Math.max(0, rows.length - 20); i < rows.length; i += 1) add(i);
    return selected.slice(0, limit);
  }

  function valueType(value) {
    const text = String(value ?? "").trim();
    if (!text) return "empty";
    if (/^(?:w|l|win|loss|won|lost|home|away|player\s*[ab12]|team\s*[ab12])$/i.test(text)) return "result";
    if (/^(?:boys?|girls?|male|female|m|f|men|women)$/i.test(text)) return "gender";
    if (/\b(?:singles?|doubles?|2v2)\b/i.test(text)) return "division";
    if (/^(?:\d{1,2}\s*[-–]\s*\d{1,2})(?:\s*[,;/]\s*\d{1,2}\s*[-–]\s*\d{1,2}){0,4}$/.test(text)) return "score";
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(text) || /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(text)) return "date";
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return "number";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "email";
    return "text";
  }

  function schemaSignature(rows) {
    if (!Array.isArray(rows) || !rows.length) return "";
    const keys = [...new Set(rows.flatMap(row => Object.keys(row || {}).filter(key => !key.startsWith("__"))))].sort();
    return keys.map(key => {
      const counts = {};
      rows.slice(0, 24).forEach(row => {
        const type = valueType(row?.[key]);
        counts[type] = (counts[type] || 0) + 1;
      });
      return `${key}:${Object.entries(counts).sort().map(([type, count]) => `${type}${count}`).join(".")}`;
    }).join("|");
  }

  function normalizeAi(ai) {
    if (!ai || typeof ai !== "object") return null;
    return {
      supported: ai.supported === true,
      sheetKind: String(ai.sheetKind || "unsupported"),
      confidence: Math.max(0, Math.min(1, Number(ai.confidence) || 0)),
      globalGender: ["boys", "girls", "unknown"].includes(ai.globalGender) ? ai.globalGender : "unknown",
      globalDivision: ["singles", "doubles", "unknown"].includes(ai.globalDivision) ? ai.globalDivision : "unknown",
      mappings: Array.isArray(ai.mappings) ? ai.mappings.map(item => ({
        inputKey: String(item?.inputKey || ""),
        target: String(item?.target || "ignore"),
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
        reason: String(item?.reason || "").slice(0, 220),
      })) : [],
      warnings: Array.isArray(ai.warnings) ? ai.warnings.map(value => String(value || "").slice(0, 220)).filter(Boolean) : [],
    };
  }

  function mappingPlan(rows, ai) {
    const keys = new Set((rows || []).flatMap(row => Object.keys(row || {}).filter(key => !key.startsWith("__"))));
    const candidates = (ai?.mappings || [])
      .filter(item => keys.has(item.inputKey))
      .filter(item => item.confidence >= APPLY_THRESHOLD)
      .sort((a, b) => b.confidence - a.confidence);
    const byTarget = new Map();
    const plan = [];
    for (const item of candidates) {
      if (item.target === "ignore") {
        plan.push(item);
        continue;
      }
      if (["firstName", "lastName"].includes(item.target)) {
        if (!byTarget.has(item.target)) {
          byTarget.set(item.target, item);
          plan.push(item);
        }
        continue;
      }
      if (!byTarget.has(item.target)) {
        byTarget.set(item.target, item);
        plan.push(item);
      }
    }
    return plan;
  }

  function applyAiMapping(rows, ai) {
    if (!Array.isArray(rows)) return rows;
    const normalized = normalizeAi(ai);
    if (!normalized) return rows;
    const plan = mappingPlan(rows, normalized);
    const result = rows.map(row => {
      const output = { ...row };
      const assigned = new Map();
      for (const item of plan) {
        const value = row?.[item.inputKey];
        if (item.target === "ignore") {
          if (item.inputKey in output) delete output[item.inputKey];
          continue;
        }
        if (!nonEmpty(value)) {
          if (item.inputKey !== item.target && item.inputKey in output) delete output[item.inputKey];
          continue;
        }
        const current = assigned.get(item.target);
        if (!current || item.confidence > current.confidence) {
          output[item.target] = String(value).trim();
          assigned.set(item.target, item);
        }
        if (item.inputKey !== item.target && item.inputKey in output) delete output[item.inputKey];
      }

      const first = String(output.firstName || "").trim();
      const last = String(output.lastName || "").trim();
      if (!nonEmpty(output.name) && (first || last)) output.name = [first, last].filter(Boolean).join(" ");
      delete output.firstName;
      delete output.lastName;
      if (!nonEmpty(output.gender) && normalized.globalGender !== "unknown") output.gender = normalized.globalGender;
      if (!nonEmpty(output.division) && normalized.globalDivision !== "unknown") output.division = normalized.globalDivision;
      return output;
    });

    const analysis = cloneAnalysis(rows);
    const existingSources = new Map((analysis.mapping || []).map(item => [String(item.field || item.inputKey || ""), item.source]));
    analysis.mapping = plan
      .filter(item => item.target !== "ignore")
      .map(item => ({
        source: existingSources.get(item.inputKey) || item.inputKey,
        field: item.target === "firstName" || item.target === "lastName" ? "name" : item.target,
        method: "ai-schema",
        confidence: item.confidence,
      }));
    analysis.ai = {
      status: "applied",
      sheetKind: normalized.sheetKind,
      confidence: normalized.confidence,
      globalGender: normalized.globalGender,
      globalDivision: normalized.globalDivision,
      warnings: normalized.warnings,
      mappings: normalized.mappings,
    };
    delete analysis.review;
    result.__analysis = analysis;
    return result;
  }

  function reviewRows(rows, importer) {
    if (!importer || typeof importer.validateInterpretation !== "function") return { valid: true, confidence: 1, level: "HIGH" };
    return importer.validateInterpretation(rows);
  }

  function attachAi(rows, detail) {
    if (!Array.isArray(rows)) return rows;
    const analysis = cloneAnalysis(rows);
    analysis.ai = { ...(analysis.ai || {}), ...detail };
    rows.__analysis = analysis;
    return rows;
  }

  function shouldUseAi(source) {
    return !new Set(["sample", "backend", "local", "restored"]).has(String(source || "").toLowerCase());
  }

  function cacheSchema(rows, ai, model) {
    const signature = schemaSignature(rows);
    if (!signature || !ai?.supported) return;
    schemaCache.set(signature, { ai: normalizeAi(ai), model: String(model || "Gemini"), savedAt: Date.now() });
    while (schemaCache.size > 12) schemaCache.delete(schemaCache.keys().next().value);
  }

  function applyCachedMapping(rows) {
    const signature = schemaSignature(rows);
    const cached = signature ? schemaCache.get(signature) : null;
    if (!cached?.ai) return rows;
    const mapped = applyAiMapping(rows, cached.ai);
    if (mapped?.__analysis) {
      mapped.__analysis.ai = {
        ...(mapped.__analysis.ai || {}),
        status: "cached-schema",
        model: cached.model,
        cached: true,
      };
    }
    return mapped;
  }

  async function requestAnalysis(rows, options = {}) {
    const auth = options.auth || (typeof window !== "undefined" ? window.TennisRankAuth : null);
    if (!auth?.fetch) throw Object.assign(new Error("AI analysis requires an authenticated admin session."), { code: "AI_AUTH_UNAVAILABLE" });
    const response = await auth.fetch("/api/ai-analyze-sheet", {
      method: "POST",
      body: JSON.stringify({
        sourceName: String(options.sourceName || options.source || "tennis spreadsheet"),
        rows: sampleRows(rows),
        analysis: cloneAnalysis(rows),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "AI spreadsheet analysis failed.");
      error.status = response.status;
      error.code = payload.code || "AI_ANALYSIS_FAILED";
      throw error;
    }
    return { ai: normalizeAi(payload.ai), model: payload.model || "Gemini", privacy: payload.privacy || {} };
  }

  async function enhanceRows(rows, options = {}) {
    if (!Array.isArray(rows) || !rows.length || !shouldUseAi(options.source)) return rows;
    const importer = options.importer || (typeof window !== "undefined" ? window.TennisRankImportV2 : null);
    const cached = schemaCache.get(schemaSignature(rows));
    if (cached?.ai) {
      const mapped = applyCachedMapping(rows);
      const cachedReview = reviewRows(mapped, importer);
      if (cachedReview.valid) {
        if (mapped.__analysis) mapped.__analysis.review = cachedReview;
        return mapped;
      }
      schemaCache.delete(schemaSignature(rows));
    }

    const before = reviewRows(rows, importer);
    let response;
    try {
      response = await requestAnalysis(rows, options);
    } catch (error) {
      if (error.code === "AI_NOT_CONFIGURED" || error.status === 429 || error.status >= 500 || error.code === "AI_AUTH_UNAVAILABLE") {
        attachAi(rows, {
          status: error.code === "AI_NOT_CONFIGURED" ? "not-configured" : "unavailable",
          message: error.message,
        });
        return rows;
      }
      throw error;
    }

    const ai = response.ai;
    if (!ai) return attachAi(rows, { status: "unavailable", message: "AI returned no usable schema analysis." });
    if (!ai.supported) {
      attachAi(rows, { status: "rejected", model: response.model, confidence: ai.confidence, sheetKind: ai.sheetKind, warnings: ai.warnings });
      if (ai.confidence >= BLOCK_UNSUPPORTED_THRESHOLD) {
        throw new Error(`AI verification says this does not look like usable tennis ranking data (${Math.round(ai.confidence * 100)}% confidence). Nothing was published.`);
      }
      return rows;
    }

    if (ai.confidence < 0.55 || !ai.mappings.some(item => item.target !== "ignore" && item.confidence >= APPLY_THRESHOLD)) {
      return attachAi(rows, {
        status: "verified-low-confidence",
        model: response.model,
        confidence: ai.confidence,
        sheetKind: ai.sheetKind,
        warnings: ai.warnings,
      });
    }

    const rawSignatureRows = rows;
    const remapped = applyAiMapping(rows, ai);
    const after = reviewRows(remapped, importer);
    if (!after.valid) {
      if (before.valid) {
        return attachAi(rows, {
          status: "disagreed-kept-local",
          model: response.model,
          confidence: ai.confidence,
          sheetKind: ai.sheetKind,
          warnings: [...ai.warnings, "AI remapping did not pass TennisRank validation, so the existing verified interpretation was kept."],
        });
      }
      throw new Error(`AI found a likely schema, but the remapped rows still failed TennisRank validation: ${after.reason || "ambiguous spreadsheet"}`);
    }

    if (before.valid && Number(after.confidence || 0) + 0.03 < Number(before.confidence || 0)) {
      return attachAi(rows, {
        status: "verified-kept-local",
        model: response.model,
        confidence: ai.confidence,
        sheetKind: ai.sheetKind,
        warnings: [...ai.warnings, "The local parser scored higher than the AI remap, so TennisRank kept the local interpretation."],
      });
    }

    cacheSchema(rawSignatureRows, ai, response.model);
    if (remapped.__analysis) {
      remapped.__analysis.review = after;
      remapped.__analysis.ai = {
        ...(remapped.__analysis.ai || {}),
        status: "applied-and-validated",
        model: response.model,
        providerRedacted: response.privacy?.redactedBeforeProvider === true,
      };
    }
    return remapped;
  }

  function aiSummary(rows) {
    const ai = rows?.__analysis?.ai;
    if (!ai) return "local parser";
    if (ai.status === "applied-and-validated") return `${ai.model || "Gemini"} + local validation`;
    if (ai.status === "cached-schema") return `${ai.model || "Gemini"} cached schema + local validation`;
    if (ai.status === "not-configured") return "local parser (AI key not configured)";
    if (ai.status === "unavailable") return "local parser (AI temporarily unavailable)";
    if (ai.status === "verified-kept-local" || ai.status === "disagreed-kept-local") return `${ai.model || "Gemini"} verified; local mapping kept`;
    return "AI verification";
  }

  async function processTextImport(win, text, source, sourceName) {
    const importer = win.TennisRankImportV2;
    if (!importer?.parseText) throw new Error("The TennisRank spreadsheet importer is still loading.");
    let rows = importer.parseText(String(text || ""), sourceName || "Tennis spreadsheet");
    rows = await enhanceRows(rows, { source, sourceName, importer, auth: win.TennisRankAuth });
    const runtime = win.TennisRankImportRuntime;
    if (runtime?.normalizeRows) rows = runtime.normalizeRows(rows);
    if (runtime?.validateRows) runtime.validateRows(rows, importer);
    else {
      const review = reviewRows(rows, importer);
      if (!review.valid) throw new Error(review.reason || "The spreadsheet interpretation is not safe to publish.");
    }
    return rows;
  }

  function installBrowser(win) {
    const doc = win.document;
    const bind = () => {
      const pasteButton = doc.querySelector("#useCsv");
      if (pasteButton && !pasteButton.dataset.aiImportBound) {
        pasteButton.dataset.aiImportBound = "true";
        pasteButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (typeof win.setBusy === "function") win.setBusy(pasteButton, true);
          try {
            if (typeof win.setStatus === "function") win.setStatus("Parsing pasted data, then asking TennisRank AI to verify the schema...");
            const rows = await processTextImport(win, doc.querySelector("#csvText")?.value || "", "csv", "Pasted tennis data");
            if (typeof win.loadRows !== "function") throw new Error("The TennisRank board is not ready yet.");
            win.loadRows(rows, "csv");
            if (typeof win.setStatus === "function") win.setStatus(`Loaded ${rows.length} rows using ${aiSummary(rows)}. Saving...`);
            if (typeof win.syncToBackend === "function") await win.syncToBackend();
            if (typeof win.setStatus === "function") win.setStatus(`Loaded, verified, and saved ${rows.length} rows using ${aiSummary(rows)}.`);
          } catch (error) {
            if (typeof win.setStatus === "function") win.setStatus(error.message, true);
          } finally {
            if (typeof win.setBusy === "function") win.setBusy(pasteButton, false);
          }
        }, true);
      }

      const sheetButton = doc.querySelector("#connectSheet");
      if (sheetButton && !sheetButton.dataset.aiImportBound) {
        sheetButton.dataset.aiImportBound = "true";
        sheetButton.addEventListener("click", async event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (typeof win.setBusy === "function") win.setBusy(sheetButton, true);
          try {
            const input = String(doc.querySelector("#sheetUrl")?.value || "").trim();
            if (!input) throw new Error("Paste a Google Sheet link first.");
            const importer = win.TennisRankImportV2;
            if (!importer?.googleCsvProxyUrl) throw new Error("Google Sheet support is still loading.");
            if (typeof win.setStatus === "function") win.setStatus("Loading the Google Sheet, then verifying its structure with TennisRank AI...");
            const response = await fetch(importer.googleCsvProxyUrl(input), { cache: "no-store" });
            const text = await response.text();
            if (!response.ok) {
              let message = `The sheet could not be loaded (${response.status}).`;
              try { message = JSON.parse(text).error || message; } catch {}
              throw new Error(message);
            }
            const rows = await processTextImport(win, text, "sheet", "Google Sheet tennis data");
            localStorage.setItem("tennisRankSheetUrl", input);
            if (typeof win.loadRows !== "function") throw new Error("The TennisRank board is not ready yet.");
            win.loadRows(rows, "sheet");
            if (typeof win.setStatus === "function") win.setStatus(`Loaded ${rows.length} Google Sheet rows using ${aiSummary(rows)}. Saving...`);
            if (typeof win.syncToBackend === "function") await win.syncToBackend();
            if (typeof win.startRefresh === "function") win.startRefresh();
            if (typeof win.setStatus === "function") win.setStatus(`Google Sheet verified and saved using ${aiSummary(rows)}.`);
          } catch (error) {
            if (typeof win.setStatus === "function") win.setStatus(error.message, true);
          } finally {
            if (typeof win.setBusy === "function") win.setBusy(sheetButton, false);
          }
        }, true);
      }
    };

    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", () => setTimeout(bind, 0), { once: true });
    else setTimeout(bind, 0);
  }

  return {
    APPLY_THRESHOLD,
    BLOCK_UNSUPPORTED_THRESHOLD,
    sampleRows,
    valueType,
    schemaSignature,
    normalizeAi,
    mappingPlan,
    applyAiMapping,
    reviewRows,
    shouldUseAi,
    cacheSchema,
    applyCachedMapping,
    requestAnalysis,
    enhanceRows,
    aiSummary,
    processTextImport,
    installBrowser,
  };
});
