const { rest } = require("../api/_supabase");

function identityKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function matchingPlayers(players, playerName) {
  const target = identityKey(playerName);
  if (!target) return [];
  return (Array.isArray(players) ? players : []).filter(player => identityKey(player?.display_name) === target);
}

async function listRosterPlayers(context) {
  const result = await rest(
    context,
    "players?select=id,profile_id,display_name,team_gender,grade_level,division,active_status,updated_at&order=active_status.asc,display_name.asc&limit=500",
  );
  if (!result.response.ok) {
    throw Object.assign(new Error(result.payload.message || "Player roster could not be loaded."), { status: result.response.status });
  }
  return Array.isArray(result.payload) ? result.payload : [];
}

async function linkPlayerByName(context, profileId, playerName) {
  const name = String(playerName || "").trim();
  if (!profileId || !name) return { linkedPlayer: null, reason: "missing-identity" };

  const players = await listRosterPlayers(context);
  const exact = matchingPlayers(players, name);
  if (!exact.length) return { linkedPlayer: null, reason: "not-found" };

  const available = exact.filter(player => !player.profile_id || player.profile_id === profileId);
  if (available.length !== 1) {
    const alreadyMine = exact.find(player => player.profile_id === profileId);
    if (alreadyMine) return { linkedPlayer: alreadyMine, reason: "already-linked" };
    return { linkedPlayer: null, reason: available.length > 1 ? "ambiguous" : "claimed" };
  }

  const candidate = available[0];
  if (candidate.profile_id === profileId) return { linkedPlayer: candidate, reason: "already-linked" };

  const result = await rest(context, `players?id=eq.${encodeURIComponent(candidate.id)}&profile_id=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ profile_id: profileId, updated_at: new Date().toISOString() }),
  });
  if (!result.response.ok) {
    throw Object.assign(new Error(result.payload.message || "Player account could not be linked to the roster."), { status: result.response.status });
  }

  const linkedPlayer = Array.isArray(result.payload) ? result.payload[0] || null : null;
  if (linkedPlayer) return { linkedPlayer, reason: "linked" };

  const verify = await rest(
    context,
    `players?id=eq.${encodeURIComponent(candidate.id)}&select=id,profile_id,display_name,team_gender,grade_level,division,active_status&limit=1`,
  );
  if (!verify.response.ok) {
    throw Object.assign(new Error(verify.payload.message || "Player link verification failed."), { status: verify.response.status });
  }
  const current = Array.isArray(verify.payload) ? verify.payload[0] || null : null;
  return current?.profile_id === profileId
    ? { linkedPlayer: current, reason: "linked" }
    : { linkedPlayer: null, reason: "claimed" };
}

async function findLinkedPlayer(context, options = {}) {
  const profileId = context?.profile?.id;
  if (!profileId) return { linkedPlayer: null, reason: "missing-profile" };

  const direct = await rest(
    context,
    `players?profile_id=eq.${encodeURIComponent(profileId)}&select=id,profile_id,display_name,team_gender,grade_level,division,active_status&limit=1`,
  );
  if (!direct.response.ok) {
    throw Object.assign(new Error(direct.payload.message || "Player link lookup failed."), { status: direct.response.status });
  }
  const linkedPlayer = Array.isArray(direct.payload) ? direct.payload[0] || null : null;
  if (linkedPlayer) return { linkedPlayer, reason: "direct" };

  if (options.repair === false || context.profile.role !== "player") {
    return { linkedPlayer: null, reason: "not-linked" };
  }

  return linkPlayerByName(
    context,
    profileId,
    context.profile.player_name || context.profile.full_name || "",
  );
}

module.exports = {
  identityKey,
  matchingPlayers,
  listRosterPlayers,
  linkPlayerByName,
  findLinkedPlayer,
};
