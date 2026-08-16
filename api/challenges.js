const { json, authenticatedContext, rest, rpc, allowApi, parseBody } = require("./_supabase");

const MAX_SCHEDULE_DAYS = 90;
const MAX_COURT_LOCATION_LENGTH = 160;
const ACTIVE_STATES = new Set([
  "pending_response", "accepted", "scheduled", "played", "score_submitted", "pending_coach_approval",
]);

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

async function findLinkedPlayer(context) {
  const result = await rest(context, `players?profile_id=eq.${encodeURIComponent(context.profile.id)}&select=id,display_name,team_gender,active_status&limit=1`);
  if (!result.response.ok) throw Object.assign(new Error(result.payload.message || "Player link lookup failed."), { status: result.response.status });
  return Array.isArray(result.payload) ? result.payload[0] || null : null;
}

async function listChallenges(context) {
  const result = await rest(context, "challenges?select=id,challenger_id,defender_id,team_gender,status,proposed_times,scheduled_for,court_location,created_at,responded_at,completed_at&order=created_at.desc&limit=100");
  if (!result.response.ok) throw Object.assign(new Error(result.payload.message || "Challenges could not be loaded."), { status: result.response.status });

  let challenges = Array.isArray(result.payload) ? result.payload : [];
  if (context.profile.role !== "admin") {
    const linkedPlayer = await findLinkedPlayer(context);
    if (!linkedPlayer) return { challenges: [], linkedPlayer: null, matches: [] };
    challenges = challenges.filter(challenge => challenge.challenger_id === linkedPlayer.id || challenge.defender_id === linkedPlayer.id);
  }

  const playerIds = [...new Set(challenges.flatMap(challenge => [challenge.challenger_id, challenge.defender_id]))];
  let players = [];
  if (playerIds.length) {
    const playerResult = await rest(context, `players?select=id,profile_id,display_name,team_gender,grade_level,division,active_status&id=in.(${playerIds.join(",")})`);
    if (!playerResult.response.ok) throw Object.assign(new Error(playerResult.payload.message || "Challenge players could not be loaded."), { status: playerResult.response.status });
    players = Array.isArray(playerResult.payload) ? playerResult.payload : [];
  }

  const challengeIds = challenges.map(challenge => challenge.id);
  let matches = [];
  if (challengeIds.length) {
    const matchResult = await rest(context, `challenge_matches?select=id,challenge_id,score_summary,winner_id,approval_status,submitted_at,verified_at&challenge_id=in.(${challengeIds.join(",")})`);
    if (!matchResult.response.ok) throw Object.assign(new Error(matchResult.payload.message || "Challenge match data could not be loaded."), { status: matchResult.response.status });
    matches = Array.isArray(matchResult.payload) ? matchResult.payload : [];
  }

  const playersById = new Map(players.map(player => [player.id, player]));
  const matchesByChallenge = new Map(matches.map(match => [match.challenge_id, match]));
  return {
    challenges: challenges.map(challenge => ({
      ...challenge,
      challenger: playersById.get(challenge.challenger_id) || null,
      defender: playersById.get(challenge.defender_id) || null,
      match: matchesByChallenge.get(challenge.id) || null,
      isOpen: ACTIVE_STATES.has(challenge.status),
    })),
  };
}

function normalizeFutureTime(raw, label) {
  const date = new Date(raw);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) throw badRequest(`${label} is invalid.`);
  const now = Date.now();
  if (timestamp <= now) throw badRequest(`${label} must be in the future.`);
  const maxFuture = now + 1000 * 60 * 60 * 24 * MAX_SCHEDULE_DAYS;
  if (timestamp > maxFuture) throw badRequest(`${label} must be within the next ${MAX_SCHEDULE_DAYS} days.`);
  return date.toISOString();
}

function normalizeProposedTimes(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  for (const raw of value.slice(0, 3)) normalized.push(normalizeFutureTime(raw, "One of the proposed times"));
  if (!normalized.length) throw badRequest("Propose at least one match time.");
  return [...new Set(normalized)];
}

function normalizeScheduledFor(value, required = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) throw badRequest("A scheduled time is required.");
    return null;
  }
  return normalizeFutureTime(value, "Scheduled time");
}

function normalizeCourtLocation(value) {
  const courtLocation = String(value || "").trim();
  if (courtLocation.length > MAX_COURT_LOCATION_LENGTH) throw badRequest("Court/location is too long.");
  return courtLocation || null;
}

async function handler(req, res) {
  allowApi(res, "GET,POST,PATCH,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const context = await authenticatedContext(req);

    if (req.method === "GET") {
      return json(res, 200, await listChallenges(context));
    }

    const body = parseBody(req);

    if (req.method === "POST") {
      const defenderPlayerId = String(body.defenderPlayerId || "").trim();
      if (!defenderPlayerId) return json(res, 400, { error: "Choose a defender to challenge." });
      const proposedTimes = normalizeProposedTimes(body.proposedTimes);
      const result = await rpc(context, "create_ladder_challenge", {
        p_challenger_profile_id: context.profile.id,
        p_defender_player_id: defenderPlayerId,
        p_proposed_times: proposedTimes,
      });
      if (!result.response.ok) return json(res, result.response.status, { error: result.payload.message || "Challenge could not be created." });
      return json(res, 201, { challengeId: result.payload });
    }

    if (req.method === "PATCH") {
      const challengeId = String(body.challengeId || "").trim();
      const action = String(body.action || "").trim().toLowerCase();
      if (!challengeId) return json(res, 400, { error: "Challenge ID is required." });
      if (!new Set(["accept", "decline", "schedule"]).has(action)) return json(res, 400, { error: "Unsupported challenge action." });

      const scheduledFor = normalizeScheduledFor(body.scheduledFor, action === "schedule");
      const courtLocation = normalizeCourtLocation(body.courtLocation);

      const result = await rpc(context, "respond_ladder_challenge", {
        p_actor_profile_id: context.profile.id,
        p_challenge_id: challengeId,
        p_action: action,
        p_scheduled_for: scheduledFor,
        p_court_location: courtLocation,
      });
      if (!result.response.ok) return json(res, result.response.status, { error: result.payload.message || "Challenge could not be updated." });
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected challenge error." });
  }
}

module.exports = handler;
module.exports.MAX_SCHEDULE_DAYS = MAX_SCHEDULE_DAYS;
module.exports.MAX_COURT_LOCATION_LENGTH = MAX_COURT_LOCATION_LENGTH;
module.exports.normalizeFutureTime = normalizeFutureTime;
module.exports.normalizeProposedTimes = normalizeProposedTimes;
module.exports.normalizeScheduledFor = normalizeScheduledFor;
module.exports.normalizeCourtLocation = normalizeCourtLocation;
