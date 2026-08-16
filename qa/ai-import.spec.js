const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/qa-ai-index.html';

function bodyOf(request) {
  try { return request.postDataJSON() || {}; }
  catch { return {}; }
}

function emptyLadder() {
  return {
    ladder: [],
    settings: [
      { team_gender: 'boys', max_challenge_distance: 3 },
      { team_gender: 'girls', max_challenge_distance: 3 },
    ],
    viewer: { profileId: 'profile-admin', role: 'admin', playerName: null },
  };
}

function inferMappings(rows) {
  const first = rows[0] || {};
  const keys = Object.keys(first).filter(key => !key.startsWith('__'));
  const mappings = [];
  const people = [];
  for (const key of keys) {
    const values = rows.map(row => String(row[key] || '').trim()).filter(Boolean);
    if (values.some(value => /^(?:w|l)$/i.test(value))) mappings.push({ inputKey: key, target: 'result', confidence: 0.99, reason: 'W/L values' });
    else if (values.some(value => /^(?:boys?|girls?)$/i.test(value))) mappings.push({ inputKey: key, target: 'gender', confidence: 0.99, reason: 'team gender values' });
    else if (values.some(value => /^(?:singles?|doubles?)$/i.test(value))) mappings.push({ inputKey: key, target: 'division', confidence: 0.99, reason: 'tennis event values' });
    else if (values.some(value => /^\d{1,2}-\d{1,2}(?:\s+\d{1,2}-\d{1,2})*$/.test(value))) mappings.push({ inputKey: key, target: 'score', confidence: 0.98, reason: 'tennis score values' });
    else if (values.some(value => /^[A-Za-z'.-]+\s+[A-Za-z'.-]+$/.test(value))) people.push(key);
  }
  if (people[0]) mappings.push({ inputKey: people[0], target: 'name', confidence: 0.98, reason: 'row athlete identity' });
  if (people[1]) mappings.push({ inputKey: people[1], target: 'opponent', confidence: 0.98, reason: 'row opponent identity' });
  return mappings;
}

async function installAdminMocks(page) {
  const profile = { id: 'profile-admin', email: 'coach@example.test', full_name: 'Coach QA', player_name: null, role: 'admin', must_change_password: false };
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
    const ok = value => ({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });

    if (path === '/api/config') return route.fulfill(ok({ supabaseUrl: 'https://fake.supabase.test', publishableKey: 'qa-public-key' }));
    if (path === '/api/session') return route.fulfill(ok({ profile }));
    if (path === '/api/users') return route.fulfill(ok({ profiles: [] }));
    if (path === '/api/ladder') return route.fulfill(ok(emptyLadder()));
    if (path === '/api/challenges') return route.fulfill(ok({ challenges: [] }));
    if (path === '/api/records' && request.method() === 'GET') return route.fulfill(ok({ rows: [], count: 0 }));
    if (path === '/api/records' && request.method() === 'POST') {
      const body = bodyOf(request);
      return route.fulfill(ok({ saved: Array.isArray(body.rows) ? body.rows.length : 0 }));
    }
    if (path === '/api/ai-analyze-sheet' && request.method() === 'POST') {
      const body = bodyOf(request);
      return route.fulfill(ok({
        model: 'gemini-2.5-flash-qa',
        privacy: { redactedBeforeProvider: true },
        ai: {
          supported: true,
          sheetKind: 'match_log',
          confidence: 0.99,
          globalGender: 'unknown',
          globalDivision: 'unknown',
          mappings: inferMappings(body.rows || []),
          warnings: [],
        },
      }));
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled QA route ${path}` }) });
  });
}

test('AI schema verification becomes accurate board rows before backend publication', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installAdminMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();

  await page.locator('#openSettings').click();
  await expect(page.locator('#settingsPanel')).toBeVisible();
  await page.locator('#tabCsv').click();
  await expect(page.locator('#csvSource')).toBeVisible();

  const weirdCsv = [
    'Mystery A,Mystery B,Mystery C,Mystery D,Mystery E,Mystery F',
    'Aiden Shah,Leo Kim,W,6-3 6-4,Boys,Singles',
    'Maya Lee,Zoe Rivera,L,4-6 3-6,Girls,Singles',
  ].join('\n');

  const aiRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/ai-analyze-sheet' && request.method() === 'POST');
  const saveRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/records' && request.method() === 'POST');

  await page.locator('#csvText').fill(weirdCsv);
  await page.locator('#useCsv').click();

  const aiCall = await aiRequest;
  const aiBody = bodyOf(aiCall);
  expect(aiBody.rows).toHaveLength(2);

  const saveCall = await saveRequest;
  const saved = bodyOf(saveCall);
  expect(saved.rows).toHaveLength(2);
  expect(saved.rows[0]).toMatchObject({
    name: 'Aiden Shah',
    opponent: 'Leo Kim',
    result: 'W',
    score: '6-3 6-4',
    gender: 'Boys',
    division: 'Singles',
  });
  expect(saved.rows[1]).toMatchObject({
    name: 'Maya Lee',
    opponent: 'Zoe Rivera',
    result: 'L',
    score: '4-6 3-6',
    gender: 'Girls',
    division: 'Singles',
  });

  await expect(page.locator('#analyzerTitle')).toContainText('2 matches recognized from 2 rows');
  await expect(page.locator('#rankingTable')).toContainText('Aiden Shah');
  await expect(page.locator('#rankingTable')).toContainText('Leo Kim');
  await expect(page.locator('#rankingTable')).toContainText('Maya Lee');
  await expect(page.locator('#rankingTable')).toContainText('Zoe Rivera');
  await expect(page.locator('#matchesList .match-row')).toHaveCount(2);
  await expect(page.locator('#statusMessage')).toContainText(/verified|saved/i);
  expect(pageErrors).toEqual([]);
});
