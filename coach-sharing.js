(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TennisRankCoachSharing = api;
    if (root.document) api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) { return String(value == null ? "" : value).replace(/\s+/g, " ").trim(); }
  function escapeHtml(value) { return clean(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  function identity(value) { return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function parts(value) { return clean(value).split(/\s+(?:&|and|\+|\/|vs\.?|versus)\s+/i).map(identity).filter(Boolean); }
  function belongs(value, playerName) { const target = identity(playerName); return Boolean(target && (identity(value) === target || parts(value).includes(target))); }
  function boardTitle(gender, division) {
    const g = gender === "girls" ? "Girls" : gender === "boys" ? "Boys" : "All";
    const d = division === "doubles" ? "Doubles" : division === "singles" ? "Singles" : "Singles + Doubles";
    return `${g} ${d}`;
  }
  function filterRankings(rankings, gender = "all", division = "all") {
    return (Array.isArray(rankings) ? rankings : []).filter(item => (gender === "all" || item.gender === gender) && (division === "all" || item.division === division));
  }
  function rankedRows(rankings) {
    const groups = new Map();
    for (const item of Array.isArray(rankings) ? rankings : []) {
      const key = `${item.gender}|${item.division}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const result = [];
    for (const [key, items] of groups) {
      const [gender, division] = key.split("|");
      items.forEach((item, index) => result.push({ ...item, rank: index + 1, gender, division }));
    }
    return result;
  }
  function rankingsText(rankings, options = {}) {
    const rows = rankedRows(filterRankings(rankings, options.gender || "all", options.division || "all"));
    const title = `RIHS ${boardTitle(options.gender || "all", options.division || "all")} Tennis Rankings`;
    const grouped = new Map();
    for (const row of rows) {
      const key = `${row.gender}|${row.division}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    const sections = [...grouped.entries()].map(([key, items]) => {
      const [gender, division] = key.split("|");
      return [`${boardTitle(gender, division)}`, ...items.map(item => `${item.rank}. ${clean(item.name)} — ${Number(item.wins || 0)}-${Number(item.losses || 0)}`)].join("\n");
    });
    const date = options.date || new Date();
    const stamp = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
    return `${title}\n\n${sections.join("\n\n")}\n\nUpdated ${stamp}`;
  }
  function csvCell(value) { const s = String(value ?? ""); return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s; }
  function rankingsCsv(rankings, options = {}) {
    const rows = rankedRows(filterRankings(rankings, options.gender || "all", options.division || "all"));
    return [["Rank","Player / Team","Gender","Type","Wins","Losses","Win Rate"], ...rows.map(item => [item.rank,item.name,item.gender,item.division,Number(item.wins||0),Number(item.losses||0),`${Math.round(Number(item.winRate||0)*100)}%`])].map(row => row.map(csvCell).join(",")).join("\n");
  }
  function importedSnapshot(matches, playerName) {
    const linked = (Array.isArray(matches) ? matches : []).filter(match => belongs(match.winner, playerName) || belongs(match.loser, playerName)).sort((a,b) => String(b.date || "").localeCompare(String(a.date || "")));
    const wins = linked.filter(match => belongs(match.winner, playerName)).length;
    const losses = linked.length - wins;
    return { wins, losses, last: linked.slice(0,5).map(match => ({ result: belongs(match.winner, playerName) ? "W" : "L", opponent: belongs(match.winner, playerName) ? clean(match.loser) : clean(match.winner), score: clean(match.score), date: clean(match.date) })) };
  }

  function installBrowser(win) {
    if (!win || win.__tennisrankCoachSharingInstalled) return;
    win.__tennisrankCoachSharingInstalled = true;
    let calculated = null;
    let coachData = null;

    async function request(url) {
      const response = await win.TennisRankAuth.fetch(url);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
      return payload;
    }
    async function loadCalculated(force = false) {
      if (calculated && !force) return calculated;
      const payload = await request("/api/records");
      calculated = typeof win.calculateRankings === "function" ? win.calculateRankings(payload.rows || []) : { rankings: [], matches: [] };
      return calculated;
    }
    function currentFilters() {
      return {
        gender: win.document.querySelector('.filter-chip.active[data-gender]')?.dataset.gender || "all",
        division: win.document.querySelector('.filter-chip.active[data-division]')?.dataset.division || "all",
      };
    }
    function toast(message) {
      let node = win.document.querySelector("#rankingShareToast");
      if (!node) { node = win.document.createElement("div"); node.id = "rankingShareToast"; node.className = "ranking-share-toast"; node.setAttribute("role","status"); win.document.body.appendChild(node); }
      node.textContent = message; node.classList.add("show"); clearTimeout(node.__timer); node.__timer = setTimeout(() => node.classList.remove("show"), 2200);
    }
    async function copyText(text) {
      if (win.navigator.clipboard?.writeText) return win.navigator.clipboard.writeText(text);
      const area = win.document.createElement("textarea"); area.value = text; area.style.position = "fixed"; area.style.opacity = "0"; win.document.body.appendChild(area); area.select(); win.document.execCommand("copy"); area.remove();
    }
    function ensureShareControls() {
      if (win.document.querySelector("#rankingShareControls")) return;
      const heading = win.document.querySelector("#rankingsSection");
      if (!heading) return;
      const controls = win.document.createElement("div");
      controls.id = "rankingShareControls";
      controls.className = "ranking-share-controls admin-only";
      controls.innerHTML = `<button type="button" class="secondary-button" data-share-rankings="copy"><i class="ph ph-copy"></i><span>Copy rankings</span></button><button type="button" class="secondary-button" data-share-rankings="csv"><i class="ph ph-download-simple"></i><span>CSV</span></button><button type="button" class="secondary-button" data-share-rankings="print"><i class="ph ph-printer"></i><span>Print</span></button>`;
      heading.appendChild(controls);
      controls.addEventListener("click", async event => {
        const button = event.target.closest("[data-share-rankings]"); if (!button) return;
        const data = await loadCalculated(); const filters = currentFilters(); const action = button.dataset.shareRankings;
        if (action === "copy") { await copyText(rankingsText(data.rankings, filters)); toast("Rankings copied — ready for the team chat."); }
        if (action === "csv") {
          const blob = new Blob([rankingsCsv(data.rankings, filters)], { type:"text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = win.document.createElement("a"); a.href=url; a.download=`rihs-tennis-${filters.gender}-${filters.division}-rankings.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast("CSV downloaded.");
        }
        if (action === "print") {
          const text = rankingsText(data.rankings, filters); const popup = win.open("", "_blank", "noopener,noreferrer,width=860,height=900"); if (!popup) { toast("Allow pop-ups to open the print view."); return; }
          popup.document.write(`<!doctype html><meta charset="utf-8"><title>RIHS Tennis Rankings</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:48px auto;color:#111;white-space:pre-wrap;line-height:1.55}h1{font-size:28px} @media print{body{margin:24px}}</style><h1>RIHS Tennis Rankings</h1><div>${escapeHtml(text).replaceAll("\n","<br>")}</div><script>window.onload=()=>window.print()<\/script>`); popup.document.close();
        }
      });
    }
    function ensureSnapshotModal() {
      let modal = win.document.querySelector("#coachPlayerSnapshotModal");
      if (modal) return modal;
      modal = win.document.createElement("div"); modal.id="coachPlayerSnapshotModal"; modal.className="coach-modal-shell player-snapshot-modal"; modal.hidden=true;
      modal.innerHTML=`<div class="coach-modal-backdrop" data-player-close></div><section class="coach-modal" role="dialog" aria-modal="true" aria-labelledby="coachPlayerSnapshotTitle"><div class="coach-modal-head"><div><p class="eyebrow">Player snapshot</p><h2 id="coachPlayerSnapshotTitle">Season view</h2></div><button class="close-button" type="button" data-player-close>×</button></div><div id="coachPlayerSnapshotBody"></div></section>`;
      win.document.body.appendChild(modal); modal.addEventListener("click", e => { if (e.target.closest("[data-player-close]")) { modal.hidden=true; win.document.body.classList.remove("coach-modal-open"); } }); return modal;
    }
    function snapshotCard(snapshot) {
      return `<button type="button" class="coach-player-snapshot-card" data-player-snapshot="${escapeHtml(snapshot.id)}"><span class="snapshot-rank">${snapshot.currentRank ? `#${snapshot.currentRank}` : "—"}</span><span><b>${escapeHtml(snapshot.name)}</b><small>${snapshot.teamGender === "girls" ? "Girls" : "Boys"} · ${snapshot.division === "jv" ? "JV" : "Varsity"}${snapshot.gradeLevel ? ` · Grade ${snapshot.gradeLevel}` : ""}</small></span><i class="ph ph-caret-right"></i></button>`;
    }
    async function openSnapshot(id) {
      const snapshot = (coachData?.playerSnapshots || []).find(item => item.id === id); if (!snapshot) return;
      const data = await loadCalculated(); const imported = importedSnapshot(data.matches, snapshot.name); const modal = ensureSnapshotModal();
      const trend = win.TennisRankPlayerInsights?.deriveRankTrend(snapshot.rankHistory || [], snapshot.currentRank) || { points:[], seasonStartRank:snapshot.seasonStartRank, bestRank:snapshot.bestRank, movement:snapshot.movement };
      const graph = win.TennisRankPlayerInsights?.chartMarkup?.(trend.points) || ""; const move = snapshot.movement > 0 ? `↑ ${snapshot.movement}` : snapshot.movement < 0 ? `↓ ${Math.abs(snapshot.movement)}` : "—";
      modal.querySelector("#coachPlayerSnapshotTitle").textContent=snapshot.name;
      modal.querySelector("#coachPlayerSnapshotBody").innerHTML=`<div class="snapshot-hero"><div><span>Official rank</span><strong>${snapshot.currentRank ? `#${snapshot.currentRank}` : "—"}</strong><small>${escapeHtml(snapshot.status || "available")}</small></div><div class="snapshot-mini"><span><b>${snapshot.bestRank ? `#${snapshot.bestRank}` : "—"}</b><small>Best</small></span><span><b>${snapshot.seasonStartRank ? `#${snapshot.seasonStartRank}` : "—"}</b><small>Season start</small></span><span><b>${move}</b><small>Movement</small></span></div></div>${graph}<div class="snapshot-record-grid"><article><span>Imported record</span><strong>${imported.wins}-${imported.losses}</strong><small>${imported.last.length ? `${imported.last.filter(x=>x.result==='W').length}-${imported.last.filter(x=>x.result==='L').length} over last ${imported.last.length}` : "No linked results"}</small></article><article><span>Official challenges</span><strong>${snapshot.officialChallengeRecord?.wins || 0}-${snapshot.officialChallengeRecord?.losses || 0}</strong><small>Verified ladder matches</small></article></div><div class="snapshot-form"><span>Last 5</span><div>${imported.last.length ? imported.last.map(item=>`<span class="form-chip ${item.result==='W'?'win':'loss'}" title="${escapeHtml(item.opponent)}">${item.result}</span>`).join("") : "No recent results"}</div></div><div class="snapshot-history">${(snapshot.rankHistory||[]).slice(-5).reverse().map(item=>`<div><i class="ph ph-trend-up"></i><span><b>${escapeHtml(win.TennisRankPlayerInsights?.reasonLabel?.(item.reason) || item.reason || "Rank update")}</b><small>#${escapeHtml(item.oldRank)} → #${escapeHtml(item.newRank)}</small></span></div>`).join("") || `<div><i class="ph ph-flag"></i><span><b>Season baseline</b><small>No official rank moves yet.</small></span></div>`}</div>`;
      modal.hidden=false; win.document.body.classList.add("coach-modal-open");
    }
    function renderPlayerDirectory() {
      if (win.TennisRankAuth?.getProfile?.()?.role !== "admin" || !coachData) return;
      let section = win.document.querySelector("#coachPlayerInsights");
      if (!section) { section=win.document.createElement("section"); section.id="coachPlayerInsights"; section.className="coach-player-insights admin-only"; win.document.querySelector("#coachOpsDashboard")?.insertAdjacentElement("afterend",section); }
      const snapshots=coachData.playerSnapshots||[]; const boys=snapshots.filter(x=>x.teamGender==='boys'); const girls=snapshots.filter(x=>x.teamGender==='girls');
      section.innerHTML=`<div class="section-heading"><div><p class="eyebrow">Player intelligence</p><h2>Season snapshots</h2></div><span class="record-note">Click a player for rank history + form</span></div><div class="snapshot-team-grid"><article><div class="snapshot-team-head"><h3>Boys ladder</h3><span>${boys.length} active</span></div><div class="snapshot-player-list">${boys.map(snapshotCard).join("") || '<p class="coach-empty">No active boys players.</p>'}</div></article><article><div class="snapshot-team-head"><h3>Girls ladder</h3><span>${girls.length} active</span></div><div class="snapshot-player-list">${girls.map(snapshotCard).join("") || '<p class="coach-empty">No active girls players.</p>'}</div></article></div>`;
      section.onclick=e=>{ const button=e.target.closest("[data-player-snapshot]"); if(button) openSnapshot(button.dataset.playerSnapshot); };
    }
    async function refresh(force=false) {
      ensureShareControls();
      if (win.TennisRankAuth?.getProfile?.()?.role !== "admin") return;
      try { coachData=await request("/api/ladder?mode=coach"); await loadCalculated(force); renderPlayerDirectory(); } catch (_) {}
    }
    win.addEventListener("tennisrank:auth-ready",()=>refresh());
    win.addEventListener("tennisrank:coach-data-changed",()=>refresh(true));
    win.addEventListener("tennisrank:import-synced",()=>refresh(true));
    win.addEventListener("tennisrank:ladder-rendered",()=>ensureShareControls());
    if(win.document.readyState!=="loading") refresh(); else win.document.addEventListener("DOMContentLoaded",()=>refresh(),{once:true});
  }

  return { identity, belongs, boardTitle, filterRankings, rankedRows, rankingsText, rankingsCsv, importedSnapshot, installBrowser };
});
