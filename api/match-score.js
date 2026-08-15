const engine = require("../lib/ladder-engine");
const { json, authenticatedContext, rpc, allowApi, parseBody } = require("./_supabase");

module.exports = async function handler(req, res) {
  allowApi(res, "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  try {
    const context = await authenticatedContext(req);
    const body = parseBody(req);
    const challengeId = String(body.challengeId || "").trim();
    const winnerPlayerId = String(body.winnerPlayerId || "").trim();
    const scoreSummary = String(body.scoreSummary || "").trim();

    if (!challengeId || !winnerPlayerId || !scoreSummary) {
      return json(res, 400, { error: "Challenge, winner, and score are required." });
    }

    const score = engine.parseScoreSummary(scoreSummary);
    if (!score.valid) return json(res, 400, { error: score.error });

    const result = await rpc(context, "submit_ladder_match", {
      p_actor_profile_id: context.profile.id,
      p_challenge_id: challengeId,
      p_winner_player_id: winnerPlayerId,
      p_score_summary: scoreSummary,
    });

    if (!result.response.ok) {
      return json(res, result.response.status, { error: result.payload.message || "Score could not be submitted." });
    }

    return json(res, 201, { matchId: result.payload, approvalStatus: "pending" });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected score submission error." });
  }
};
