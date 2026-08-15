const crypto = require("node:crypto");
const { json, authenticatedContext, rest, allowApi, parseBody } = require("./_supabase");

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function sourceKey(source) {
  return hash(String(source || "default").trim() || "default");
}

function recordKey(row, source) {
  if (row?.__sourceRow) return hash(`${source}:${row.__sourceRow}`);
  const canonical = JSON.stringify(row || {}, Object.keys(row || {}).sort());
  return hash(`${source}:${canonical}`);
}

module.exports = async function handler(req, res) {
  allowApi(res, "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const context = await authenticatedContext(req);

    if (req.method === "GET") {
      // Only return the most recently published source. This prevents stale rows from a
      // previous spreadsheet/CSV source being mixed into the current team board.
      const latest = await rest(context, "tennis_records?select=source_key,updated_at&order=updated_at.desc&limit=1");
      if (!latest.response.ok) return json(res, latest.response.status, { error: latest.payload.message || "Database read failed." });
      const latestRecord = Array.isArray(latest.payload) ? latest.payload[0] : null;
      if (!latestRecord?.source_key) return json(res, 200, { rows: [], count: 0 });

      const result = await rest(context, `tennis_records?source_key=eq.${encodeURIComponent(latestRecord.source_key)}&select=raw_data&order=updated_at.asc`);
      if (!result.response.ok) return json(res, result.response.status, { error: result.payload.message || "Database read failed." });
      const rows = (Array.isArray(result.payload) ? result.payload : []).map(record => record.raw_data).filter(Boolean);
      return json(res, 200, { rows, count: rows.length });
    }

    if (req.method === "POST") {
      if (context.profile.role !== "admin") return json(res, 403, { error: "Only an admin can publish team data." });
      const body = parseBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const source = String(body.source || "default").trim() || "default";
      if (!rows.length) return json(res, 400, { error: "No spreadsheet rows were provided." });
      if (rows.length > 10000) return json(res, 413, { error: "This import is too large. Split it into a smaller team sheet." });

      const key = sourceKey(source);
      const now = new Date().toISOString();
      const records = rows.map(row => ({
        record_key: recordKey(row, source),
        source_key: key,
        raw_data: row,
        updated_at: now,
      }));

      // Replace this source as a set so deleted spreadsheet rows do not linger forever.
      const cleared = await rest(context, `tennis_records?source_key=eq.${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
      if (!cleared.response.ok) return json(res, cleared.response.status, { error: cleared.payload.message || "Existing source rows could not be replaced." });

      const inserted = await rest(context, "tennis_records", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(records),
      });
      if (!inserted.response.ok) return json(res, inserted.response.status, { error: inserted.payload.message || "Database save failed." });
      return json(res, 200, { saved: records.length });
    }

    return json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected backend error." });
  }
};
