const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/qa-ai-index.html';

function bodyOf(request) {
  try { return request.postDataJSON() || {}; }
  catch { return {}; }
}

async function installMocks(page, { role = 'admin', playerName = null, rows = [] } = {}) {
  const profile = {
    id: `profile-${role}`,
    email: `${role}@example.test`,
    full_name: role === 'admin' ? 'Coach QA' : playerName || 'Player QA',
    player_name: playerName,
    role,
    must_change_password: false,
  };
  const savedRows = [...rows];
  const seedBodies = [];

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
      if (body.action === 'preview') return route.fulfill(ok({ previewHash: 'doubles-mixed-hash', rowCount: body.rows.length, warnings: [] }));
      savedRows.splice(0, savedRows.length, ...(Array.isArray(body.rows) ? body.rows : []));
      return route.fulfill(ok({ saved: savedRows.length }));
    }
    if (path === '/api/admin/seed-ladder' && request.method() === 'POST') {
      seedBodies.push(bodyOf(request));
      return route.fulfill(ok({ seeded: 0 }, 201));
    }
    if (path === '/api/ladder') return route.fulfill(ok({
      ladder: [],
      settings: [
        { team_gender: 'boys', max_challenge_distance: 3 },
        { team_gender: 'girls', max_challenge_distance: 3 },
      ],
      viewer: { profileId: profile.id, role: profile.role, playerName: profile.player_name },
    }));
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled QA route ${path}` }) });
  });

  return { profile, savedRows, seedBodies };
}

async function openAdminCsv(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await page.locator('#openSettings').click();
  await page.locator('#tabCsv').click();
  await expect(page.locator('#csvSource')).toBeVisible();
}

test('section context keeps doubles across Boys/Girls and treats standalone Mixed as doubles', async ({ page }) => {
  await installMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();

  const prepared = await page.evaluate(() => window.prepareRows([
    { name: 'Doubles' },
    { name: 'Boys' },
    { winner: 'Noah & Ethan', loser: 'Liam & Jack', result: 'W' },
    { name: 'Singles' },
    { name: 'Mixed' },
    { winner: 'Ravi / Olivia', loser: 'Ben / Sophia', result: 'W' },
  ]));

  expect(prepared[2].__contextGender).toBe('boys');
  expect(prepared[2].__contextDivision).toBe('doubles');
  expect(prepared[5].__contextGender).toBe('mixed');
  expect(prepared[5].__contextDivision).toBe('doubles');
});

test('coach can import boys, girls and mixed doubles together without polluting the singles ladder', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const state = await installMocks(page);
  await openAdminCsv(page);

  const csv = [
    'Winner,Loser,Score,Gender,Division,Date',
    'Noah Williams & Ethan Kim,Liam Chen & Jack Park,6-3,Boys,Doubles,2026-09-14',
    'Ava Patel + Mia Rodriguez,Zoe Lee + Emma Wilson,6-4,Girls,Doubles,2026-09-14',
    'Ravi Shah / Olivia Brown,Ben Kim / Sophia Lee,7-5,,MXD,2026-09-14',
  ].join('\n');

  await page.locator('#csvText').fill(csv);
  await page.locator('#useCsv').click();
  await expect(page.locator('#importPreviewModal')).toBeVisible();
  await page.locator('[data-preview-confirm]').click();
  await expect.poll(() => state.savedRows.length).toBe(3);

  await expect(page.locator('#rankingTable')).toContainText('Ethan Kim & Noah Williams');
  await expect(page.locator('#rankingTable')).toContainText('Ava Patel & Mia Rodriguez');
  await expect(page.locator('#rankingTable')).toContainText('Olivia Brown & Ravi Shah');
  await expect(page.locator('#matchesList')).toContainText('7-5');
  await expect(page.locator('[data-gender="mixed"]')).toBeVisible();
  await expect(page.locator('#rankingsGrid')).toContainText('Mixed doubles');

  await page.locator('[data-gender="mixed"]').click();
  await expect(page.locator('#rankingTable')).toContainText('Olivia Brown & Ravi Shah');
  await expect(page.locator('#rankingTable')).not.toContainText('Ethan Kim & Noah Williams');
  await expect(page.locator('#matchesList')).toContainText(/mixed doubles/i);

  await page.locator('[data-gender="all"]').click();
  await page.locator('[data-division="doubles"]').click();
  await expect(page.locator('#rankingTable')).toContainText('Ethan Kim & Noah Williams');
  await expect(page.locator('#rankingTable')).toContainText('Ava Patel & Mia Rodriguez');
  await expect(page.locator('#rankingTable')).toContainText('Olivia Brown & Ravi Shah');

  // The challenge ladder is singles-only. Importing doubles must not seed pair
  // names into the official boys/girls singles ladder.
  expect(state.seedBodies).toHaveLength(0);
  expect(pageErrors).toEqual([]);
});

test('player dashboard recognizes a player inside a mixed-doubles pair', async ({ page }) => {
  const rows = [
    { winner: 'Ravi Shah / Olivia Brown', loser: 'Ben Kim / Sophia Lee', score: '7-5', gender: 'Mixed', division: 'Mixed Doubles', date: '2026-09-14' },
    { winner: 'Ben Kim / Sophia Lee', loser: 'Ravi Shah / Olivia Brown', score: '6-4', gender: 'Mixed', division: 'Mixed Doubles', date: '2026-09-13' },
  ];
  await installMocks(page, { role: 'player', playerName: 'Olivia Brown', rows });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#playerDashboard')).toBeVisible();
  await expect(page.locator('#playerDashboardTitle')).toContainText('Olivia Brown');
  await expect(page.locator('#playerStatGrid')).toContainText('1-1');
  await expect(page.locator('#playerStatGrid')).toContainText('doubles');
  await expect(page.locator('#playerMatchList')).toContainText('Ben Kim & Sophia Lee');
  await expect(page.locator('#playerMatchList')).toContainText('7-5');
  await expect(page.locator('#playerMatchList')).toContainText('6-4');
});
