const { json, authenticatedContext, rpc, allowApi, parseBody } = require("../_supabase");

function cleanDivision(value) {
  const division = String(value || "").trim().toLowerCase();
  return new Set(["varsity", "jv"]).has(division) ? division : null;
}

function cleanGradeLevel(value) {
  const grade = Number(value);
  return Number.isInteger(grade) && grade >= 9 && grade <= 12 ? grade : null;
}

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
    if (players.length > 1000) return json(res, 413, { error: "A ladder supports at most 1,000 players. No players were changed." });

    const cleanPlayers = players.map(player => ({
      name: String(player?.name || "").replace(/\s+/g, " ").trim(),
      division: cleanDivision(player?.division),
      gradeLevel: cleanGradeLevel(player?.gradeLevel),
    }));
    if (cleanPlayers.some(player => !player.name || player.name.length > 160)) return json(res, 400, { error: "Every roster entry needs a player name of at most 160 characters. No players were changed." });
    if (new Set(cleanPlayers.map(player => player.name.toLowerCase())).size !== cleanPlayers.length) return json(res, 400, { error: "Duplicate player names must be resolved before updating this ladder." });

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

module.exports.cleanDivision = cleanDivision;
module.exports.cleanGradeLevel = cleanGradeLevel;
