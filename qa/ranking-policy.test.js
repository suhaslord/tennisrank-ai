const assert = require("node:assert/strict");
const policy = require("../ranking-policy.js");

function names(players) {
  return policy.sortRankings(players).map(player => player.name);
}

assert.deepEqual(names([
  { name: "Losing 1", wins: 1, losses: 2 },
  { name: "New Player", wins: 0, losses: 0 },
  { name: "Winning 1", wins: 2, losses: 1 },
]), ["Winning 1", "New Player", "Losing 1"]);

assert.deepEqual(names([
  { name: "Alpha", wins: 0, losses: 0 },
  { name: "Zulu", wins: 0, losses: 0 },
  { name: "Even Veteran", wins: 3, losses: 3 },
]), ["Even Veteran", "Alpha", "Zulu"], "played .500 records remain ahead of brand-new 0-0 players inside the neutral tier");

assert.deepEqual(names([
  { name: "B", wins: 4, losses: 2 },
  { name: "A", wins: 4, losses: 2 },
  { name: "Higher Diff", wins: 5, losses: 2 },
]), ["Higher Diff", "A", "B"], "ties are deterministic");

assert.equal(policy.recordTier({ wins: 3, losses: 2 }), 0);
assert.equal(policy.recordTier({ wins: 0, losses: 0 }), 1);
assert.equal(policy.recordTier({ wins: 2, losses: 3 }), 2);

console.log("ranking policy tests passed");
