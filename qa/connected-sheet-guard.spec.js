const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/qa-ai-index.html';
const SHEET = 'https://docs.google.com/spreadsheets/d/e/qa-published/pub?output=csv&gid=0';

function bodyOf(request) {
  try { return request.postDataJSON() || {}; }
  catch { return {}; }
}

async function installMocks(page) {
  const profile = { id: 'qa-admin', email: 'coach@example.test', full_name: 'Coach QA', player_name: null, role: 'admin', must_change_password: false };
  const savedRows = [];
  const recordActions = [];

  await page.addInitScript(({ profile, sheet }) => {
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify({
      access_token: 'qa-access', refresh_token: 'qa-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: profile.id, email: profile.email },
    }));
    localStorage.setItem('tennisRankSheetUrl', sheet);
    localStorage.setItem('tennisRankRefreshRate', '60');
  }, { profile, sheet: SHEET });

  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX = window.XLSX || {};' }));
  await page.route('**/api/config', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabaseUrl: 'https://fake.supabase.test', publishableKey: 'qa-public-key' }) }));
  await page.route('**/api/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile }) }));
  await page.route('**/api/users**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profiles: [], roster: [] }) }));
  await page.route('**/api/challenges**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ challenges: [] }) }));
  await page.route('**/api/ladder**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ladder: [], settings: [{ team_gender: 'boys', max_challenge_distance: 3 }, { team_gender: 'girls', max_challenge_distance: 3 }], viewer: { role: 'admin' }, needsAttention: {}, teamStatus: {}, audit: [], undoCandidates: [], missingAccounts: [], importWarnings: [] }) }));
  await page.route('**/api/admin/seed-ladder', route => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ seeded: 2 }) }));
  await page.route('**/api/ai-analyze-sheet', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'AI should not be required for this clean fixture.' }) }));
  await page.route('**/api/sheet-proxy?*', route => route.fulfill({
    status: 200,
    contentType: 'text/csv',
    body: [
      'Name,Opponent,Result,Score,Gender,Division,Date',
      'Noah Williams,Liam Chen,W,6-3,Boys,Singles,2026-09-15',
      'Ethan Kim,Jack Park,W,6-4,Boys,Singles,2026-09-15',
    ].join('\n'),
  }));

  await page.route('**/api/records**', route => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: savedRows, count: savedRows.length, snapshots: [] }) });
    }
    const body = bodyOf(request);
    recordActions.push(body.action || 'publish');
    if (body.action === 'preview') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ previewHash: 'sheet-guard-hash', rowCount: body.rows.length, sourceLabel: SHEET, warnings: [] }) });
    }
    if (body.action === 'publish' || !body.action) {
      savedRows.splice(0, savedRows.length, ...(body.rows || []));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ saved: savedRows.length, snapshotId: '00000000-0000-4000-8000-000000000001' }) });
    }
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected records action' }) });
  });

  return { savedRows, recordActions };
}

test('Refresh now on a connected Sheet opens exactly one preview and publishes exactly once', async ({ page }) => {
  const state = await installMocks(page);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();

  await expect.poll(() => page.evaluate(() => Boolean(window.fetchSheet?.__connectedSheetGuard))).toBe(true);
  await page.locator('#openSettings').click();
  await page.locator('#refreshNow').click();
  await expect(page.locator('#importPreviewModal')).toBeVisible();
  expect(state.recordActions.filter(action => action === 'preview')).toHaveLength(1);

  await page.locator('[data-preview-confirm]').click();
  await expect.poll(() => state.savedRows.length).toBe(2);
  await expect(page.locator('#importPreviewModal')).toBeHidden();
  await page.waitForTimeout(100);

  expect(state.recordActions.filter(action => action === 'preview')).toHaveLength(1);
  expect(state.recordActions.filter(action => action === 'publish')).toHaveLength(1);
  await expect(page.locator('#rankingTable')).toContainText('Noah Williams');
  expect(pageErrors).toEqual([]);
});
