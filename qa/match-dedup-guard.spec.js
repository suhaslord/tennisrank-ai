const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/qa-ai-index.html';

function bodyOf(request) {
  try { return request.postDataJSON() || {}; }
  catch { return {}; }
}

async function installMocks(page) {
  const profile = { id: 'qa-admin', email: 'coach@example.test', full_name: 'Coach QA', player_name: null, role: 'admin', must_change_password: false };
  const savedRows = [];
  let aiCalls = 0;

  await page.addInitScript(({ profile }) => {
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify({
      access_token: 'qa-access', refresh_token: 'qa-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: profile.id, email: profile.email },
    }));
  }, { profile });

  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX = window.XLSX || {};' }));
  await page.route('**/api/config', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabaseUrl: 'https://fake.supabase.test', publishableKey: 'qa-public-key' }) }));
  await page.route('**/api/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile }) }));
  await page.route('**/api/users**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profiles: [], roster: [] }) }));
  await page.route('**/api/challenges**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ challenges: [] }) }));
  await page.route('**/api/ladder**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ladder: [], settings: [], viewer: { role: 'admin' }, needsAttention: {}, teamStatus: {}, audit: [], undoCandidates: [], missingAccounts: [], importWarnings: [] }) }));
  await page.route('**/api/admin/seed-ladder', route => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ seeded: 2 }) }));
  await page.route('**/api/ai-analyze-sheet', route => {
    aiCalls += 1;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'AI must not be asked to reinterpret contradictory deterministic match results.' }) });
  });
  await page.route('**/api/records**', route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: savedRows, count: savedRows.length, snapshots: [] }) });
    const body = bodyOf(request);
    if (body.action === 'preview') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ previewHash: 'dedup-hash', sourceLabel: 'Pasted CSV', rowCount: body.rows.length }) });
    if (body.action === 'publish' || !body.action) {
      savedRows.splice(0, savedRows.length, ...(body.rows || []));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ saved: savedRows.length, snapshotId: '00000000-0000-4000-8000-000000000001' }) });
    }
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected records action' }) });
  });

  return { savedRows, aiCalls: () => aiCalls };
}

async function openCsv(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.TennisRankImportV2?.parseText?.__matchDedupGuard))).toBe(true);
  await page.locator('#openSettings').click();
  await page.locator('#tabCsv').click();
  await expect(page.locator('#csvSource')).toBeVisible();
}

test('reciprocal duplicate singles rows count as one match', async ({ page }) => {
  const state = await installMocks(page);
  await openCsv(page);
  const csv = [
    'Player,Opponent,Result,Score,Gender,Division,Date',
    'Noah Williams,Liam Chen,W,6-3,Boys,Singles,2026-09-15',
    'Liam Chen,Noah Williams,L,6-3,Boys,Singles,2026-09-15',
  ].join('\n');
  await page.locator('#csvText').fill(csv);
  await page.locator('#useCsv').click();
  await expect(page.locator('#importPreviewModal')).toBeVisible();
  await page.locator('[data-preview-confirm]').click();

  await expect.poll(() => state.savedRows.length).toBe(1);
  await expect(page.locator('#rankingTable')).toContainText('Noah Williams');
  await expect(page.locator('#rankingTable')).toContainText('1-0');
  await expect(page.locator('#matchesList .match-row')).toHaveCount(1);
});

test('contradictory duplicate winners hard-block before AI or publish', async ({ page }) => {
  const state = await installMocks(page);
  await openCsv(page);
  const csv = [
    'Player,Opponent,Result,Score,Gender,Division,Date',
    'Noah Williams,Liam Chen,W,6-3,Boys,Singles,2026-09-15',
    'Noah Williams,Liam Chen,L,6-3,Boys,Singles,2026-09-15',
  ].join('\n');
  await page.locator('#csvText').fill(csv);
  await page.locator('#useCsv').click();

  await expect(page.locator('#statusMessage')).toContainText(/conflicting duplicate match/i);
  await expect(page.locator('#importPreviewModal')).toBeHidden();
  expect(state.savedRows).toHaveLength(0);
  expect(state.aiCalls()).toBe(0);
  await expect(page.locator('#rankingTable')).toContainText('No ranking data');
});
