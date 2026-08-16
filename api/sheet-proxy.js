const { json, authenticatedContext, allowApi, parseBody } = require("./_supabase");
const aiAnalyzer = require("../lib/ai-sheet-analyzer");

const MAX_BYTES = 5 * 1024 * 1024;
const SHEET_TIMEOUT_MS = 12_000;
const AI_TIMEOUT_MS = 30_000;

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

async function handleAiAnalysis(req, res) {
  allowApi(res, "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  try {
    const context = await authenticatedContext(req);
    if (context.profile.role !== "admin") return json(res, 403, { error: "Coach/admin access is required." });

    const body = parseBody(req);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const result = await aiAnalyzer.analyzeRows({
        apiKey: String(process.env.GEMINI_API_KEY || "").trim(),
        model: process.env.GEMINI_SPREADSHEET_MODEL || aiAnalyzer.DEFAULT_MODEL,
        rows: Array.isArray(body.rows) ? body.rows : [],
        sourceName: body.sourceName,
        analysis: body.analysis || {},
        signal: controller.signal,
      });
      return json(res, 200, result);
    } finally {
      clearTimeout(timeout);
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
    if (finalUrl.protocol !== "https:" || finalUrl.hostname.toLowerCase() !== "docs.google.com") {
      return res.status(422).json({ error: "The sheet redirected away from Google Sheets. Check sharing permissions." });
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
module.exports.handleAiAnalysis = handleAiAnalysis;
module.exports.buildRedactedPayload = aiAnalyzer.buildRedactedPayload;
module.exports.validateAiResult = aiAnalyzer.validateAiResult;
module.exports.sourceContext = aiAnalyzer.sourceContext;
module.exports.ALLOWED_TARGETS = aiAnalyzer.ALLOWED_TARGETS;
