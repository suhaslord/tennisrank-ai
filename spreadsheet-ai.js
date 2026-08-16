(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TennisRankSpreadsheetAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const APPLY_THRESHOLD = 0.62;
  const BLOCK_UNSUPPORTED_THRESHOLD = 0.86;

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

  return {
    APPLY_THRESHOLD,
    BLOCK_UNSUPPORTED_THRESHOLD,
    sampleRows,
    normalizeAi,
    mappingPlan,
    applyAiMapping,
    reviewRows,
    shouldUseAi,
    requestAnalysis,
    enhanceRows,
  };
});
