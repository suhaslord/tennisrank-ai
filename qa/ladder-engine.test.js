const assert = require("assert");
const engine = require("../lib/ladder-engine.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("rank #8 may challenge only #5, #6, #7", () => {
  const players = Array.from({ length: 8 }, (_, index) => ({
    id: `p${index + 1}`,
    rank: index + 1,
    gender: "boys",
    status: "available",
  }));
  assert.deepStrictEqual(engine.eligibleOpponents(players, "p8").map(player => player.rank), [5, 6, 7]);
});

test("pending or injured opponents are excluded", () => {
  const players = [
    { id: "p5", rank: 5, gender: "boys", status: "injury_hold" },
    { id: "p6", rank: 6, gender: "boys", status: "challenge_pending" },
    { id: "p7", rank: 7, gender: "boys", status: "available" },
    { id: "p8", rank: 8, gender: "boys", status: "available" },
  ];
  assert.deepStrictEqual(engine.eligibleOpponents(players, "p8").map(player => player.id), ["p7"]);
});

test("challenger takes defender rank and intermediate players shift down", () => {
  const players = [5, 6, 7, 8].map(rank => ({ id: `p${rank}`, rank }));
  const result = engine.applyChallengeResult(players, "p8", "p6", true);
  const ranks = Object.fromEntries(result.map(player => [player.id, player.rank]));
  assert.deepStrictEqual(ranks, { p5: 5, p8: 6, p6: 7, p7: 8 });
});

test("defender win leaves ranks unchanged", () => {
  const players = [5, 6, 7, 8].map(rank => ({ id: `p${rank}`, rank }));
  const result = engine.applyChallengeResult(players, "p8", "p6", false);
  assert.deepStrictEqual(result.map(player => player.rank), [5, 6, 7, 8]);
});

test("standard straight-set score is valid", () => {
  assert.equal(engine.parseScoreSummary("6-4, 7-5").valid, true);
});

test("10-2 is accepted as a match tiebreak", () => {
  assert.equal(engine.parseScoreSummary("6-3, 4-6, 10-2").valid, true);
});

test("legacy 8-6 pro-set format remains valid", () => {
  assert.equal(engine.parseScoreSummary("8-6").valid, true);
});

test("10-9 is rejected because a tiebreak must be won by two", () => {
  assert.equal(engine.parseScoreSummary("10-9").valid, false);
});

test("selected winner score must be entered from winner perspective", () => {
  assert.equal(engine.validateWinnerScore("6-4, 4-6, 10-8").valid, true);
  assert.equal(engine.validateWinnerScore("4-6, 5-7").valid, false);
});

test("a split score with no deciding set is rejected as incomplete", () => {
  const parsed = engine.parseScoreSummary("6-4, 4-6");
  assert.equal(parsed.valid, false);
  assert.match(parsed.error, /match winner/i);
});

test("active streak stops at the most recent loss", () => {
  const matches = [
    { date: "2026-08-12", winner: "Alex", loser: "Ben" },
    { date: "2026-08-11", winner: "Alex", loser: "Chris" },
    { date: "2026-08-10", winner: "Drew", loser: "Alex" },
    { date: "2026-08-09", winner: "Alex", loser: "Evan" },
  ];
  assert.equal(engine.currentWinStreak(matches, "Alex"), 2);
});

test("movement labels use previous minus current rank", () => {
  assert.deepStrictEqual(engine.movementLabel(8, 6), { delta: 2, label: "↑2", direction: "up" });
  assert.deepStrictEqual(engine.movementLabel(5, 6), { delta: -1, label: "↓1", direction: "down" });
});

console.log("All ladder engine tests passed.");
