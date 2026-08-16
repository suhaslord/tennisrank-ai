const crypto = require("node:crypto");
const { json, authenticatedContext, allowApi, parseBody } = require("./_supabase");
const aiAnalyzer = require("../lib/ai-sheet-analyzer");

const MAX_BYTES = 5 * 1024 * 1024;
const SHEET_TIMEOUT_MS = 12_000;
const AI_TIMEOUT_MS = 30_000;
const AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const AI_RATE_WINDOW_MS = 60 * 1000;
const MAX_PROVIDER_CALLS_PER_WINDOW = 4;
const AI_CACHE_MAX = 64;

const aiCache = new Map();
const aiInflight = new Map();
let providerCallTimes = [];

function parseAllowedUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("Invalid Google Sheets URL.");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "docs.google.com") {
    throw new Error("Only Google Sheets CSV export URLs are allowed.");
  }
  const path = url.pathname;
  const standard = /^\/spreadsheets\/d\/[^/]+\/export$/i.test(path) && url.searchParams.get("format") === "csv";
  const published = /^\/spreadsheets\/d\/e\/[^/]+\/pub$/i.test(path) && url.searchParams.get("output") === "csv";
  if (!standard && !published) {
    throw new Error("Only Google Sheets CSV export URLs are allowed.");
  }
  return url;
}

function isAllowedGoogleExportHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "docs.google.com"
    || host === "googleusercontent.com"
    || host.endsWith(".googleusercontent.com");
}

async function readLimitedBody(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new Error("This sheet is too large. Keep the import under 5 MB.");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("This sheet is too large. Keep the import under 5 MB.");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      try { await reader.cancel(); } catch {}
      throw new Error("This sheet is too large. Keep the import under 5 MB.");
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function pruneAiCache(now = Date.now()) {
  for (const [key, entry] of aiCache.entries()) {
    if (!entry || Number(entry.expiresAt) <= now) aiCache.delete(key);
  }
  while (aiCache.size > AI_CACHE_MAX) aiCache.delete(aiCache.keys().next().value);
}

function aiRequestKey(body) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const payload = aiAnalyzer.buildRedactedPayload(rows, body?.sourceName, body?.analysis || {});
  const structural = JSON.stringify({
    sourceContext: payload.sourceContext,
    inputKeys: payload.inputKeys,
    samples: payload.samples,
    currentMapping: payload.currentMapping,
  });
  return crypto.createHash("sha256").update(structural).digest("hex");
}

function reserveProviderCall(now = Date.now()) {
  providerCallTimes = providerCallTimes.filter(timestamp => now - timestamp < AI_RATE_WINDOW_MS);
  if (providerCallTimes.length >= MAX_PROVIDER_CALLS_PER_WINDOW) return false;
  providerCallTimes.push(now);
  return true;
}

async function analyzeWithModelFallback({ apiKey, requestedModel, rows, sourceName, analysis, signal }) {
  try {
    return await aiAnalyzer.analyzeRows({
      apiKey,
      model: requestedModel,
      rows,
      sourceName,
      analysis,
      signal,
    });
  } catch (error) {
    if (Number(error?.status) !== 429 || requestedModel === aiAnalyzer.FALLBACK_MODEL) throw error;
    return aiAnalyzer.analyzeRows({
      apiKey,
      model: aiAnalyzer.FALLBACK_MODEL,
      rows,
      sourceName,
      analysis,
      signal,
    });
  }
}

async function handleAiAnalysis(req, res) {
  allowApi(res, "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  try {
    const context = await authenticatedContext(req);
    if (context.profile.role !== "admin") return json(res, 403, { error: "Coach/admin access is required." });

    const body = parseBody(req);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const sourceName = body.sourceName;
    const analysis = body.analysis || {};
    const cacheKey = aiRequestKey({ rows, sourceName, analysis });
    const now = Date.now();
    pruneAiCache(now);

    const cached = aiCache.get(cacheKey);
    if (cached?.result && cached.expiresAt > now) {
      return json(res, 200, { ...cached.result, cache: { hit: true, layer: "server-schema" } });
    }

    if (aiInflight.has(cacheKey)) {
      const shared = await aiInflight.get(cacheKey);
      return json(res, 200, { ...shared, cache: { hit: true, layer: "server-inflight" } });
    }

    if (!reserveProviderCall(now)) {
      return json(res, 429, {
        error: "AI schema verification is cooling down to stay within the Gemini request limit. TennisRank will keep using its local validator for this import.",
        code: "AI_RATE_GUARD",
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    const requestedModel = process.env.GEMINI_SPREADSHEET_MODEL || aiAnalyzer.DEFAULT_MODEL;
    const work = analyzeWithModelFallback({
      apiKey: String(process.env.GEMINI_API_KEY || "").trim(),
      requestedModel,
      rows,
      sourceName,
      analysis,
      signal: controller.signal,
    });
    aiInflight.set(cacheKey, work);

    try {
      const result = await work;
      aiCache.set(cacheKey, { result, expiresAt: Date.now() + AI_CACHE_TTL_MS });
      pruneAiCache();
      return json(res, 200, { ...result, cache: { hit: false, layer: "provider" } });
    } finally {
      clearTimeout(timeout);
      aiInflight.delete(cacheKey);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return json(res, 504, { error: "AI spreadsheet analysis timed out. TennisRank can still use its local parser." });
    }
    const status = Number(error.status) || 500;
    const body = { error: error.message || "Unexpected AI analysis error." };
    if (error.code) body.code = error.code;
    return json(res, status >= 400 && status < 600 ? status : 500, body);
  }
}

async function handleGoogleSheet(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  let target;
  try {
    target = parseAllowedUrl(req.query?.url);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHEET_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "TennisRank/1.0 spreadsheet importer" },
    });

    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || !isAllowedGoogleExportHost(finalUrl.hostname)) {
      return res.status(422).json({ error: "The sheet redirected outside Google’s spreadsheet export service. Check sharing permissions." });
    }
    if (!response.ok) {
      return res.status(422).json({ error: `Google Sheets returned ${response.status}. Set sharing to “Anyone with the link – Viewer” and try again.` });
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html")) {
      return res.status(422).json({ error: "Google returned a sign-in page instead of sheet data. Make the sheet viewable by anyone with the link." });
    }

    const text = await readLimitedBody(response);
    if (!text.trim()) return res.status(422).json({ error: "The sheet exported successfully but contained no rows." });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    return res.status(200).send(text);
  } catch (error) {
    if (error?.name === "AbortError") return res.status(504).json({ error: "Google Sheets took too long to respond. Try again." });
    return res.status(502).json({ error: error?.message || "The sheet could not be loaded." });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  if (String(req.query?.mode || "").toLowerCase() === "ai") return handleAiAnalysis(req, res);
  return handleGoogleSheet(req, res);
};

module.exports.parseAllowedUrl = parseAllowedUrl;
module.exports.isAllowedGoogleExportHost = isAllowedGoogleExportHost;
module.exports.handleAiAnalysis = handleAiAnalysis;
module.exports.buildRedactedPayload = aiAnalyzer.buildRedactedPayload;
module.exports.validateAiResult = aiAnalyzer.validateAiResult;
module.exports.sourceContext = aiAnalyzer.sourceContext;
module.exports.ALLOWED_TARGETS = aiAnalyzer.ALLOWED_TARGETS;
module.exports.aiRequestKey = aiRequestKey;
module.exports.reserveProviderCall = reserveProviderCall;
