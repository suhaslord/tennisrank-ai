const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/index.html';
const SUPABASE = 'https://fake.supabase.test';

async function baseRoutes(page, role = 'player') {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/api/config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supabaseUrl: SUPABASE, publishableKey: 'qa-public-key' }),
  }));
  await page.route(`${SUPABASE}/auth/v1/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/token')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'qa-access',
          refresh_token: 'qa-refresh',
          expires_in: 3600,
          user: { id: 'qa-user', email: 'qa@example.test' },
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ profile: { id: 'qa-user', email: 'qa@example.test', full_name: role === 'admin' ? 'Coach QA' : 'Player QA', player_name: 'Player QA', role, must_change_password: false } }),
  }));
  await page.route('**/api/records', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], count: 0 }) }));
  await page.route('**/api/users', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profiles: [], roster: [] }) }));
  await page.route('**/api/ladder', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ladder: [], settings: [], viewer: { role } }) }));
  await page.route('**/api/challenges', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ challenges: [] }) }));
}

async function seedAdmin(page) {
  await page.addInitScript(() => {
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify({
      access_token: 'qa-access',
      refresh_token: 'qa-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'qa-user', email: 'qa@example.test' },
    }));
  });
}

test('login uses the same square paper and orange TennisRank theme', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await baseRoutes(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page.locator('.auth-visual')).toBeHidden();
  await expect(page.locator('.auth-copy')).toHaveText('Sign in to see your team.');
  await expect(page.locator('#forgotPassword')).toHaveText('Forgot your password?');
  await expect(page.locator('.auth-card')).toBeVisible();

  const visual = await page.locator('.auth-visual').evaluate(el => getComputedStyle(el).display);
  const columns = await page.locator('#authGate').evaluate(el => getComputedStyle(el).gridTemplateColumns);
  const card = await page.locator('.auth-card').evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    radius: parseFloat(getComputedStyle(el).borderRadius),
    width: el.getBoundingClientRect().width,
    borderTop: getComputedStyle(el).borderTopColor,
  }));
  const button = await page.locator('#loginButton').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(visual).toBe('none');
  expect(columns.split(' ').length).toBe(1);
  expect(card.background).toBe('rgb(250, 251, 249)');
  expect(card.radius).toBe(0);
  expect(card.width).toBeLessThanOrEqual(500);
  expect(card.borderTop).toBe('rgb(32, 33, 31)');
  expect(button).toBe('rgb(255, 118, 87)');
});

test('admin account settings use the same light orange theme and human copy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedAdmin(page);
  await baseRoutes(page, 'admin');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await page.locator('#accountsPanel').scrollIntoViewIfNeeded();
  await expect(page.locator('#accountsPanel')).toBeVisible();
  await expect(page.locator('#accountsPanel .eyebrow')).toHaveText('Team access');
  await expect(page.locator('#accountsPanel h2')).toHaveText('Player accounts');
  await expect(page.locator('#accountsPanel .role-pill')).toHaveText('Coach only');
  await expect(page.locator('#inviteButton span')).toHaveText('Create account');

  const panel = await page.locator('#accountsPanel').evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    radius: parseFloat(getComputedStyle(el).borderRadius),
  }));
  const button = await page.locator('#inviteButton').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(panel.background).toMatch(/rgb\(255, 255, 255\)/);
  expect(panel.radius).toBeGreaterThanOrEqual(16);
  expect(button).not.toBe('rgb(0, 0, 0)');
});

test('themed login stays clean at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await baseRoutes(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.auth-visual')).toBeHidden();
  await expect(page.locator('.auth-card')).toBeVisible();
  const metrics = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.inner + 2);
  const box = await page.locator('.auth-card').boundingBox();
  expect(box.width).toBeLessThanOrEqual(292);
});
