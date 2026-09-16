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
      if (body.action === 'preview') return route.fulfill(ok({ previewHash: 'qa-hash', rowCount: body.rows.length, warnings: [] }));
      savedRows.splice(0, savedRows.length, ...(Array.isArray(body.rows) ? body.rows : []));
      return route.fulfill(ok({ saved: savedRows.length }));
    }
    if (path === '/api/ai-analyze-sheet' && request.method() === 'POST') {
      const body = bodyOf(request);
      const keys = Object.keys(body.rows?.[0] || {});
      const mappingByKey = {
        'Field A': 'name',
        'Field B': 'opponent',
        Decision: 'result',
        Numbers: 'score',
        Team: 'gender',
        'Match Type': 'division',
      };
      const mappings = keys
        .filter(key => !key.startsWith('__') && mappingByKey[key])
        .map(key => ({ inputKey: key, target: mappingByKey[key], confidence: 0.99, reason: 'QA Google AI schema verification' }));
      return route.fulfill(ok({
        model: 'gemini-qa',
        privacy: { redactedBeforeProvider: true, providerStorageDisabled: true },
        ai: {
          supported: true,
          sheetKind: 'match_log',
          confidence: 0.99,
          globalGender: 'unknown',
          globalDivision: 'unknown',
          mappings,
          warnings: [],
        },
      }));
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

test('CSV import updates visible rankings and the official boys/girls ladder without a reload', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const state = await installImportSyncMocks(page);
  await openCsvImport(page);

  const csv = [
    'Name,Opponent,Result,Score,Gender,Division',
    'Noah Williams,Ethan Kim,W,6-3,Boys,Singles',
    'Ava Patel,Mia Rodriguez,W,6-4,Girls,Singles',
  ].join('\n');

  await page.locator('#csvText').fill(csv);
  await page.locator('#useCsv').click();

  await expect(page.locator('#importPreviewModal')).toBeVisible();
  expect(state.savedRows).toHaveLength(0);
  await page.locator('[data-preview-confirm]').click();
  await expect.poll(() => state.savedRows.length).toBe(2);
  await expect.poll(() => state.seedBodies.length).toBe(2);

  const boysSeed = state.seedBodies.find(body => body.teamGender === 'boys');
  const girlsSeed = state.seedBodies.find(body => body.teamGender === 'girls');
  expect(boysSeed).toBeTruthy();
  expect(girlsSeed).toBeTruthy();
  expect(boysSeed.players.map(player => player.name)).toEqual(['Noah Williams', 'Ethan Kim']);
  expect(girlsSeed.players.map(player => player.name)).toEqual(['Ava Patel', 'Mia Rodriguez']);

  await expect(page.locator('#rankingTable')).toContainText('Noah Williams');
  await expect(page.locator('#rankingTable')).toContainText('Ethan Kim');
  await expect(page.locator('#rankingTable')).toContainText('Ava Patel');
  await expect(page.locator('#rankingTable')).toContainText('Mia Rodriguez');

  await expect(page.locator('#ladderBoardNote')).toContainText(/Official coach-managed singles ladder/i);
  await expect.poll(() => ladderNames(page)).toEqual(boysSeed.players.map(player => player.name));

  await page.locator('[data-ladder-team="girls"]').click();
  await expect(page.locator('#ladderBoardTitle')).toHaveText('Girls Singles');
  await expect.poll(() => ladderNames(page)).toEqual(girlsSeed.players.map(player => player.name));

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

  await expect(page.locator('#importPreviewModal')).toBeVisible();
  expect(state.savedRows).toHaveLength(0);
  await page.locator('[data-preview-confirm]').click();
  await expect.poll(() => state.savedRows.length).toBe(2);
  await expect.poll(() => state.seedBodies.length).toBe(1);
  const boysSeed = state.seedBodies[0];
  expect(boysSeed.teamGender).toBe('boys');
  expect(boysSeed.players.map(player => player.name).sort()).toEqual(['Cameron Shah', 'Jordan Lee']);

  await expect(page.locator('#rankingTable')).toContainText('Jordan Lee');
  await expect(page.locator('#rankingTable')).toContainText('Cameron Shah');
  await expect(page.locator('#ladderBoardNote')).toContainText(/Official coach-managed singles ladder/i);
  await expect.poll(() => ladderNames(page)).toEqual(boysSeed.players.map(player => player.name));
});

test('opaque coach columns are understood safely end to end', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const state = await installImportSyncMocks(page);
  await openCsvImport(page);

  await expect.poll(() => page.evaluate(() => Boolean(
    window.TennisRankUniversalImport && window.TennisRankImportV2?.__universalRelationalImport,
  ))).toBe(true);

  // The local relational parser may now resolve this layout without provider help.
  // If it cannot, the AI verifier is available. The invariant we care about is
  // that the exact match relationships are correct and certainty clears 85% before
  // the coach can publish.
  const csv = [
    'Field A,Field B,Decision,Numbers,Team,Match Type',
    'Noah Williams,Ethan Kim,W,6-3,Boys,Singles',
    'Noah Williams,Liam Chen,L,4-6,Boys,Singles',
  ].join('\n');

  await page.locator('#csvText').fill(csv);
  await page.locator('#useCsv').click();
  await expect(page.locator('#importPreviewModal')).toBeVisible();
  await page.locator('[data-preview-confirm]').click();

  await expect.poll(() => state.savedRows.length).toBe(2);
  expect(state.savedRows.every(row => row.winner && row.loser)).toBe(true);
  expect(state.savedRows.map(row => [row.winner, row.loser])).toEqual([
    ['Noah Williams', 'Ethan Kim'],
    ['Liam Chen', 'Noah Williams'],
  ]);
  expect(state.savedRows.every(row => String(row.gender).toLowerCase() === 'boys')).toBe(true);
  expect(state.savedRows.every(row => String(row.division).toLowerCase() === 'singles')).toBe(true);

  await expect(page.locator('#rankingTable')).toContainText('Noah Williams');
  await expect(page.locator('#rankingTable')).toContainText('Ethan Kim');
  await expect(page.locator('#rankingTable')).toContainText('Liam Chen');
  await expect(page.locator('#matchesList')).toContainText('6-3');
  await expect(page.locator('#matchesList')).toContainText('4-6');
  await expect(page.locator('[data-certainty-value]')).toHaveText(/^(?:8[5-9]|9\d|100)%$/);
  await expect(page.locator('[data-certainty-note]')).toContainText(/(?:Google AI verified|Local parser verified)/i);
  await expect.poll(() => state.seedBodies.length).toBe(1);
  expect(state.seedBodies[0].players.map(player => player.name).sort()).toEqual(['Ethan Kim', 'Liam Chen', 'Noah Williams']);
  expect(pageErrors).toEqual([]);
});