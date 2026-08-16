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
    if (path === '/api/records' && request.method() === 'GET') return route.fulfill(ok({ rows: [], count: 0 }));
    if (path === '/api/records' && request.method() === 'POST') {
      const body = bodyOf(request);
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

test('CSV import updates visible rankings and the official boys/girls ladder without a reload', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const state = await installImportSyncMocks(page);
  await openCsvImport(page);

  const csv = [
    'Gender,Division,Player 1,Player 2,Winner,Loser,Score,Date',
    'Boys,Singles,Noah Williams,Ethan Kim,Noah Williams,Ethan Kim,6-3,2026-08-15',
    'Girls,Singles,Ava Patel,Mia Rodriguez,Ava Patel,Mia Rodriguez,6-4,2026-08-15',
  ].join('\n');

  await page.locator('#csvText').fill(csv);
  await page.locator('#useCsv').click();

  await expect.poll(() => state.savedRows.length).toBe(2);
  await expect.poll(() => state.seedBodies.length).toBe(2);

  expect(state.seedBodies[0].teamGender).toBe('boys');
  expect(state.seedBodies[0].players.map(player => player.name)).toEqual(['Noah Williams', 'Ethan Kim']);
  expect(state.seedBodies[1].teamGender).toBe('girls');
  expect(state.seedBodies[1].players.map(player => player.name)).toEqual(['Ava Patel', 'Mia Rodriguez']);

  // Main ranking surfaces refresh from the same imported rows.
  await expect(page.locator('#rankingTable')).toContainText('Noah Williams');
  await expect(page.locator('#rankingTable')).toContainText('Ethan Kim');
  await expect(page.locator('#rankingTable')).toContainText('Ava Patel');
  await expect(page.locator('#rankingTable')).toContainText('Mia Rodriguez');

  // The separate official ladder must also switch from preview data to the API-backed board.
  await expect(page.locator('#ladderBoardNote')).toContainText('Official coach-managed ladder');
  await expect(page.locator('#ladderList .ladder-player-name').nth(0)).toHaveText('Noah Williams');
  await expect(page.locator('#ladderList .ladder-player-name').nth(1)).toHaveText('Ethan Kim');

  await page.locator('[data-ladder-team="girls"]').click();
  await expect(page.locator('#ladderBoardTitle')).toHaveText('Girls singles');
  await expect(page.locator('#ladderList .ladder-player-name').nth(0)).toHaveText('Ava Patel');
  await expect(page.locator('#ladderList .ladder-player-name').nth(1)).toHaveText('Mia Rodriguez');

  await expect(page.locator('#statusMessage')).toContainText(/saved|local parser|AI temporarily unavailable/i);
  expect(pageErrors).toEqual([]);
});

test('selected CSV file follows the same automatic official-board path', async ({ page }) => {
  const state = await installImportSyncMocks(page);
  await openCsvImport(page);

  const csv = [
    'Name,Gender,Division',
    'Jordan Lee,Boys,Singles',
    'Cameron Shah,Boys,Singles',
  ].join('\n');

  await page.locator('#csvFile').setInputFiles({
    name: 'boys-roster.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });

  await expect.poll(() => state.savedRows.length).toBe(2);
  await expect.poll(() => state.seedBodies.length).toBe(1);
  expect(state.seedBodies[0].teamGender).toBe('boys');
  expect(state.seedBodies[0].players.map(player => player.name)).toEqual(['Jordan Lee', 'Cameron Shah']);
  await expect(page.locator('#rankingTable')).toContainText('Jordan Lee');
  await expect(page.locator('#ladderBoardNote')).toContainText('Official coach-managed ladder');
  await expect(page.locator('#ladderList')).toContainText('Jordan Lee');
  await expect(page.locator('#ladderList')).toContainText('Cameron Shah');
});
