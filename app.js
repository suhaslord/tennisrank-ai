const SAMPLE_CSV = `Name,Gender,Division,Player 1,Player 2,Winner,Loser,Score,Date
Ava Patel,Girls,Singles,,,,,,
Mia Rodriguez,Girls,Singles,,,,,,
Noah Williams,Boys,Singles,,,,,,
Ethan Kim,Boys,Singles,,,,,,
Liam Chen,Boys,Doubles,,,,,,
Oliver Davis,Boys,Doubles,,,,,,
Sofia Garcia,Girls,Doubles,,,,,,
Emma Wilson,Girls,Doubles,,,,,,
,Boys,Singles,Noah Williams,Ethan Kim,Noah Williams,Ethan Kim,6-3,2026-08-03
,Boys,Singles,Ethan Kim,Noah Williams,Ethan Kim,Noah Williams,7-5,2026-08-04
,Girls,Singles,Ava Patel,Mia Rodriguez,Ava Patel,Mia Rodriguez,6-4,2026-08-03
,Boys,Doubles,Liam Chen & Oliver Davis,Marcus Lee & James Park,Liam Chen & Oliver Davis,Marcus Lee & James Park,8-6,2026-08-02
,Girls,Doubles,Sofia Garcia & Emma Wilson,Chloe Brown & Maya Shah,Chloe Brown & Maya Shah,Sofia Garcia & Emma Wilson,8-5,2026-08-03`;

const state = {
  rows: [],
  matches: [],
  rankings: [],
  activeGender: "all",
  activeDivision: "all",
  source: "sample",
  sourceUrl: "",
  lastUpdated: null,
  refreshTimer: null,
  backendAvailable: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCSV(text) {
  const result = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) result.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) result.push(row); }
  if (!result.length) return [];
  const headers = result[0].map(normalizeHeader);
  return result.slice(1).map((values, rowIndex) => {
    const row = Object.fromEntries(headers.map((header, index) => [header || `column${index}`, values[index] || ""]));
    row.__sourceRow = rowIndex + 2;
    return row;
  }).filter(row => Object.entries(row).some(([key, value]) => key !== "__sourceRow" && Boolean(value)));
}

function valueFrom(row, aliases) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const target = normalizeHeader(alias);
    const found = entries.find(([key, value]) => value && (key === target || key.includes(target)));
    if (found) return String(found[1]).trim();
  }
  return "";
}

function normalizeGender(value, division = "") {
  const text = `${value} ${division}`.toLowerCase();
  if (/\b(girl|girls|female|women|woman|wta|f)\b/.test(text)) return "girls";
  if (/\b(boy|boys|male|men|man|atp|m)\b/.test(text)) return "boys";
  return "unknown";
}

function normalizeDivision(value) {
  const text = String(value || "").toLowerCase();
  return /double|pair|team/.test(text) ? "doubles" : "singles";
}

function splitNames(value) {
  return String(value || "")
    .replace(/\s+(?:and|&|\+|vs\.?|versus)\s+/gi, "|")
    .split(/[|;/]/)
    .map(name => name.replace(/^\s*(?:player\s*)?[ab12]\s*[:.)-]?\s*/i, "").trim())
    .filter(Boolean);
}

function cleanNames(value) {
  return splitNames(value).map(name => name.replace(/\s+/g, " ").trim());
}

function keyFor(name, gender, division) {
  return `${gender}|${division}|${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

function pairLabel(names) {
  const clean = names.filter(Boolean).map(name => name.trim());
  return clean.length > 1 ? [...clean].sort((a, b) => a.localeCompare(b)).join(" & ") : clean[0] || "Unknown team";
}

function isSamePerson(value, target) {
  const a = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = target.toLowerCase().replace(/[^a-z0-9]/g, "");
  return a === b || a.includes(b) || b.includes(a);
}

function readMatch(row, gender, division) {
  let winner = valueFrom(row, ["winner", "wonby", "victor", "winningplayer", "winners"]);
  let loser = valueFrom(row, ["loser", "lostto", "defeated", "losingplayer", "losers"]);
  const player1 = valueFrom(row, ["player1", "playera", "team1", "side1", "opponent1"]);
  const player2 = valueFrom(row, ["player2", "playerb", "team2", "side2", "opponent2"]);
  const result = valueFrom(row, ["result", "outcome", "winneris", "matchresult"]);

  // Also accept a common row-per-player format: Player | Opponent | Result (W/L).
  const player = valueFrom(row, ["player", "athlete", "playername"]);
  const opponent = valueFrom(row, ["opponent", "against", "versus"]);
  if ((!winner || !loser) && player && opponent && result) {
    if (/^\s*(w|win|won|winner)\b/i.test(result)) { winner = player; loser = opponent; }
    if (/^\s*(l|loss|lost|loser)\b/i.test(result)) { winner = opponent; loser = player; }
  }

  if ((!winner || !loser) && player1 && player2) {
    const resultText = `${winner} ${result}`.toLowerCase();
    if (/\b(player\s*1|player\s*a|side\s*1|side\s*a|^1$|^a$)\b/.test(resultText) || isSamePerson(winner, player1)) {
      winner = player1; loser = player2;
    } else if (/\b(player\s*2|player\s*b|side\s*2|side\s*b|^2$|^b$)\b/.test(resultText) || isSamePerson(winner, player2)) {
      winner = player2; loser = player1;
    } else if (/\b(w|win|won)\b/.test(resultText) && !/\b(l|loss|lost)\b/.test(resultText)) {
      winner = player1; loser = player2;
    }
  }
  if (!winner || !loser) return null;
  const winnerNames = cleanNames(winner);
  const loserNames = cleanNames(loser);
  if (!winnerNames.length || !loserNames.length) return null;
  return {
    gender,
    division,
    winner: division === "doubles" ? pairLabel(winnerNames) : winnerNames[0],
    loser: division === "doubles" ? pairLabel(loserNames) : loserNames[0],
    score: valueFrom(row, ["score", "resultscore", "gamescore"]),
    date: valueFrom(row, ["date", "matchdate", "playedon", "timestamp"]),
  };
}

function calculateRankings(rows) {
  const entities = new Map();
  const matches = [];
  const ensure = (name, gender, division) => {
    if (!name || gender === "unknown") return;
    const label = division === "doubles" ? pairLabel(cleanNames(name)) : name.trim();
    if (!label) return;
    const key = keyFor(label, gender, division);
    if (!entities.has(key)) entities.set(key, { key, name: label, gender, division, wins: 0, losses: 0 });
    return entities.get(key);
  };

  rows.forEach(row => {
    const divisionText = valueFrom(row, ["division", "category", "format", "event", "type"]);
    const gender = normalizeGender(valueFrom(row, ["gender", "sex", "team"]), divisionText);
    const division = normalizeDivision(divisionText || valueFrom(row, ["matchtype", "discipline"]));
    const rosterName = valueFrom(row, ["name", "player", "athlete", "playername", "teamname"]);
    const match = readMatch(row, gender, division);
    if (rosterName && !match) {
      if (division === "doubles" && /[&+;/]|\band\b/i.test(rosterName)) ensure(pairLabel(cleanNames(rosterName)), gender, division);
      else ensure(rosterName, gender, division);
    }
    if (match) {
      const winEntity = ensure(match.winner, gender, division);
      const loseEntity = ensure(match.loser, gender, division);
      if (winEntity && loseEntity) {
        winEntity.wins += 1; loseEntity.losses += 1;
        matches.push(match);
      }
    }
  });

  const rankings = [...entities.values()].map(player => ({
    ...player,
    matches: player.wins + player.losses,
    diff: player.wins - player.losses,
    winRate: player.wins + player.losses ? player.wins / (player.wins + player.losses) : 0,
  })).sort((a, b) => b.diff - a.diff || b.winRate - a.winRate || b.wins - a.wins || a.name.localeCompare(b.name));
  return { rankings, matches: matches.sort((a, b) => String(b.date).localeCompare(String(a.date))) };
}

function filteredRankings() {
  return state.rankings.filter(player => (state.activeGender === "all" || player.gender === state.activeGender) && (state.activeDivision === "all" || player.division === state.activeDivision));
}

function displayName(name) { return name || "Unnamed player"; }
function formatRate(rate) { return `${Math.round(rate * 100)}%`; }
function formatDiff(diff) { return diff > 0 ? `+${diff}` : String(diff); }
function groupTitle(gender, division) { return `${gender === "boys" ? "Boys" : "Girls"} ${division === "singles" ? "singles" : "doubles"}`; }

function renderSummary() {
  const players = state.rankings;
  const matches = state.matches;
  const active = filteredRankings();
  const positive = players.filter(p => p.diff > 0).length;
  $("#summaryGrid").innerHTML = [
    ["Tracked players", players.length, `${players.filter(p => p.matches === 0).length} starting at 0–0`],
    ["Matches analyzed", matches.length, `${positive} with a winning record`],
    ["Top win rate", players.filter(p => p.matches).length ? formatRate(Math.max(...players.filter(p => p.matches).map(p => p.winRate))) : "0%", "calculated from recorded matches"],
    ["Showing now", active.length, `${state.activeGender === "all" ? "all teams" : state.activeGender} · ${state.activeDivision === "all" ? "all formats" : state.activeDivision}`],
  ].map(([label, value, detail]) => `<article class="summary-card"><div class="summary-label">${label}</div><div class="summary-value">${value}</div><div class="summary-detail">${detail}</div></article>`).join("");
}

function rankingCard(gender, division) {
  const players = state.rankings.filter(p => p.gender === gender && p.division === division);
  const filtered = players.filter(p => state.activeGender === "all" || state.activeGender === gender).filter(p => state.activeDivision === "all" || state.activeDivision === division).slice(0, 5);
  const full = players.slice(0, 5);
  const data = (state.activeGender === "all" && state.activeDivision === "all") ? full : filtered;
  return `<article class="ranking-card">
    <div class="ranking-card-head"><div><div class="ranking-title">${groupTitle(gender, division)}</div><div class="ranking-subtitle">${players.length} tracked ${division === "singles" ? "players" : "teams"}</div></div><div class="ranking-icon">${division === "singles" ? "◉" : "◈"}</div></div>
    ${data.length ? data.map((player, index) => `<div class="ranking-row"><div class="rank-number ${index < 3 ? "top" : ""}">#${index + 1}</div><div><div class="rank-name">${displayName(player.name)}</div><div class="rank-record">${player.wins}W – ${player.losses}L · ${formatRate(player.winRate)} win rate</div></div><div class="rank-diff ${player.diff < 0 ? "negative" : ""}">${formatDiff(player.diff)}</div></div>`).join("") : `<div class="empty-state">No players match these filters yet.</div>`}
  </article>`;
}

function renderRankings() {
  $("#rankingsGrid").innerHTML = [rankingCard("boys", "singles"), rankingCard("boys", "doubles"), rankingCard("girls", "singles"), rankingCard("girls", "doubles")].join("");
  const players = filteredRankings();
  $("#rankingTable").innerHTML = players.length ? players.map((p, index) => `<tr><td>${index + 1}</td><td class="player-cell">${displayName(p.name)}</td><td>${p.gender}</td><td>${p.division}</td><td>${p.wins}–${p.losses}</td><td class="${p.diff < 0 ? "bad" : "good"}">${formatDiff(p.diff)}</td><td>${formatRate(p.winRate)}</td></tr>`).join("") : `<tr><td colspan="7" class="empty-state">No ranking data available.</td></tr>`;
}

function renderMatches() {
  const matches = state.matches.filter(match => (state.activeGender === "all" || match.gender === state.activeGender) && (state.activeDivision === "all" || match.division === state.activeDivision)).slice(0, 8);
  $("#matchesList").innerHTML = matches.length ? matches.map(match => `<div class="match-row"><div class="match-meta">${match.gender} ${match.division}<br />${match.date || "Recent"}</div><div class="match-players"><strong>${displayName(match.winner)}</strong><span>def.</span>${displayName(match.loser)}</div><div class="match-score">${match.score || "WIN"}</div></div>`).join("") : `<div class="empty-state">No matches have been recorded yet.</div>`;
}

function render() {
  renderSummary(); renderRankings(); renderMatches();
  $("#lastUpdated").textContent = state.lastUpdated ? `Updated ${state.lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Sample data";
}

function loadRows(rows, source = "csv") {
  if (!rows.length) throw new Error("No rows were found. Check that the first row contains column headers.");
  const calculated = calculateRankings(rows);
  state.rows = rows; state.rankings = calculated.rankings; state.matches = calculated.matches; state.source = source; state.lastUpdated = new Date();
  render();
}

function loadText(text, source = "csv") {
  const rows = parseCSV(text);
  loadRows(rows, source);
}

function googleCsvUrl(input) {
  const url = new URL(input);
  if (url.hostname !== "docs.google.com") return input;
  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) return input;
  const gid = url.hash.match(/gid=([0-9]+)/)?.[1] || url.searchParams.get("gid") || "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}

async function fetchSheet() {
  const input = $("#sheetUrl").value.trim() || state.sourceUrl;
  if (!input) throw new Error("Paste a Google Sheet link first.");
  const url = googleCsvUrl(input);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`The sheet could not be loaded (${response.status}). Check sharing permissions.`);
  const text = await response.text();
  if (text.trim().startsWith("<!DOCTYPE html") || text.includes("Sign in to continue")) throw new Error("Google returned a webpage instead of CSV. Set the sheet to Anyone with the link — Viewer.");
  state.sourceUrl = input;
  localStorage.setItem("tennisRankSheetUrl", input);
  loadText(text, "sheet");
}

async function fetchBackendRecords() {
  const response = await fetch("/api/records", { cache: "no-store" });
  if (!response.ok) throw new Error("Persistent backend is not configured yet.");
  const payload = await response.json();
  state.backendAvailable = true;
  const backendStatus = $("#backendStatus");
  backendStatus.textContent = `${payload.count || 0} saved spreadsheet rows available.`;
  backendStatus.className = "connected";
  if (Array.isArray(payload.rows) && payload.rows.length) loadRows(payload.rows, "backend");
  return payload;
}

async function syncToBackend(rows = state.rows) {
  const token = $("#backendToken").value.trim() || sessionStorage.getItem("tennisRankBackendToken") || "";
  if (token) sessionStorage.setItem("tennisRankBackendToken", token);
  const response = await fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) },
    body: JSON.stringify({ rows, source: state.sourceUrl || state.source || "default" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The backend could not save this data.");
  state.backendAvailable = true;
  const backendStatus = $("#backendStatus");
  backendStatus.textContent = `${payload.saved || rows.length} rows saved to the database.`;
  backendStatus.className = "connected";
  return payload;
}

function setStatus(message, error = false) { const element = $("#statusMessage"); element.textContent = message; element.classList.toggle("error", error); }

function startRefresh() {
  clearInterval(state.refreshTimer);
  const seconds = Number($("#refreshRate").value);
  if (seconds && state.source === "sheet") state.refreshTimer = setInterval(() => fetchSheet().then(() => syncToBackend()).catch(error => setStatus(error.message, true)), seconds * 1000);
  if (seconds && state.source === "backend") state.refreshTimer = setInterval(() => fetchBackendRecords().catch(error => setStatus(error.message, true)), seconds * 1000);
  localStorage.setItem("tennisRankRefreshRate", String(seconds));
}

$$('[data-gender]').forEach(button => button.addEventListener("click", () => {
  $$('[data-gender]').forEach(item => item.classList.remove("active")); button.classList.add("active"); state.activeGender = button.dataset.gender; render();
}));
$$('[data-division]').forEach(button => button.addEventListener("click", () => {
  $$('[data-division]').forEach(item => item.classList.remove("active")); button.classList.add("active"); state.activeDivision = button.dataset.division; render();
}));

$$('.source-tab').forEach(button => button.addEventListener("click", () => {
  $$('.source-tab').forEach(item => item.classList.remove("active")); $$('.source-view').forEach(item => item.classList.remove("active")); button.classList.add("active"); $(`#${button.dataset.source === "sheet" ? "sheetSource" : "csvSource"}`).classList.add("active");
}));

$("#openSettings").addEventListener("click", () => $("#settingsPanel").scrollIntoView({ behavior: "smooth" }));
$("#navSettings").addEventListener("click", () => $("#settingsPanel").scrollIntoView({ behavior: "smooth" }));
$("#closeSettings").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
$("#connectSheet").addEventListener("click", async () => { setStatus("Loading spreadsheet…"); try { await fetchSheet(); try { await syncToBackend(); } catch (backendError) { setStatus(`Loaded sheet data. ${backendError.message}`, true); } startRefresh(); if (state.backendAvailable) setStatus(`Loaded and saved ${state.rankings.length} players and ${state.matches.length} matches.`); } catch (error) { setStatus(error.message, true); } });
$("#refreshNow").addEventListener("click", async () => { setStatus("Refreshing…"); try { if (state.source === "sheet") { await fetchSheet(); try { await syncToBackend(); } catch (backendError) { setStatus(`Sheet refreshed. ${backendError.message}`, true); return; } } else if (state.source === "backend") await fetchBackendRecords(); else render(); setStatus("Data refreshed."); } catch (error) { setStatus(error.message, true); } });
$("#saveBackend").addEventListener("click", async () => { setStatus("Saving current data…"); try { await syncToBackend(); setStatus(`Saved ${state.rows.length} spreadsheet rows to the persistent database.`); } catch (error) { setStatus(error.message, true); $("#backendStatus").textContent = "Backend unavailable — add the Vercel environment variables."; $("#backendStatus").className = "error"; } });
$("#csvFile").addEventListener("change", event => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { loadText(reader.result, "csv"); setStatus(`Loaded ${state.rankings.length} players and ${state.matches.length} matches from CSV.`); } catch (error) { setStatus(error.message, true); } }; reader.readAsText(file); });
$("#useCsv").addEventListener("click", () => { try { loadText($("#csvText").value, "csv"); setStatus(`Loaded ${state.rankings.length} players and ${state.matches.length} matches.`); } catch (error) { setStatus(error.message, true); } });
$("#refreshRate").addEventListener("change", startRefresh);

const savedUrl = localStorage.getItem("tennisRankSheetUrl");
const savedRate = localStorage.getItem("tennisRankRefreshRate");
if (savedUrl) { $("#sheetUrl").value = savedUrl; state.sourceUrl = savedUrl; }
if (savedRate) $("#refreshRate").value = savedRate;
const savedBackendToken = sessionStorage.getItem("tennisRankBackendToken");
if (savedBackendToken) $("#backendToken").value = savedBackendToken;
$("#csvText").value = SAMPLE_CSV;
loadText(SAMPLE_CSV, "sample");
if (savedUrl) setStatus("Saved Google Sheet found. Connect it to load current results.");
fetchBackendRecords().then(() => { startRefresh(); if (!savedUrl) setStatus("Loaded the latest saved data from the backend."); }).catch(() => {
  $("#backendStatus").textContent = "Not configured — the app is using sample/local data.";
  $("#backendStatus").className = "error";
});
