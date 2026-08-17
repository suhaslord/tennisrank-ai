const crypto = require("node:crypto");
const { json, authenticatedContext, rest, rpc, allowApi, parseBody } = require("./_supabase");

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function sourceKey(source) {
  return hash(String(source || "default").trim() || "default");
}

function contentHash(rows) {
  return hash(JSON.stringify(Array.isArray(rows) ? rows : []));
}

function previewHash(rows, source) {
  return hash(`${sourceKey(source)}:${contentHash(rows)}`);
}

function scalar(payload) {
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload) && payload.length === 1) {
    const value = payload[0];
    if (typeof value === "string") return value;
    if (value && typeof value === "object") return Object.values(value)[0] || null;
  }
  if (payload && typeof payload === "object") return Object.values(payload)[0] || null;
  return null;
}

async function currentRows(context) {
  const latest = await rest(context, "tennis_records?select=source_key,updated_at&order=updated_at.desc&limit=1");
  if (!latest.response.ok) throw Object.assign(new Error(latest.payload.message || "Database read failed."), { status: latest.response.status });
  const latestRecord = Array.isArray(latest.payload) ? latest.payload[0] : null;
  if (!latestRecord?.source_key) return { rows: [], count: 0, sourceKey: null };
  const result = await rest(context, `tennis_records?source_key=eq.${encodeURIComponent(latestRecord.source_key)}&select=raw_data,row_index&order=row_index.asc,updated_at.asc`);
  if (!result.response.ok) throw Object.assign(new Error(result.payload.message || "Database read failed."), { status: result.response.status });
  const rows = (Array.isArray(result.payload) ? result.payload : []).map(record => record.raw_data).filter(Boolean);
  return { rows, count: rows.length, sourceKey: latestRecord.source_key };
}

function validateRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return "No spreadsheet rows were provided.";
  if (rows.length > 10000) return "This import is too large. Split it into a smaller team sheet.";
  return "";
}

module.exports = async function handler(req, res) {
  allowApi(res, "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const context = await authenticatedContext(req);

    if (req.method === "GET") {
      const mode = String(req.query?.mode || "").trim().toLowerCase();
      if (mode === "history") {
        if (context.profile.role !== "admin") return json(res, 403, { error: "Coach/admin access is required." });
        const history = await rest(context, "import_snapshots?select=id,source_label,row_count,summary,content_hash,restored_from_snapshot_id,created_at,created_by_profile_id&order=created_at.desc&limit=30");
        if (!history.response.ok) return json(res, history.response.status, { error: history.payload.message || "Import history could not be loaded." });
        return json(res, 200, { snapshots: Array.isArray(history.payload) ? history.payload : [] });
      }

      const current = await currentRows(context);
      return json(res, 200, current);
    }

    if (req.method === "POST") {
      if (context.profile.role !== "admin") return json(res, 403, { error: "Only an admin can publish team data." });
      const body = parseBody(req);
      const action = String(body.action || "publish").trim().toLowerCase();

      if (action === "restore") {
        const snapshotId = String(body.snapshotId || "").trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshotId)) {
          return json(res, 400, { error: "Choose a valid import snapshot to restore." });
        }
        const restored = await rpc(context, "admin_restore_import_snapshot", {
          p_coach_profile_id: context.profile.id,
          p_snapshot_id: snapshotId,
        });
        if (!restored.response.ok) return json(res, restored.response.status, { error: restored.payload.message || "Import restore failed." });
        const current = await currentRows(context);
        return json(res, 200, { restored: true, snapshotId: scalar(restored.payload), ...current });
      }

      const rows = Array.isArray(body.rows) ? body.rows : [];
      const source = String(body.source || "default").trim() || "default";
      const invalid = validateRows(rows);
      if (invalid) return json(res, rows.length > 10000 ? 413 : 400, { error: invalid });
      const key = sourceKey(source);
      const rowsHash = contentHash(rows);
      const token = previewHash(rows, source);

      if (action === "preview") {
        const latest = await rest(context, "import_snapshots?select=id,source_label,row_count,content_hash,created_at&order=created_at.desc&limit=1");
        if (!latest.response.ok) return json(res, latest.response.status, { error: latest.payload.message || "Current import snapshot could not be loaded." });
        const current = Array.isArray(latest.payload) ? latest.payload[0] : null;
        return json(res, 200, {
          previewHash: token,
          contentHash: rowsHash,
          sourceKey: key,
          sourceLabel: source,
          rowCount: rows.length,
          currentSnapshot: current || null,
          unchanged: Boolean(current?.content_hash && current.content_hash === rowsHash),
        });
      }

      if (action !== "publish") return json(res, 400, { error: "Unsupported import action." });
      if (!body.previewHash || String(body.previewHash) !== token) {
        return json(res, 428, { error: "Preview this import before publishing it." });
      }
      const summary = body.previewSummary && typeof body.previewSummary === "object" ? body.previewSummary : {};
      if (JSON.stringify(summary).length > 150000) return json(res, 413, { error: "Import preview summary is too large." });

      const published = await rpc(context, "admin_publish_import", {
        p_coach_profile_id: context.profile.id,
        p_source_key: key,
        p_source_label: source,
        p_rows: rows,
        p_content_hash: rowsHash,
        p_summary: summary,
        p_restored_from_snapshot_id: null,
      });
      if (!published.response.ok) return json(res, published.response.status, { error: published.payload.message || "Database save failed." });
      return json(res, 200, { saved: rows.length, snapshotId: scalar(published.payload), contentHash: rowsHash });
    }

    return json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected backend error." });
  }
};

module.exports.sourceKey = sourceKey;
module.exports.contentHash = contentHash;
module.exports.previewHash = previewHash;
