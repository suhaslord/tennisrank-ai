const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { playerRecords } = require("../lib/player-records");
const { allRows } = require("../lib/paged-rest");
const { loadCoachData, buildPayload } = require("../lib/coach-dashboard");
const challenges = require("../api/challenges");
const engine = require("../lib/ladder-engine");
const records = require("../api/records");
const seed = require("../api/admin/seed-ladder");
const ladder = require("../api/ladder");
const workbook = require("../api/sheet-workbook");
const csv = require("../api/sheet-proxy");

const privateRows = [{ Name: "Alice", Opponent: "Bob", Result: "W", Score: "6-2 6-3", Gender: "girls", Division: "singles", "Parent phone": "SECRET", emergencyContact: "SECRET", __originalRow: { email: "SECRET" }, scoreMetadata: { secret: "SECRET" } }];
assert.equal(JSON.stringify(playerRecords(privateRows)).includes("SECRET"), false);
assert.equal(playerRecords(privateRows)[0].winner, "Alice");
assert.deepEqual(playerRecords([{ name: "Alice", score: { phone: "SECRET" }, __aggregateWins: 4, __analysis: { private: true } }]), [{ name: "Alice", __aggregateWins: 4 }]);
const doubles = playerRecords([{ name: "Alice", partner: "Bea", opponent: "Cara", opponentPartner: "Dee", result: "W", division: "doubles" }])[0];
assert.equal(doubles.winner, "Alice & Bea");
assert.equal(doubles.loser, "Cara & Dee");
assert.equal(privateRows[0].winner, undefined, "projection never mutates the stored import");
const appSource = fs.readFileSync(require.resolve("../app.js"), "utf8");
const sandbox = { URL, console, clearInterval, clearTimeout, setInterval, setTimeout,
  cancelAnimationFrame() {}, requestAnimationFrame() { return 0; }, performance: { now: () => 0 },
  document: { querySelector: () => null, querySelectorAll: () => [] }, window: { matchMedia: () => ({ matches: true }) } };
vm.createContext(sandbox);
vm.runInContext(appSource.split("$$('[data-gender]')")[0] + ';globalThis.calculate = calculateRankings;', sandbox);
const rankingRows = [...privateRows, { name: "Cara", gender: "girls", division: "singles", record: "8-2", __aggregateWins: 8, __aggregateLosses: 2 }];
const importer = require("../import-v2");
const before = importer.enhancedCalculateRankings(rankingRows, sandbox.calculate);
const after = importer.enhancedCalculateRankings(playerRecords(rankingRows), sandbox.calculate);
assert.equal(JSON.stringify(after.rankings), JSON.stringify(before.rankings), "privacy projection preserves actual ranking and aggregate calculations");
assert.equal(JSON.stringify(after.matches), JSON.stringify(before.matches), "privacy projection preserves actual match results");
assert.equal(playerRecords([{name:"Context player",__contextGender:"boys",__contextDivision:"singles"}])[0].gender,"boys");

for (const invalid of [undefined, null, {}, "tomorrow", []]) assert.throws(() => challenges.normalizeProposedTimes(invalid), error => error.status === 400);
assert.equal(engine.currentWinStreak([{ date: "6/1/2026", winner: "Alice", loser: "Bob" }, { date: "12/1/2026", winner: "Bob", loser: "Alice" }], "Alice"), 0);
assert.equal(engine.currentWinStreak([{ date: "invalid", winner: "Alice" }, { date: "2026-10-01", loser: "Alice" }], "Alice"), 0);

function response() {
  return { code: 0, body: null, setHeader() { return this; }, status(value) { this.code = value; return this; }, send(value) { this.body = typeof value === "string" ? JSON.parse(value) : value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
}
const reply = payload => ({ ok: true, status: 200, json: async () => payload });

(async () => {
  const pageQueries = [];
  const paged = await allRows({}, async (_, query) => {
    const params = new URL("https://test/" + query).searchParams;
    pageQueries.push(query);
    return replyResult(Array.from({ length: Number(params.get("offset")) ? 1 : 1000 }, (_, id) => ({ id })));
  }, "players?select=id&order=id.asc");
  assert.equal(paged.payload.length, 1001);
  assert.equal(pageQueries.length, 2);

  const players = [{ id: "a", display_name: "Alice", active_status: "injured", team_gender: "girls", division: "varsity" }];
  const open = { id: "old-open", challenger_id: "a", defender_id: "b", status: "pending_coach_approval", team_gender: "girls" };
  const history = [...Array.from({ length: 120 }, (_, id) => ({ id: "closed" + id, status: "verified" })), open];
  const matches = [...Array.from({ length: 120 }, (_, id) => ({ id: "verified" + id, approval_status: "verified" })), { id: "pending", challenge_id: open.id, approval_status: "pending" }];
  const queries = [];
  const data = await loadCoachData({}, async (_, path) => {
    queries.push(path);
    const url = new URL("https://test/" + path);
    const tables = { players, profiles: [], ladder_entries: [], challenges: history, challenge_matches: matches, import_snapshots: [], audit_logs: [], rank_history: [] };
    if (url.pathname === "/ladder_snapshots") return replyResult([{ id: url.searchParams.get("team_gender"), team_gender: url.searchParams.get("team_gender").slice(3), reason: "manual_move" }]);
    const selected = tables[url.pathname.slice(1)] || [];
    return replyResult(selected.slice(Number(url.searchParams.get("offset") || 0), Number(url.searchParams.get("offset") || 0) + Number(url.searchParams.get("limit") || 1000)));
  });
  const dashboard = buildPayload(data);
  assert.equal(dashboard.needsAttention.pendingScores, 1, "older pending scores remain actionable");
  assert.equal(dashboard.needsAttention.pendingChallenges, 1, "older open challenges remain visible");
  assert.equal(dashboard.playerSnapshots[0].status, "injured");
  assert.equal(dashboard.playerSnapshots[0].currentRank, null, "unranked players never acquire a fake rank zero");
  assert.equal(dashboard.undoCandidates.length, 2, "latest undo is fetched separately for each team");

  const originalFetch = global.fetch;
  const previousEnv = [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY];
  process.env.SUPABASE_URL = "https://launch.example.test";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-test";
  let role = "player";
  const mutations = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/user") return reply({ id: "viewer" });
    if (url.pathname === "/rest/v1/profiles") return reply([{ id: "viewer", role }]);
    if (url.pathname === "/rest/v1/tennis_records") return reply(url.searchParams.get("select") === "source_key,updated_at" ? [{ source_key: "source" }] : privateRows.map(raw_data => ({ raw_data })));
    if (url.pathname === "/rest/v1/rpc/admin_seed_ladder") { mutations.push(JSON.parse(init.body)); return reply(JSON.parse(init.body).p_players.length); }
    if (url.pathname === "/rest/v1/players") return reply([{ id: "a", profile_id: "viewer" }]);
    if (url.pathname === "/rest/v1/rank_history") {
      assert.match(url.searchParams.get("order"), /^changed_at.desc/);
      return reply([{ id: 102, changed_at: "2026-10-02" }, { id: 101, changed_at: "2026-10-01" }]);
    }
    if (["/rest/v1/ladder_entries", "/rest/v1/team_settings"].includes(url.pathname)) return reply([]);
    throw new Error("Unexpected request: " + input);
  };
  const request = (method, body, query = {}) => ({ method, body, query, headers: { authorization: "Bearer viewer-token" } });
  try {
    let result = response();
    await records(request("GET"), result);
    assert.equal(result.code, 200);
    assert.equal(JSON.stringify(result.body).includes("SECRET"), false, "actual player API response strips private columns");
    result = response();
    await ladder.standardLadder({ url: process.env.SUPABASE_URL, key: "service-test", profile: { id: "viewer", role } }).then(payload => assert.deepEqual(payload.rankHistory.map(item => item.id), [101, 102]));
    role = "admin";
    result = response();
    await records(request("GET"), result);
    assert.equal(result.body.rows[0]["Parent phone"], "SECRET", "coach keeps original import access");
    result = response();
    await seed(request("POST", { teamGender: "boys", players: Array.from({ length: 101 }, (_, i) => ({ name: "Player " + i })) }), result);
    assert.equal(result.code, 201);
    assert.equal(mutations[0].p_players.length, 101);
    for (const entries of [[{ name: "Alice" }, { name: " " }], [{ name: "Alice" }, { name: "alice" }], Array.from({ length: 1001 }, (_, i) => ({ name: "Player " + i }))]) {
      result = response(); await seed(request("POST", { teamGender: "boys", players: entries }), result);
      assert.ok([400, 413].includes(result.code));
    }
    assert.equal(mutations.length, 1, "invalid rosters fail before any mutation");
    for (const [handler, url] of [[workbook, "https://docs.google.com/spreadsheets/d/abc123/edit"], [csv, "https://docs.google.com/spreadsheets/d/abc123/export?format=csv"]]) {
      result = response(); await handler({ method: "GET", headers: {}, query: { url } }, result);
      assert.equal(result.code, 401, "anonymous sheet requests are rejected before contacting Google");
      role = "player";
      result = response(); await handler(request("GET", null, { url }), result);
      assert.equal(result.code, 403, "players cannot use coach import proxies");
    }
  } finally {
    global.fetch = originalFetch;
    for (const [index, key] of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].entries()) {
      if (previousEnv[index] === undefined) delete process.env[key]; else process.env[key] = previousEnv[index];
    }
  }
  console.log("Launch hardening regressions passed: private-column isolation, complete rosters and queues, both undo teams, injury visibility, recent history, deadlines, dates, and authenticated sheet proxies.");
})().catch(error => { console.error(error); process.exitCode = 1; });

function replyResult(payload) { return { response: { ok: true, status: 200 }, payload }; }
