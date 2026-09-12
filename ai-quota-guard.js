(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankAiQuotaGuard = api;
    if (root.document) api.install(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CACHE_PREFIX = "tennisrank:ai-schema:v2:";
  const RATE_KEY = "tennisrank:ai-schema-rate:v2";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const RATE_WINDOW_MS = 60 * 1000;
  const MAX_BROWSER_REQUESTS_PER_WINDOW = 4;
  const inflight = new Map();

  function safeStorage(win) {
    try {
      const storage = win?.localStorage;
      const probe = `${CACHE_PREFIX}probe`;
      storage?.setItem(probe, "1");
      storage?.removeItem(probe);
      return storage || null;
    } catch {
      return null;
    }
  }

  function sourceContext(value) {
    const tokens = String(value || "")
      .toLowerCase()
      .match(/\b(?:tennis|varsity|jv|boys?|girls?|singles?|doubles?|matches?|results?|standings?|rankings?|ladder|leaderboard|roster|round\s*robin)\b/g) || [];
    return [...new Set(tokens)].join(" ") || "tennis spreadsheet";
  }

  function fallbackValueType(value) {
    const text = String(value ?? "").trim();
    if (!text) return "empty";
    if (/^(?:w|l|win|loss|won|lost|home|away|player\s*[ab12]|team\s*[ab12])$/i.test(text)) return "result";
    if (/^(?:boys?|girls?|male|female|m|f|men|women)$/i.test(text)) return "gender";
    if (/\b(?:singles?|doubles?|2v2)\b/i.test(text)) return "division";
    if (/^(?:\d{1,2}\s*[-–]\s*\d{1,2})(?:\s*[,;/]\s*\d{1,2}\s*[-–]\s*\d{1,2}){0,4}$/.test(text)) return "score";
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(text) || /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(text)) return "date";
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return "number";
    return "text";
  }

  function schemaSignature(rows, spreadsheetAi) {
    if (spreadsheetAi?.schemaSignature) return spreadsheetAi.schemaSignature(rows);
    if (!Array.isArray(rows) || !rows.length) return "";
    const keys = [...new Set(rows.flatMap(row => Object.keys(row || {}).filter(key => !key.startsWith("__"))))].sort();
    return keys.map(key => {
      const counts = {};
      rows.slice(0, 24).forEach(row => {
        const type = fallbackValueType(row?.[key]);
        counts[type] = (counts[type] || 0) + 1;
      });
      return `${key}:${Object.entries(counts).sort().map(([type, count]) => `${type}${count}`).join(".")}`;
    }).join("|");
  }

  function hash(value) {
    let result = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
      result ^= text.charCodeAt(i);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function requestKey(body, spreadsheetAi) {
    let payload = {};
    try { payload = typeof body === "string" ? JSON.parse(body || "{}") : (body || {}); } catch {}
    const signature = schemaSignature(payload.rows, spreadsheetAi);
    const context = sourceContext(payload.sourceName);
    return signature ? hash(`${context}|${signature}`) : "";
  }

  function readCached(storage, key, now = Date.now()) {
    if (!storage || !key) return null;
    try {
      const value = JSON.parse(storage.getItem(`${CACHE_PREFIX}${key}`) || "null");
      if (!value || Number(value.expiresAt) <= now || typeof value.body !== "string") {
        storage.removeItem(`${CACHE_PREFIX}${key}`);
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  function writeCached(storage, key, responseBody, status, headers) {
    if (!storage || !key || status < 200 || status >= 300) return;
    try {
      storage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({
        body: responseBody,
        status,
        headers: headers || { "content-type": "application/json; charset=utf-8" },
        expiresAt: Date.now() + CACHE_TTL_MS,
      }));
    } catch {}
  }

  function recentRequestTimes(storage, now = Date.now()) {
    if (!storage) return [];
    try {
      const parsed = JSON.parse(storage.getItem(RATE_KEY) || "[]");
      return (Array.isArray(parsed) ? parsed : []).map(Number).filter(value => Number.isFinite(value) && now - value < RATE_WINDOW_MS);
    } catch {
      return [];
    }
  }

  function reserveRequest(storage, now = Date.now()) {
    const times = recentRequestTimes(storage, now);
    if (times.length >= MAX_BROWSER_REQUESTS_PER_WINDOW) return false;
    times.push(now);
    try { storage?.setItem(RATE_KEY, JSON.stringify(times)); } catch {}
    return true;
  }

  function responseFrom(win, body, status = 200, headers = { "content-type": "application/json; charset=utf-8" }) {
    return new win.Response(body, { status, headers });
  }

  function install(win) {
    const auth = win?.TennisRankAuth;
    if (!auth?.fetch || auth.fetch.__tennisRankQuotaGuard) return false;

    const originalFetch = auth.fetch.bind(auth);
    const storage = safeStorage(win);
    const spreadsheetAi = win.TennisRankSpreadsheetAI;

    const guardedFetch = async function(input, init = {}) {
      const url = typeof input === "string" ? input : String(input?.url || "");
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      if (url !== "/api/ai-analyze-sheet" || method !== "POST") return originalFetch(input, init);

      const key = requestKey(init?.body, spreadsheetAi);
      const cached = readCached(storage, key);
      if (cached) return responseFrom(win, cached.body, cached.status, cached.headers);
      if (key && inflight.has(key)) {
        const shared = await inflight.get(key);
        return responseFrom(win, shared.body, shared.status, shared.headers);
      }

      if (!reserveRequest(storage)) {
        return responseFrom(win, JSON.stringify({
          error: "AI schema verification is cooling down to stay within the Gemini request limit. TennisRank will keep using its local validator for this import.",
          code: "AI_RATE_GUARD",
        }), 429);
      }

      const work = (async () => {
        const response = await originalFetch(input, init);
        const body = await response.text();
        const headers = { "content-type": response.headers?.get?.("content-type") || "application/json; charset=utf-8" };
        if (response.ok) writeCached(storage, key, body, response.status, headers);
        return { body, status: response.status, headers };
      })();

      if (key) inflight.set(key, work);
      try {
        const result = await work;
        return responseFrom(win, result.body, result.status, result.headers);
      } finally {
        if (key) inflight.delete(key);
      }
    };

    guardedFetch.__tennisRankQuotaGuard = true;
    guardedFetch.__originalFetch = originalFetch;
    auth.fetch = guardedFetch;
    return true;
  }

  return {
    CACHE_TTL_MS,
    RATE_WINDOW_MS,
    MAX_BROWSER_REQUESTS_PER_WINDOW,
    sourceContext,
    schemaSignature,
    requestKey,
    readCached,
    recentRequestTimes,
    reserveRequest,
    install,
  };
});
