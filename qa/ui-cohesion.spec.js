const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/qa-ai-index.html';
const SUPABASE = 'https://fake.supabase.test';

function bodyOf(request) {
  try { return request.postDataJSON() || {}; }
  catch { return {}; }
}

async function installMocks(page, { rows = [] } = {}) {
  const profile = {
    id: 'coach-ui',
    email: 'coach-ui@example.test',
    full_name: 'Coach UI',
    player_name: null,
    role: 'admin',
    must_change_password: false,
  };
  const savedRows = [...rows];

  await page.addInitScript(({ profile }) => {
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify({
      access_token: 'qa-access',
      refresh_token: 'qa-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: profile.id, email: profile.email },
    }));
  }, { profile });

  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX = window.XLSX || {};' }));
  await page.route(`${SUPABASE}/auth/v1/**`, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });

    if (path === '/api/config') return ok({ supabaseUrl: SUPABASE, publishableKey: 'qa-public-key' });
    if (path === '/api/session') return ok({ profile });
    if (path === '/api/users') return ok({ profiles: [], roster: [] });
    if (path === '/api/challenges') return ok({ challenges: [] });
    if (path === '/api/admin/seed-ladder') return ok({ seeded: 0 });
    if (path === '/api/records' && request.method() === 'GET') return ok({ rows: savedRows, count: savedRows.length, snapshots: [] });
    if (path === '/api/records' && request.method() === 'POST') {
      const body = bodyOf(request);
      if (body.action === 'preview') return ok({ previewHash: 'ui-cohesion-preview', rowCount: body.rows?.length || 0, warnings: [] });
      if (body.action === 'publish') {
        savedRows.splice(0, savedRows.length, ...(body.rows || []));
        return ok({ saved: savedRows.length, snapshotId: 'snap-ui' });
      }
      return ok({ saved: savedRows.length });
    }
    if (path === '/api/ladder') return ok({
      ladder: [],
      settings: [
        { team_gender: 'boys', max_challenge_distance: 3 },
        { team_gender: 'girls', max_challenge_distance: 3 },
      ],
      viewer: { profileId: profile.id, role: profile.role },
      needsAttention: {}, teamStatus: {}, audit: [], undoCandidates: [], missingAccounts: [], importWarnings: [],
    });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled QA route ${path}` }) });
  });

  return { savedRows };
}

const multiBoardRows = [
  { winner: 'Noah', loser: 'Liam', score: '6-3', gender: 'Boys', division: 'Singles', date: '2026-09-15' },
  { winner: 'Ava', loser: 'Mia', score: '6-4', gender: 'Girls', division: 'Singles', date: '2026-09-15' },
  { winner: 'Ethan & Noah', loser: 'Jack & Liam', score: '6-2', gender: 'Boys', division: 'Doubles', date: '2026-09-15' },
  { winner: 'Ava & Zoe', loser: 'Emma & Mia', score: '6-1', gender: 'Girls', division: 'Doubles', date: '2026-09-15' },
  { winner: 'Olivia & Ravi', loser: 'Ben & Sophia', score: '7-5', gender: 'Mixed', division: 'Doubles', date: '2026-09-15' },
];

test('rankings hero has no tennis court and switches across singles doubles and mixed', async ({ page }) => {
  await installMocks(page, { rows: multiBoardRows });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#ladderExperience')).toBeVisible();
  await expect(page.locator('#ladderExperience .ladder-stage')).toHaveCount(0);
  await expect(page.locator('#ladderExperienceTitle')).toHaveText('Team rankings');

  const tabs = page.locator('[data-ladder-board]');
  await expect(tabs).toHaveCount(5);
  await expect(page.locator('[data-ladder-board="boys|singles"]')).toHaveText('Boys Singles');
  await expect(page.locator('[data-ladder-board="girls|singles"]')).toHaveText('Girls Singles');
  await expect(page.locator('[data-ladder-board="boys|doubles"]')).toHaveText('Boys Doubles');
  await expect(page.locator('[data-ladder-board="girls|doubles"]')).toHaveText('Girls Doubles');
  await expect(page.locator('[data-ladder-board="mixed|doubles"]')).toHaveText('Mixed Doubles');

  await expect(page.locator('#ladderList')).toContainText('Noah');
  await page.locator('[data-ladder-board="girls|singles"]').click();
  await expect(page.locator('#ladderBoardTitle')).toHaveText('Girls Singles');
  await expect(page.locator('#ladderList')).toContainText('Ava');

  await page.locator('[data-ladder-board="boys|doubles"]').click();
  await expect(page.locator('#ladderList')).toContainText('Ethan & Noah');
  await expect(page.locator('#ladderBoardNote')).toContainText(/challenge ladder stays singles-only/i);

  await page.locator('[data-ladder-board="girls|doubles"]').click();
  await expect(page.locator('#ladderList')).toContainText('Ava & Zoe');

  await page.locator('[data-ladder-board="mixed|doubles"]').click();
  await expect(page.locator('#ladderList')).toContainText('Olivia & Ravi');
  await expect(page.locator('#ladderBoardTitle')).toHaveText('Mixed Doubles');

  const theme = await page.locator('#ladderExperience').evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el).color,
  }));
  expect(theme.background).toBe('rgb(250, 251, 249)');
  expect(theme.color).toBe('rgb(32, 33, 31)');
});

test('import preview matches theme, does not nag about unused boards, and always releases page scroll', async ({ page }) => {
  await installMocks(page, { rows: multiBoardRows.slice(0, 2) });
  await page.setViewportSize({ width: 1365, height: 768 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();

  await page.locator('#openSettings').click();
  await page.locator('#tabCsv').click();
  await page.locator('#csvText').fill([
    'Winner,Loser,Score,Gender,Division,Date',
    'Noah,Liam,6-3,Boys,Singles,2026-09-15',
    'Ava,Mia,6-4,Girls,Singles,2026-09-15',
  ].join('\n'));
  await page.locator('#useCsv').click();

  const modal = page.locator('#importPreviewModal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#importPreviewTitle')).toHaveText('Check this before it goes live');
  await expect(modal).not.toContainText(/(?:We didn.t find )?Boys Doubles (?:was not detected|wasn.t found|in this import)/i);
  await expect(modal).not.toContainText(/(?:We didn.t find )?Girls Doubles (?:was not detected|wasn.t found|in this import)/i);
  await expect(modal).toContainText('Boards in this import');

  const visual = await page.locator('.coach-modal').evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    radius: getComputedStyle(el).borderRadius,
  }));
  expect(visual.background).toBe('rgb(250, 251, 249)');
  expect(visual.radius).toBe('0px');

  await page.locator('[data-preview-cancel]').first().click();
  await expect(modal).toBeHidden();
  await expect.poll(() => page.evaluate(() => ({
    classLocked: document.body.classList.contains('coach-modal-open'),
    htmlAccountLocked: document.documentElement.classList.contains('tr-account-open'),
    overflow: getComputedStyle(document.body).overflowY,
  }))).toEqual({ classLocked: false, htmlAccountLocked: false, overflow: 'auto' });

  const before = await page.evaluate(() => scrollY);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
  await expect(page.locator('#accountsPanel')).toBeAttached();
});
