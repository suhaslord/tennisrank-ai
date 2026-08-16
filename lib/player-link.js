const { rest } = require('../api/_supabase');

function identityKey(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchingPlayers(players, playerName) {
  const target = identityKey(playerName);
  if (!target) return [];
  return (Array.isArray(players) ? players : []).filter(player => identityKey(player && player.display_name) === target);
}

async function listRosterPlayers(context) {
  const result = await rest(context, 'players?select=id,profile_id,display_name,team_gender,grade_level,division,active_status,updated_at&order=active_status.asc,display_name.asc&limit=500');
  if (!result.response.ok) throw Object.assign(new Error(result.payload.message || 'Player roster could not be loaded.'), { status: result.response.status });
  return Array.isArray(result.payload) ? result.payload : [];
}

async function linkPlayerByName(context, profileId, playerName) {
  const name = String(playerName || '').trim();
  if (!profileId || !name) return { linkedPlayer: null, reason: 'missing-identity' };
  const exact = matchingPlayers(await listRosterPlayers(context), name);
  if (!exact.length) return { linkedPlayer: null, reason: 'not-found' };
  const alreadyMine = exact.find(player => player.profile_id === profileId);
  if (alreadyMine) return { linkedPlayer: alreadyMine, reason: 'already-linked' };
  const available = exact.filter(player => !player.profile_id);
  if (available.length !== 1) return { linkedPlayer: null, reason: available.length > 1 ? 'ambiguous' : 'claimed' };
  const candidate = available[0];
  const result = await rest(context, `players?id=eq.${encodeURIComponent(candidate.id)}&profile_id=is.null`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ profile_id: profileId, updated_at: new Date().toISOString() }),
  });
  if (!result.response.ok) throw Object.assign(new Error(result.payload.message || 'Player account could not be linked to the roster.'), { status: result.response.status });
  const linkedPlayer = Array.isArray(result.payload) ? result.payload[0] || null : null;
  return linkedPlayer ? { linkedPlayer, reason: 'linked' } : { linkedPlayer: null, reason: 'claimed' };
}

async function findLinkedPlayer(context, options = {}) {
  const profileId = context && context.profile && context.profile.id;
  if (!profileId) return { linkedPlayer: null, reason: 'missing-profile' };
  const direct = await rest(context, `players?profile_id=eq.${encodeURIComponent(profileId)}&select=id,profile_id,display_name,team_gender,grade_level,division,active_status&limit=1`);
  if (!direct.response.ok) throw Object.assign(new Error(direct.payload.message || 'Player link lookup failed.'), { status: direct.response.status });
  const linkedPlayer = Array.isArray(direct.payload) ? direct.payload[0] || null : null;
  if (linkedPlayer) return { linkedPlayer, reason: 'direct' };
  if (options.repair === false || context.profile.role !== 'player') return { linkedPlayer: null, reason: 'not-linked' };
  return linkPlayerByName(context, profileId, context.profile.player_name || context.profile.full_name || '');
}

module.exports = { identityKey, matchingPlayers, listRosterPlayers, linkPlayerByName, findLinkedPlayer };
