const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/qa-ai-index.html';

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
  const ladder = [];

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
      if (body.action === 'preview') return route.fulfill(ok({ previewHash: 'certainty-qa', rowCount: body.rows?.length || 0, warnings: [] }));
      savedRows.splice(0, savedRows.length, ...(Array.isArray(body.rows) ? body.rows : []));
      return route.fulfill(ok({ saved: savedRows.length }));
    }
    if (path === '/api/ai-analyze-sheet' && request.method() === 'POST') {
      return route.fulfill(ok({
        model: 'gemini-3.6-flash-qa',
        privacy: { redactedBeforeProvider: true, providerStorageDisabled: true },
        ai: {
          supported: true,
          sheetKind: 'match_log',
          confidence: 0.99,
          globalGender: 'unknown',
          globalDivision: 'unknown',
          mappings: [
            { inputKey: 'C1', target: 'player1', confidence: 0.99, reason: 'first side identity' },
            { inputKey: 'C2', target: 'player2', confidence: 0.99, reason: 'second side identity' },
            { inputKey: 'C3', target: 'winner', confidence: 0.99, reason: 'winner identity' },
            { inputKey: 'C4', target: 'score', confidence: 0.99, reason: 'tennis scores' },
            { inputKey: 'C5', target: 'gender', confidence: 0.99, reason: 'team values' },
            { inputKey: 'C6', target: 'division', confidence: 0.99, reason: 'event values' },
          ],
          warnings: [],
        },
      }));
    }
    if (path === '/api/admin/seed-ladder' && request.method() === 'POST') {
      const body = bodyOf(request);
      ladder.splice(0, ladder.length, ...(body.players || []).map((player, index) => ({
        player_id: `boys-${index + 1}`,
        team_gender: body.teamGender,
        rank_position: index + 1,
        previous_rank_position: index + 1,
        status: 'available',
        player: { id: `boys-${index + 1}`, display_name: player.name, team_gender: body.teamGender, division: 'varsity', active_status: 'active' },
      })));
      return route.fulfill(ok({ seeded: ladder.length, teamGender: body.teamGender }, 201));
    }
    if (path === '/api/ladder') {
      return route.fulfill(ok({
        ladder,
        settings: [
          { team_gender: 'boys', max_challenge_distance: 3 },
          { team_gender: 'girls', max_challenge_distance: 3 },
        ],
        viewer: { profileId: profile.id, role: 'admin', playerName: null },
      }));
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled QA route ${path}` }) });
  });

  return { savedRows };
}

test('browser certainty gate publishes only after the final interpretation clears 85 percent', async ({ page }) => {
  const state = await installMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await page.locator('#openSettings').click();
  await page.locator('#tabCsv').click();

  // The relational parser can now understand some generic-column layouts on its
  // own. That is a win: it should not make an unnecessary provider call. If the
  // parser does need AI, the mocked verifier still exercises the same final path.
  // In both cases nothing may publish until certainty is >=85% and the coach
  // confirms the preview.
  const csv = [
    'C1,C2,C3,C4,C5,C6',
    'Noah Williams,Ethan Kim,Noah Williams,6-3,Boys,Singles',
    'Noah Williams,Liam Chen,Liam Chen,4-6,Boys,Singles',
  ].join('\n');

  await page.locator('#csvText').fill(csv);
  await page.locator('#useCsv').click();

  await expect(page.locator('#importPreviewModal')).toBeVisible();
  expect(state.savedRows).toHaveLength(0);
  await page.locator('[data-preview-confirm]').click();
  await expect.poll(() => state.savedRows.length).toBe(2);
  expect(state.savedRows.map(row => [row.winner, row.loser])).toEqual([
    ['Noah Williams', 'Ethan Kim'],
    ['Liam Chen', 'Noah Williams'],
  ]);
  await expect(page.locator('#tennisrankCertaintyMeter')).toBeVisible();
  await expect(page.locator('[data-certainty-value]')).toHaveText(/^(?:8[5-9]|9\d|100)%$/);
  await expect(page.locator('[data-certainty-note]')).toContainText(/(?:Google AI verified|Local parser verified)/i);
  await expect(page.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', /^(?:8[5-9]|9\d|100)$/);
  await expect(page.locator('#analyzerConfidence')).toHaveText(/^(?:8[5-9]|9\d|100)%$/);
  await expect(page.locator('#statusMessage')).toContainText(/saved.*(?:Google AI verification|without needing AI)/i);
});