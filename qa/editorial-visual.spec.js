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


for(const width of [320,1440]) test(`editorial layout ${width}`,async({page})=>{
 await page.setViewportSize({width,height:950});await page.emulateMedia({reducedMotion:'reduce'});
 await installImportSyncMocks(page);await page.goto(BASE);await expect(page.locator('#appShell')).toBeVisible();
 await expect(page.locator('.hero-content h1')).toContainText('One board.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await page.locator('.court-orbits span').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.screenshot({path:`/tmp/tennis-editorial-${width}.png`});
 await page.locator('.team-gallery summary').click();await expect(page.locator('.team-gallery .story-rail')).toBeVisible();
});
