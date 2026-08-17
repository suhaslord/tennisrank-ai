const assert = require("node:assert/strict");
const recordsApi = require("../api/records.js");
const coachApi = require("../lib/coach-dashboard.js");
const coachOps = require("../coach-ops.js");

const rowsA = [{ Name: "Aiden", Gender: "Boys", Division: "Singles" }];
const rowsB = [{ Name: "Aiden", Gender: "Boys", Division: "Singles" }, { Name: "Maya", Gender: "Girls", Division: "Singles" }];
assert.equal(recordsApi.contentHash(rowsA), recordsApi.contentHash(rowsA), "content hash is deterministic");
assert.notEqual(recordsApi.contentHash(rowsA), recordsApi.contentHash(rowsB), "content hash changes with rows");
assert.notEqual(recordsApi.previewHash(rowsA, "one.csv"), recordsApi.previewHash(rowsA, "two.csv"), "preview hash binds the source");

const grouped = coachOps.boardEntries([
  { name: "Aiden", gender: "boys", division: "singles" },
  { name: "Mateo", gender: "boys", division: "singles" },
  { name: "Aiden & Mateo", gender: "boys", division: "doubles" },
]);
assert.deepEqual(grouped.map(item => [item.name, item.rank]), [["Aiden", 1], ["Mateo", 2], ["Aiden & Mateo", 1]], "rank positions reset per board");

const now = new Date().toISOString();
const future = new Date(Date.now() + 3_600_000).toISOString();
const dashboard = coachApi.buildPayload({
  players: [
    { id: "p1", profile_id: "u1", display_name: "Aiden", team_gender: "boys", division: "varsity", grade_level: 12, active_status: "active" },
    { id: "p2", profile_id: null, display_name: "Ethan", team_gender: "boys", division: "jv", grade_level: 9, active_status: "active" },
  ],
  profiles: [{ id: "u1", full_name: "Aiden", email: "a@example.test" }, { id: "admin", full_name: "Coach", email: "coach@example.test" }],
  ladder: [
    { player_id: "p1", team_gender: "boys", rank_position: 1, previous_rank_position: 2, status: "available" },
    { player_id: "p2", team_gender: "boys", rank_position: 2, previous_rank_position: 2, status: "available" },
  ],
  challenges: [
    { id: "c1", challenger_id: "p2", defender_id: "p1", team_gender: "boys", status: "scheduled", scheduled_for: future, created_at: now },
    { id: "c2", challenger_id: "p1", defender_id: "p2", team_gender: "boys", status: "completed", created_at: now, completed_at: now },
  ],
  matches: [
    { id: "m1", challenge_id: "c1", score_summary: "6-4, 6-3", winner_id: "p2", approval_status: "pending", submitted_at: now },
    { id: "m2", challenge_id: "c2", score_summary: "6-2, 6-4", winner_id: "p1", approval_status: "verified", submitted_at: now, verified_at: now },
  ],
  imports: [{ id: "i1", source_label: "Coach.csv", row_count: 20, summary: { warnings: ["Check one row"] }, created_at: now }],
  audit: [{ id: 1, actor_profile_id: "admin", action_type: "manual_rank_move", target_type: "player", target_id: "p1", metadata: { old_rank: 2, new_rank: 1 }, created_at: now }],
  rankHistory: [
    { id:"h1", player_id:"p1", old_rank:3, new_rank:2, reason:"import_sync", changed_at:"2026-08-01T00:00:00Z" },
    { id:"h2", player_id:"p1", old_rank:2, new_rank:1, reason:"challenge_result", challenge_match_id:"m2", changed_at:now },
  ],
  ladderSnapshots: [{ id: "s1", team_gender: "boys", reason: "manual_move", reference_type: "player", reference_id: "p1", created_at: now, restored_at: null }],
});
assert.equal(dashboard.needsAttention.pendingChallenges, 1);
assert.equal(dashboard.needsAttention.pendingScores, 1);
assert.equal(dashboard.needsAttention.importWarnings, 1);
assert.equal(dashboard.needsAttention.playersWithoutAccounts, 1);
assert.equal(dashboard.teamStatus.activePlayers, 2);
assert.equal(dashboard.teamStatus.nextChallenges.length, 1);
assert.equal(dashboard.missingAccounts[0].name, "Ethan");
assert.equal(dashboard.undoCandidates[0].id, "s1");
const aidenSnapshot = dashboard.playerSnapshots.find(item => item.id === "p1");
assert.equal(aidenSnapshot.currentRank, 1);
assert.equal(aidenSnapshot.seasonStartRank, 3);
assert.equal(aidenSnapshot.bestRank, 1);
assert.equal(aidenSnapshot.movement, 2);
assert.deepEqual(aidenSnapshot.officialChallengeRecord, { wins: 1, losses: 0 });
assert.equal(aidenSnapshot.officialForm[0].result, "W");

console.log("Coach operations unit suite passed: preview hashes, board grouping, dashboard attention, player snapshots, audit undo candidate.");
