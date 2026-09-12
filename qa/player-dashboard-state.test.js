const assert = require("node:assert/strict");
const dashboard = require("../player-dashboard-state.js");

const summary = dashboard.summaryFromWorkflow({
  viewer: {
    profileId: "profile-1",
    role: "player",
    playerId: "player-1",
    playerName: "Alex Rivera",
    teamGender: "boys",
    rosterDivision: "jv",
    gradeLevel: 10,
  },
  ladder: [{
    player_id: "player-1",
    rank_position: 4,
    previous_rank_position: 6,
    status: "available",
    player: {
      id: "player-1",
      profile_id: "profile-1",
      display_name: "Alex Rivera",
      team_gender: "boys",
      division: "jv",
      grade_level: 10,
      active_status: "active",
    },
  }],
});

assert.equal(summary.linked, true);
assert.equal(summary.rank, 4);
assert.equal(summary.previousRank, 6);
assert.deepEqual(summary.movement, { label: "↑2", direction: "up" });
assert.equal(summary.rosterDivision, "jv");
assert.equal(summary.gradeLevel, 10);

const legacyFallback = dashboard.summaryFromWorkflow({
  viewer: { profileId: "legacy-profile", playerName: "Legacy Player" },
  ladder: [{
    player_id: "legacy-player",
    rank_position: 2,
    previous_rank_position: 2,
    player: { profile_id: "legacy-profile", display_name: "Legacy Player", team_gender: "girls", division: "varsity" },
  }],
});
assert.equal(legacyFallback.playerId, "legacy-player");
assert.equal(legacyFallback.rank, 2);

const missing = dashboard.summaryFromWorkflow({ viewer: { profileId: "missing", playerName: "Not Imported" }, ladder: [] });
assert.equal(missing.linked, false);
assert.equal(missing.rank, null);

console.log("player dashboard state tests passed");
