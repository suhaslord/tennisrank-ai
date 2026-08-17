const OPEN_CHALLENGE = new Set(["pending_response", "accepted", "scheduled", "played", "score_submitted", "pending_coach_approval"]);

function rows(result) {
  return Array.isArray(result?.payload) ? result.payload : [];
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function futureTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) && time >= Date.now() - 60_000;
}

async function loadCoachData(context, rest) {
  const results = await Promise.all([
    rest(context, "players?select=id,profile_id,display_name,team_gender,grade_level,division,active_status,created_at,updated_at&order=team_gender.asc,display_name.asc"),
    rest(context, "profiles?select=id,email,full_name,player_name,role,must_change_password,created_at,updated_at"),
    rest(context, "ladder_entries?select=player_id,team_gender,rank_position,previous_rank_position,status,updated_at&order=team_gender.asc,rank_position.asc"),
    rest(context, "challenges?select=id,challenger_id,defender_id,team_gender,status,scheduled_for,court_location,created_at,responded_at,completed_at&order=created_at.desc&limit=100"),
    rest(context, "challenge_matches?select=id,challenge_id,score_summary,winner_id,approval_status,submitted_by_profile_id,verified_by_profile_id,submitted_at,verified_at&order=submitted_at.desc&limit=100"),
    rest(context, "import_snapshots?select=id,source_label,row_count,summary,content_hash,restored_from_snapshot_id,created_by_profile_id,created_at&order=created_at.desc&limit=20"),
    rest(context, "audit_logs?select=id,actor_profile_id,action_type,target_type,target_id,reason,metadata,created_at&order=created_at.desc&limit=80"),
    rest(context, "rank_history?select=id,player_id,old_rank,new_rank,reason,challenge_match_id,changed_by_profile_id,changed_at&order=changed_at.desc&limit=100"),
    rest(context, "ladder_snapshots?select=id,team_gender,reason,reference_type,reference_id,created_by_profile_id,created_at,restored_at,restored_by_profile_id&order=created_at.desc&limit=30"),
  ]);
  for (const result of results) {
    if (!result.response.ok) throw Object.assign(new Error(result.payload.message || "Coach dashboard data could not be loaded."), { status: result.response.status });
  }
  return {
    players: rows(results[0]), profiles: rows(results[1]), ladder: rows(results[2]), challenges: rows(results[3]), matches: rows(results[4]),
    imports: rows(results[5]), audit: rows(results[6]), rankHistory: rows(results[7]), ladderSnapshots: rows(results[8]),
  };
}

function buildPlayerSnapshots(data, playerMap, challengeMap) {
  const ladderMap = new Map(data.ladder.map(entry => [entry.player_id, entry]));
  const historyMap = new Map();
  for (const item of data.rankHistory) {
    if (!historyMap.has(item.player_id)) historyMap.set(item.player_id, []);
    historyMap.get(item.player_id).push(item);
  }
  for (const history of historyMap.values()) history.sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));

  const formMap = new Map();
  for (const match of data.matches.filter(item => item.approval_status === "verified")) {
    const challenge = challengeMap.get(match.challenge_id);
    if (!challenge) continue;
    for (const playerId of [challenge.challenger_id, challenge.defender_id]) {
      if (!formMap.has(playerId)) formMap.set(playerId, []);
      const opponentId = playerId === challenge.challenger_id ? challenge.defender_id : challenge.challenger_id;
      formMap.get(playerId).push({
        result: match.winner_id === playerId ? "W" : "L",
        opponent: playerMap.get(opponentId)?.display_name || "Player",
        score: match.score_summary || "",
        verifiedAt: match.verified_at || match.submitted_at || null,
      });
    }
  }
  for (const form of formMap.values()) form.sort((a, b) => Date.parse(b.verifiedAt || 0) - Date.parse(a.verifiedAt || 0));

  return data.players.filter(player => player.active_status === "active").map(player => {
    const ladder = ladderMap.get(player.id) || null;
    const history = historyMap.get(player.id) || [];
    const ranks = history.flatMap(item => [Number(item.old_rank), Number(item.new_rank)]).filter(Number.isFinite);
    if (Number.isFinite(Number(ladder?.rank_position))) ranks.push(Number(ladder.rank_position));
    const currentRank = Number.isFinite(Number(ladder?.rank_position)) ? Number(ladder.rank_position) : null;
    const first = history[0] || null;
    const seasonStartRank = Number.isFinite(Number(first?.old_rank)) ? Number(first.old_rank)
      : Number.isFinite(Number(first?.new_rank)) ? Number(first.new_rank)
        : currentRank;
    const bestRank = ranks.length ? Math.min(...ranks) : currentRank;
    const officialForm = (formMap.get(player.id) || []).slice(0, 8);
    const wins = officialForm.filter(item => item.result === "W").length;
    const losses = officialForm.filter(item => item.result === "L").length;
    return {
      id: player.id,
      name: player.display_name,
      teamGender: player.team_gender,
      division: player.division,
      gradeLevel: player.grade_level,
      accountLinked: Boolean(player.profile_id),
      currentRank,
      previousRank: Number.isFinite(Number(ladder?.previous_rank_position)) ? Number(ladder.previous_rank_position) : currentRank,
      seasonStartRank,
      bestRank,
      movement: Number.isFinite(seasonStartRank) && Number.isFinite(currentRank) ? seasonStartRank - currentRank : 0,
      status: ladder?.status || player.active_status,
      rankHistory: history.slice(-20).map(item => ({
        oldRank: item.old_rank,
        newRank: item.new_rank,
        reason: item.reason,
        changedAt: item.changed_at,
      })),
      officialForm: officialForm.slice(0, 5),
      officialChallengeRecord: { wins, losses },
    };
  }).sort((a, b) => a.teamGender.localeCompare(b.teamGender) || (a.currentRank || 999) - (b.currentRank || 999) || a.name.localeCompare(b.name));
}

function buildPayload(data) {
  const playerMap = new Map(data.players.map(player => [player.id, player]));
  const profileMap = new Map(data.profiles.map(profile => [profile.id, profile]));
  const challengeMap = new Map(data.challenges.map(challenge => [challenge.id, challenge]));
  const latestImport = data.imports[0] || null;
  const warnings = safeArray(latestImport?.summary?.warnings).filter(Boolean).slice(0, 12);
  const activePlayers = data.players.filter(player => player.active_status === "active");
  const playersWithoutAccounts = activePlayers.filter(player => !player.profile_id);
  const pendingChallenges = data.challenges.filter(challenge => OPEN_CHALLENGE.has(challenge.status));
  const pendingScores = data.matches.filter(match => match.approval_status === "pending");

  const recentMatches = data.matches.filter(match => match.approval_status === "verified").slice(0, 6).map(match => {
    const challenge = challengeMap.get(match.challenge_id);
    return {
      id: match.id,
      score: match.score_summary,
      verifiedAt: match.verified_at,
      winner: playerMap.get(match.winner_id)?.display_name || "Player",
      challenger: playerMap.get(challenge?.challenger_id)?.display_name || "Player",
      defender: playerMap.get(challenge?.defender_id)?.display_name || "Player",
      teamGender: challenge?.team_gender || null,
    };
  });

  const nextChallenges = data.challenges
    .filter(challenge => challenge.status === "scheduled" && futureTime(challenge.scheduled_for))
    .sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for))
    .slice(0, 6)
    .map(challenge => ({
      id: challenge.id,
      scheduledFor: challenge.scheduled_for,
      courtLocation: challenge.court_location,
      challenger: playerMap.get(challenge.challenger_id)?.display_name || "Player",
      defender: playerMap.get(challenge.defender_id)?.display_name || "Player",
      teamGender: challenge.team_gender,
    }));

  const latestByTeam = new Map();
  for (const snapshot of data.ladderSnapshots) if (!latestByTeam.has(snapshot.team_gender)) latestByTeam.set(snapshot.team_gender, snapshot);
  const undoCandidates = [...latestByTeam.values()]
    .filter(snapshot => !snapshot.restored_at && snapshot.reason !== "import_sync")
    .map(snapshot => ({
      id: snapshot.id,
      teamGender: snapshot.team_gender,
      reason: snapshot.reason,
      referenceType: snapshot.reference_type,
      referenceId: snapshot.reference_id,
      createdAt: snapshot.created_at,
    }));

  const rankByEvent = new Map();
  for (const item of data.rankHistory) {
    const key = item.challenge_match_id ? `challenge_match:${item.challenge_match_id}` : `${item.reason}:${String(item.changed_at).slice(0, 16)}`;
    if (!rankByEvent.has(key)) rankByEvent.set(key, []);
    rankByEvent.get(key).push({
      player: playerMap.get(item.player_id)?.display_name || "Player",
      oldRank: item.old_rank,
      newRank: item.new_rank,
      reason: item.reason,
      changedAt: item.changed_at,
    });
  }

  const audit = data.audit.slice(0, 40).map(event => {
    const actor = profileMap.get(event.actor_profile_id);
    const rankKey = event.action_type === "verify_challenge_match" ? `challenge_match:${event.target_id}` : null;
    return {
      id: event.id,
      action: event.action_type,
      targetType: event.target_type,
      targetId: event.target_id,
      reason: event.reason,
      metadata: event.metadata || {},
      createdAt: event.created_at,
      actor: actor?.full_name || actor?.email || "System",
      rankChanges: rankKey ? rankByEvent.get(rankKey) || [] : [],
    };
  });

  return {
    needsAttention: {
      pendingChallenges: pendingChallenges.length,
      pendingScores: pendingScores.length,
      importWarnings: warnings.length,
      playersWithoutAccounts: playersWithoutAccounts.length,
    },
    teamStatus: {
      activePlayers: activePlayers.length,
      totalPlayers: data.players.length,
      latestImport: latestImport ? { id: latestImport.id, sourceLabel: latestImport.source_label, rowCount: latestImport.row_count, createdAt: latestImport.created_at } : null,
      recentMatches,
      nextChallenges,
    },
    importWarnings: warnings,
    missingAccounts: playersWithoutAccounts.map(player => ({ id: player.id, name: player.display_name, teamGender: player.team_gender, division: player.division, gradeLevel: player.grade_level })),
    playerSnapshots: buildPlayerSnapshots(data, playerMap, challengeMap),
    audit,
    undoCandidates,
  };
}

module.exports = { OPEN_CHALLENGE, loadCoachData, buildPlayerSnapshots, buildPayload };
