const crypto = require("node:crypto");

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(body));
}

function databaseConfig() {
  return {
    url: String(process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function recordKey(row, source) {
  if (row.__sourceRow) return crypto.createHash("sha256").update(`${source}:${row.__sourceRow}`).digest("hex");
  const canonical = JSON.stringify(row, Object.keys(row).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { url, key } = databaseConfig();
  if (!url || !key) return json(res, 503, { error: "Backend is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel." });
  if (req.method === "POST" && process.env.BACKEND_WRITE_TOKEN && req.headers["x-admin-token"] !== process.env.BACKEND_WRITE_TOKEN) {
    return json(res, 401, { error: "A valid backend write token is required to save data." });
  }

  try {
    const endpoint = `${url}/rest/v1/tennis_records`;
    if (req.method === "GET") {
      const response = await fetch(`${endpoint}?select=raw_data&order=updated_at.asc`, { headers: supabaseHeaders(key) });
      const data = await response.json();
      if (!response.ok) return json(res, response.status, { error: data.message || "Database read failed." });
      const rows = data.map(record => record.raw_data).filter(Boolean);
      return json(res, 200, { rows, count: rows.length });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const source = String(body.source || "default");
      if (!rows.length) return json(res, 400, { error: "No spreadsheet rows were provided." });
      const records = rows.map(row => ({ record_key: recordKey(row, source), raw_data: row, updated_at: new Date().toISOString() }));
      const response = await fetch(`${endpoint}?on_conflict=record_key`, {
        method: "POST",
        headers: supabaseHeaders(key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(records),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return json(res, response.status, { error: data.message || "Database save failed." });
      return json(res, 200, { saved: records.length });
    }

    return json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(res, 500, { error: error.message || "Unexpected backend error." });
  }
};
