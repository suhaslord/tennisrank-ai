const { json, authenticatedContext, rest, rpc, allowApi, parseBody } = require("./_supabase");
const { findLinkedPlayer } = require("../lib/player-link");
const { loadCoachData, buildPayload } = require("../lib/coach-dashboard");

async function standardLadder(context) {
  const link = context.profile.role === "player"
    ? await findLinkedPlayer(context)
    : { linkedPlayer: null, reason: "admin" };

  const [entriesResult, playersResult, settingsResult] = await Promise.all([
    rest(context, "ladder_entries?select=player_id,team_gender,rank_position,previous_rank_position,status,updated_at&order=team_gender.asc,rank_position.asc"),
    rest(context, "players?select=id,profile_id,display_name,team_gender,grade_level,division,active_status"),
    rest(context, "team_settings?select=team_gender,max_challenge_distance,cooldown_hours,response_deadline_hours,challenge_expiration_hours,injury_rank_protection"),
  ]);

  for (const result of [entriesResult, playersResult, settingsResult]) {
    if (!result.response.ok) {
      const error = new Error(result.payload.message || "Ladder data could not be loaded.");
      error.status = result.response.status;
      throw error;
    }
  }

  const players = new Map((playersResult.payload || []).map(player => [player.id, player]));
  const ladder = (entriesResult.payload || []).map(entry => ({
    ...entry,
    player: players.get(entry.player_id) || null,
  })).filter(entry => entry.player);

  const linkedPlayer = link.linkedPlayer || null;
  return {
    ladder,
    settings: settingsResult.payload || [],
    viewer: {
      profileId: context.profile.id,
      role: context.profile.role,
      playerName: context.profile.player_name || null,
      playerId: linkedPlayer?.id || null,
      teamGender: linkedPlayer?.team_gender || null,
      rosterDivision: linkedPlayer?.division || null,
      gradeLevel: linkedPlayer?.grade_level || null,
      linkState: link.reason || null,
    },
  };
}

module.exports = async function handler(req, res) {
  allowApi(res, "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const context = await authenticatedContext(req);
    const mode = String(req.query?.mode || "").trim().toLowerCase();

    if (req.method === "GET") {
      if (mode === "coach") {
        if (context.profile.role !== "admin") return json(res, 403, { error: "Coach/admin access is required." });
        const data = await loadCoachData(context, rest);
        return json(res, 200, buildPayload(data));
      }
      return json(res, 200, await standardLadder(context));
    }

    if (req.method === "POST") {
      if (mode !== "coach") return json(res, 405, { error: "Method not allowed." });
      if (context.profile.role !== "admin") return json(res, 403, { error: "Coach/admin access is required." });
      const body = parseBody(req);
      const action = String(body.action || "").trim().toLowerCase();
      if (action !== "undo-ladder") return json(res, 400, { error: "Unsupported coach action." });
      const snapshotId = String(body.snapshotId || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshotId)) {
        return json(res, 400, { error: "Choose a valid ladder change to undo." });
      }
      const result = await rpc(context, "admin_undo_ladder_snapshot", {
        p_coach_profile_id: context.profile.id,
        p_snapshot_id: snapshotId,
      });
      if (!result.response.ok) return json(res, result.response.status, { error: result.payload.message || "Ladder undo failed." });
      const data = await loadCoachData(context, rest);
      return json(res, 200, { ok: true, dashboard: buildPayload(data) });
    }

    return json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected ladder error." });
  }
};

module.exports.standardLadder = standardLadder;
