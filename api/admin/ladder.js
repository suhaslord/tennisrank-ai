const { json, authenticatedContext, rpc, allowApi, parseBody } = require("../_supabase");

module.exports = async function handler(req, res) {
  allowApi(res, "PATCH,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "PATCH") return json(res, 405, { error: "Method not allowed." });

  try {
    const context = await authenticatedContext(req);
    if (context.profile.role !== "admin") return json(res, 403, { error: "Coach/admin access is required." });

    const body = parseBody(req);
    const action = String(body.action || "").trim().toLowerCase();
    const playerId = String(body.playerId || "").trim();
    if (!playerId) return json(res, 400, { error: "Player ID is required." });

    let result;
    if (action === "status") {
      const status = String(body.status || "").trim().toLowerCase();
      if (!new Set(["active", "injured", "inactive"]).has(status)) return json(res, 400, { error: "Invalid player status." });
      result = await rpc(context, "admin_set_player_status", {
        p_coach_profile_id: context.profile.id,
        p_player_id: playerId,
        p_status: status,
        p_reason: String(body.reason || "").trim() || null,
      });
    } else if (action === "move") {
      const rank = Number(body.newRank);
      if (!Number.isInteger(rank) || rank < 1) return json(res, 400, { error: "New rank must be a positive integer." });
      result = await rpc(context, "admin_move_ladder_player", {
        p_coach_profile_id: context.profile.id,
        p_player_id: playerId,
        p_new_rank: rank,
        p_reason: String(body.reason || "").trim() || null,
      });
    } else {
      return json(res, 400, { error: "Unsupported admin ladder action." });
    }

    if (!result.response.ok) return json(res, result.response.status, { error: result.payload.message || "Ladder update failed." });
    return json(res, 200, { ok: true, action });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected admin ladder error." });
  }
};
