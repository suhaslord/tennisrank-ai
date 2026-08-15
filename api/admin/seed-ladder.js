const { json, authenticatedContext, rpc, allowApi, parseBody } = require("../_supabase");

module.exports = async function handler(req, res) {
  allowApi(res, "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  try {
    const context = await authenticatedContext(req);
    if (context.profile.role !== "admin") return json(res, 403, { error: "Coach/admin access is required." });

    const body = parseBody(req);
    const teamGender = String(body.teamGender || "").trim().toLowerCase();
    const players = Array.isArray(body.players) ? body.players : [];
    if (!new Set(["boys", "girls"]).has(teamGender)) return json(res, 400, { error: "Team must be boys or girls." });
    if (!players.length) return json(res, 400, { error: "At least one player is required." });

    const cleanPlayers = players.slice(0, 100).map(player => ({ name: String(player?.name || "").trim() })).filter(player => player.name);
    const result = await rpc(context, "admin_seed_ladder", {
      p_coach_profile_id: context.profile.id,
      p_team_gender: teamGender,
      p_players: cleanPlayers,
    });

    if (!result.response.ok) return json(res, result.response.status, { error: result.payload.message || "Ladder initialization failed." });
    return json(res, 201, { seeded: result.payload, teamGender });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected ladder initialization error." });
  }
};
