const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/qa-ai-index.html';
const COACH_SHEET = 'https://docs.google.com/spreadsheets/d/coach-fixture/edit?usp=sharing#gid=0';
const BOYS_CSV = [
  'Player,Opponent,Won?,Score',
  'a,b,a,6-1',
  'a,c,c,6-2',
  'b,c,b,6-3',
].join('\n');

function bodyOf(request) {
  try { return request.postDataJSON() || {}; }
  catch { return {}; }
}

async function installMocks(page) {
  const profile = {
    id: 'profile-admin',
    email: 'coach@example.test',
    full_name: 'Coach QA',
    player_name: null,
    role: 'admin',
    must_change_password: false,
  };
  const savedRows = [];
  const seedBodies = [];
  const official = { boys: [], girls: [] };
  const requestedPaths = [];

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
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.XLSX={read:function(){return {SheetNames:['BoysS'],Sheets:{BoysS:{__csv:${JSON.stringify(BOYS_CSV)}}}}},utils:{sheet_to_csv:function(sheet){return sheet.__csv||''}}};`,
  }));

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requestedPaths.push(path);
    const ok = (value, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(value) });

    if (path === '/api/config') return route.fulfill(ok({ supabaseUrl: 'https://fake.supabase.test', publishableKey: 'qa-public-key' }));
    if (path === '/api/session') return route.fulfill(ok({ profile }));
    if (path === '/api/users') return route.fulfill(ok({ profiles: [] }));
    if (path === '/api/challenges') return route.fulfill(ok({ challenges: [] }));
    if (path === '/api/sheet-workbook') {
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: Buffer.from('coach-workbook-fixture'),
      });
    }
    if (path === '/api/records' && request.method() === 'GET') return route.fulfill(ok({ rows: savedRows, count: savedRows.length, snapshots: [] }));
    if (path === '/api/records' && request.method() === 'POST') {
      const body = bodyOf(request);
      if (body.action === 'preview') return route.fulfill(ok({ previewHash: 'coach-fixture-hash', rowCount: body.rows.length, warnings: [] }));
      savedRows.splice(0, savedRows.length, ...(Array.isArray(body.rows) ? body.rows : []));
      return route.fulfill(ok({ saved: savedRows.length, snapshotId: 'coach-fixture-snapshot' }));
    }
    if (path === '/api/ai-analyze-sheet' && request.method() === 'POST') {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'AI verifier unavailable in deterministic QA.' }) });
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
        settings: [
          { team_gender: 'boys', max_challenge_distance: 3 },
          { team_gender: 'girls', max_challenge_distance: 3 },
        ],
        viewer: { profileId: profile.id, role: 'admin', playerName: null },
      }));
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled QA route ${path}` }) });
  });

  return { savedRows, seedBodies, requestedPaths };
}

test('coach Google viewer link imports the exact RIHS-TL simple match format end to end', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const state = await installMocks(page);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.TennisRankGoogleWorkbookBridge)).toBe('object');
  await page.locator('#openSettings').click();
  await expect(page.locator('#settingsPanel')).toBeVisible();
  await page.locator('#sheetUrl').fill(COACH_SHEET);
  await page.locator('#connectSheet').click();

  await expect(page.locator('#importPreviewModal')).toBeVisible();
  await expect(page.locator('#importPreviewBody')).toContainText('3');
  await expect(page.locator('#importPreviewBody')).not.toContainText(/winner that does not match/i);
  expect(state.requestedPaths).toContain('/api/sheet-workbook');
  expect(state.requestedPaths).not.toContain('/api/sheet-proxy');
  expect(state.savedRows).toHaveLength(0);

  await page.locator('[data-preview-confirm]').click();
  await expect.poll(() => state.savedRows.length).toBe(3);
  await expect.poll(() => state.seedBodies.length).toBe(1);

  expect(state.savedRows.map(row => ({
    player: row.name,
    opponent: row.opponent,
    winner: row.winner,
    loser: row.loser,
    gender: row.gender,
    division: row.division,
  }))).toEqual([
    { player: 'a', opponent: 'b', winner: 'a', loser: 'b', gender: 'Boys', division: 'Singles' },
    { player: 'a', opponent: 'c', winner: 'c', loser: 'a', gender: 'Boys', division: 'Singles' },
    { player: 'b', opponent: 'c', winner: 'b', loser: 'c', gender: 'Boys', division: 'Singles' },
  ]);

  const boysSeed = state.seedBodies[0];
  expect(boysSeed.teamGender).toBe('boys');
  expect(boysSeed.players.map(player => player.name).sort()).toEqual(['a', 'b', 'c']);
  await expect(page.locator('#rankingTable')).toContainText('a');
  await expect(page.locator('#rankingTable')).toContainText('b');
  await expect(page.locator('#rankingTable')).toContainText('c');
  expect(pageErrors).toEqual([]);
});
