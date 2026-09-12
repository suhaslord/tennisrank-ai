const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/qa-ai-index.html';

function bodyOf(request) {
  try { return request.postDataJSON() || {}; }
  catch { return {}; }
}

function settings() {
  return [
    { team_gender: 'boys', max_challenge_distance: 3 },
    { team_gender: 'girls', max_challenge_distance: 3 },
  ];
}

async function installImportSyncMocks(page) {
  const profile = {
    id: 'profile-admin',
    email: 'coach@example.test',
    full_name: 'Coach QA',
    player_name: null,
    role: 'admin',
    must_change_password: false,
  };
  const official = { boys: [], girls: [] };
  const seedBodies = [];
  const savedRows = [];

  await page.addInitScript(({ profile }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify({
      access_token: 'qa-access-token',
      refresh_token: 'qa-refresh-token',
      expires_at: now + 3600,
      user: { id: profile.id, email: profile.email },
    }));
  }, { profile });

  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX = window.XLSX || {};' }));

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = (value, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(value) });

    if (path === '/api/config') return route.fulfill(ok({ supabaseUrl: 'https://fake.supabase.test', publishableKey: 'qa-public-key' }));
    if (path === '/api/session') return route.fulfill(ok({ profile }));
    if (path === '/api/users') return route.fulfill(ok({ profiles: [] }));
    if (path === '/api/challenges') return route.fulfill(ok({ challenges: [] }));
    if (path === '/api/records' && request.method() === 'GET') return route.fulfill(ok({ rows: savedRows, count: savedRows.length, snapshots: [] }));
    if (path === '/api/records' && request.method() === 'POST') {
      const body = bodyOf(request);
      if (body.action === 'preview') return route.fulfill(ok({previewHash:'qa-hash',rowCount:body.rows.length,warnings:[]}));
      savedRows.splice(0, savedRows.length, ...(Array.isArray(body.rows) ? body.rows : []));
      return route.fulfill(ok({ saved: savedRows.length }));
    }
    if (path === '/api/ai-analyze-sheet' && request.method() === 'POST') {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'AI verifier unavailable in deterministic sync QA.' }) });
    }
    if (path === '/api/admin/seed-ladder' && request.method() === 'POST') {
      const body = bodyOf(request);
      seedBodies.push(body);
      const team = body.teamGender;
      official[team] = (body.players || []).map((player, index) => ({
        player_id: `${team}-${index + 1}`,
        team_gender: team,
        rank_position: index + 1,
        previous_rank_position: index + 1,
        status: 'available',
        player: {
          id: `${team}-${index + 1}`,
          profile_id: null,
          display_name: player.name,
          team_gender: team,
          division: 'varsity',
          active_status: 'active',
        },
      }));
      return route.fulfill(ok({ seeded: official[team].length, teamGender: team }, 201));
    }
    if (path === '/api/ladder') {
      return route.fulfill(ok({
        ladder: [...official.boys, ...official.girls],
        settings: settings(),
        viewer: { profileId: profile.id, role: 'admin', playerName: null },
      }));
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled QA route ${path}` }) });
  });

  return { seedBodies, savedRows, official };
}

async function openCsvImport(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await page.locator('#openSettings').click();
  await expect(page.locator('#settingsPanel')).toBeVisible();
  await page.locator('#tabCsv').click();
  await expect(page.locator('#csvSource')).toBeVisible();
}

async function ladderNames(page) {
  return page.locator('#ladderList .ladder-player-name').allTextContents();
}


const csv='Name,Opponent,Result,Gender,Division\nTest Alpha,Test Beta,W,Boys,Singles';
for(const stage of ['preview','publish']) test(`${stage} failure restores empty board and retry succeeds`,async({page})=>{
 const state=await installImportSyncMocks(page);let fail=true;
 await page.route('**/api/records',async route=>{
  if(route.request().method()==='POST' && bodyOf(route.request()).action===stage && fail) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary test failure'})});
  return route.fallback();
 });
 await openCsvImport(page);
 await page.locator('#csvText').fill(csv);await page.locator('#useCsv').click();
 if(stage==='publish') {await expect(page.locator('#importPreviewModal')).toBeVisible();await page.locator('[data-preview-confirm]').click();}
 await expect(page.locator('#statusMessage')).toContainText('Temporary test failure');
 await expect(page.locator('#rankingTable')).toContainText('No ranking data');expect(state.savedRows).toHaveLength(0);
 fail=false;await page.locator('#csvText').fill(csv);await page.locator('#useCsv').click();
 await expect(page.locator('#importPreviewModal')).toBeVisible();await page.locator('[data-preview-confirm]').click();
 await expect.poll(()=>state.savedRows.length).toBe(1);await expect(page.locator('#rankingTable')).toContainText('Test Alpha');
});
test('cancelled import cannot be resurrected by Save current data',async({page})=>{
 const state=await installImportSyncMocks(page);await openCsvImport(page);
 await page.locator('#csvText').fill(csv);await page.locator('#useCsv').click();
 await expect(page.locator('#importPreviewModal')).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.locator('#statusMessage')).toContainText('cancelled');
 await page.getByRole('button',{name:'Save current data',exact:true}).click();
 await expect(page.locator('#importPreviewModal')).toBeHidden();expect(state.savedRows).toHaveLength(0);
 await expect(page.locator('#rankingTable')).toContainText('No ranking data');
});
test('zero usable rankings cannot reach publish confirmation',async({page})=>{
 const state=await installImportSyncMocks(page);await openCsvImport(page);
 await page.locator('#csvText').fill('Name,Gender,Division\nTest Alpha,Girls,Doubles');await page.locator('#useCsv').click();
 await expect(page.locator('#statusMessage')).toContainText('No usable tennis');
 await expect(page.locator('#importPreviewModal')).toBeHidden();expect(state.savedRows).toHaveLength(0);
});
