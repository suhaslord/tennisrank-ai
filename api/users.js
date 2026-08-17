const { json, authenticatedContext, rest, allowApi, parseBody, serviceHeaders } = require("./_supabase");
const { linkPlayerByName } = require("../lib/player-link");

async function createAuthUser(context, email, password) {
  const response = await fetch(`${context.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(context.key),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.msg || payload.message || payload.error || "Auth user could not be created."), { status: response.status });
  return payload.user || payload;
}

async function deleteAuthUser(context, userId) {
  if (!userId) return;
  await fetch(`${context.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: serviceHeaders(context.key),
  }).catch(() => {});
}

function linkWarning(reason, playerName) {
  if (!reason || new Set(["linked", "already-linked", "direct"]).has(reason)) return "";
  if (reason === "not-found") return `Account created, but “${playerName}” is not in the current imported roster yet. Import that player and the account will link automatically.`;
  if (reason === "ambiguous") return `Account created, but more than one roster player matches “${playerName}”. Select the player directly from the roster instead.`;
  if (reason === "claimed") return `Account created, but “${playerName}” is already linked to another account. A coach should correct the roster/account mapping.`;
  return "Account created, but its roster link needs coach review.";
}

async function rosterPlayer(context, playerId) {
  if (!playerId) return null;
  const result = await rest(context, `players?id=eq.${encodeURIComponent(playerId)}&select=id,profile_id,display_name,team_gender,grade_level,division,active_status&limit=1`);
  if (!result.response.ok) throw Object.assign(new Error(result.payload.message || "Roster player lookup failed."), { status: result.response.status });
  return Array.isArray(result.payload) ? result.payload[0] || null : null;
}

async function linkDirect(context, player, profileId) {
  if (!player) return null;
  if (player.profile_id && player.profile_id !== profileId) throw Object.assign(new Error("That roster player already has an account."), { status: 409 });
  const result = await rest(context, `players?id=eq.${encodeURIComponent(player.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ profile_id: profileId, updated_at: new Date().toISOString() }),
  });
  if (!result.response.ok) throw Object.assign(new Error(result.payload.message || "Roster account link failed."), { status: result.response.status });
  return Array.isArray(result.payload) ? result.payload[0] || player : player;
}

module.exports = async function handler(req, res) {
  allowApi(res, "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const context = await authenticatedContext(req);
    if (context.profile.role !== "admin") return json(res, 403, { error: "Coach/admin access is required." });

    if (req.method === "GET") {
      const [profilesResult, playersResult] = await Promise.all([
        rest(context, "profiles?select=id,email,full_name,player_name,role,must_change_password,created_at,updated_at&order=role.asc,full_name.asc"),
        rest(context, "players?select=id,profile_id,display_name,team_gender,grade_level,division,active_status,created_at,updated_at&order=active_status.asc,team_gender.asc,display_name.asc"),
      ]);
      if (!profilesResult.response.ok) return json(res, profilesResult.response.status, { error: profilesResult.payload.message || "Player accounts could not be loaded." });
      if (!playersResult.response.ok) return json(res, playersResult.response.status, { error: playersResult.payload.message || "Roster players could not be loaded." });
      const profiles = Array.isArray(profilesResult.payload) ? profilesResult.payload : [];
      const profileMap = new Map(profiles.map(profile => [profile.id, profile]));
      const roster = (Array.isArray(playersResult.payload) ? playersResult.payload : []).map(player => ({
        ...player,
        accountCreated: Boolean(player.profile_id && profileMap.has(player.profile_id)),
        account: player.profile_id ? profileMap.get(player.profile_id) || null : null,
      }));
      return json(res, 200, { profiles, roster });
    }

    if (req.method === "POST") {
      const body = parseBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      let fullName = String(body.fullName || "").trim();
      let playerName = String(body.playerName || "").trim();
      const playerId = String(body.playerId || "").trim();
      const role = String(body.role || "player").trim().toLowerCase();
      const temporaryPassword = String(body.temporaryPassword || "");

      if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: "Enter a valid email address." });
      if (!new Set(["player", "admin"]).has(role)) return json(res, 400, { error: "Access level must be player or admin." });
      if (temporaryPassword.length < 10) return json(res, 400, { error: "Temporary password must be at least 10 characters." });

      let selectedPlayer = null;
      if (role === "player" && playerId) {
        selectedPlayer = await rosterPlayer(context, playerId);
        if (!selectedPlayer) return json(res, 404, { error: "That roster player no longer exists. Refresh the roster and try again." });
        if (selectedPlayer.profile_id) return json(res, 409, { error: "That roster player already has an account." });
        playerName = selectedPlayer.display_name;
        if (!fullName) fullName = selectedPlayer.display_name;
      }
      if (!fullName) return json(res, 400, { error: "Display name is required." });
      if (role === "player" && !playerName) return json(res, 400, { error: "Select a roster player or enter the exact spreadsheet name." });

      const existing = await rest(context, `profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
      if (!existing.response.ok) return json(res, existing.response.status, { error: existing.payload.message || "Account lookup failed." });
      if (Array.isArray(existing.payload) && existing.payload.length) return json(res, 409, { error: "An account already exists for this email." });

      let user = null;
      try {
        user = await createAuthUser(context, email, temporaryPassword);
        if (!user?.id) throw new Error("Supabase did not return a user ID.");

        const profileResult = await rest(context, "profiles", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            id: user.id,
            email,
            full_name: fullName,
            player_name: role === "player" ? playerName : null,
            role,
            must_change_password: true,
            updated_at: new Date().toISOString(),
          }),
        });
        if (!profileResult.response.ok) throw Object.assign(new Error(profileResult.payload.message || "Profile could not be created."), { status: profileResult.response.status });

        const profile = Array.isArray(profileResult.payload) ? profileResult.payload[0] : null;
        let linkedPlayer = null;
        let warning = "";
        if (role === "player") {
          if (selectedPlayer) {
            linkedPlayer = await linkDirect(context, selectedPlayer, user.id);
          } else {
            try {
              const link = await linkPlayerByName(context, user.id, playerName);
              linkedPlayer = link.linkedPlayer || null;
              warning = linkWarning(link.reason, playerName);
            } catch (error) {
              warning = `Account created, but roster linking needs another try: ${error.message}`;
            }
          }
        }

        return json(res, 201, {
          profile,
          linkedPlayerId: linkedPlayer?.id || null,
          linkWarning: warning || null,
        });
      } catch (error) {
        await deleteAuthUser(context, user?.id);
        throw error;
      }
    }

    return json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || "Unexpected account-management error." });
  }
};
