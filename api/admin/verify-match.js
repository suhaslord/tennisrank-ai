const { json, authenticatedContext, rpc, allowApi, parseBody } = require("../_supabase");

module.exports = async function handler(req, res) {
  allowApi(res, "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  try {
    const context = await authenticatedContext(req);
    if (context.profile.role !== "admin") return json(res, 403, { error: "Coach/admin access is required." });

    const body = parseBody(req);
    const matchId = String(body.matchId || "").trim();
    const action = String(body.action || "approve").trim().toLowerCase();
    if (!matchId) return json(res, 400, { error: "Match ID is required." });
    if (!new Set(["approve", "reject"]).has(action)) return json(res, 400, { error: "Action must be approve or reject." });

    const result = action === "approve"
      ? await rpc(context, "verify_challenge_match", {
          p_match_id: matchId,
          p_coach_profile_id: context.profile.id,
        })
      : await rpc(context, "reject_challenge_match", {
          p_match_id: matchId,
          p_coach_profile_id: context.profile.id,
          p_reason: String(body.reason || "").trim() || null,
        });

    if (!result.response.ok) {
      return json(res, result.response.status, { error: result.payload.message || `Match could not be ${action === "approve" ? "approved" : "rejected"}.` });
    }

    return json(res, 200, { ok: true, action });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected verification error." });
  }
};
