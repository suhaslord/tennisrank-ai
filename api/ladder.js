const { json, authenticatedContext, rest, allowApi } = require("./_supabase");
const { findLinkedPlayer } = require("../lib/player-link");

module.exports = async function handler(req, res) {
  allowApi(res, "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });

  try {
    const context = await authenticatedContext(req);
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
        return json(res, result.response.status, { error: result.payload.message || "Ladder data could not be loaded." });
      }
    }

    const players = new Map((playersResult.payload || []).map(player => [player.id, player]));
    const ladder = (entriesResult.payload || []).map(entry => ({
      ...entry,
      player: players.get(entry.player_id) || null,
    })).filter(entry => entry.player);

    const linkedPlayer = link.linkedPlayer || null;
    return json(res, 200, {
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
    });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected ladder error." });
  }
};
