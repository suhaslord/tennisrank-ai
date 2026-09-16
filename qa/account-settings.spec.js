const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/qa-ai-index.html';
const SUPABASE = 'https://fake.supabase.test';

async function installRoutes(page, role = 'admin') {
  const profile = {
    id: `qa-${role}`,
    email: `${role}@example.test`,
    full_name: role === 'admin' ? 'Coach QA' : 'Player QA',
    player_name: role === 'player' ? 'Player QA' : null,
    role,
    must_change_password: false,
  };

  await page.addInitScript(({ profile }) => {
    // Seed only the first navigation. A real sign-out/reload must be allowed to
    // remove the session permanently instead of this test helper restoring it.
    if (sessionStorage.getItem('qa-session-seeded') === 'true') return;
    sessionStorage.setItem('qa-session-seeded', 'true');
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify({
      access_token: 'qa-access',
      refresh_token: 'qa-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: profile.id, email: profile.email },
    }));
  }, { profile });

  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.XLSX = window.XLSX || {};' }));
  await page.route('**/api/config', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabaseUrl: SUPABASE, publishableKey: 'qa-public-key' }) }));
  await page.route(`${SUPABASE}/auth/v1/**`, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile }) }));
  await page.route('**/api/records**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], count: 0, snapshots: [] }) }));
  await page.route('**/api/users**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profiles: [], roster: [] }) }));
  await page.route('**/api/ladder**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ladder: [], settings: [], viewer: { role }, needsAttention: {}, teamStatus: {}, audit: [], undoCandidates: [], missingAccounts: [], importWarnings: [] }) }));
  await page.route('**/api/challenges**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ challenges: [] }) }));
  return profile;
}

test('account button opens themed settings instead of signing out immediately', async ({ page }) => {
  const profile = await installRoutes(page, 'admin');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();

  const account = page.locator('#accountMenu');
  await expect(account).toHaveAttribute('aria-label', 'Open account settings');
  await expect(account.locator('i')).toHaveClass(/ph-caret-down/);
  await account.click();

  const shell = page.locator('#trAccountSettingsShell');
  const sheet = page.locator('.tr-account-sheet');
  await expect(shell).toBeVisible();
  await expect(page).toHaveURL(/\/(?:admin|qa-ai-index\.html)(?:$|[?#])/);
  await expect(page.locator('[data-account-name]')).toHaveText(profile.full_name);
  await expect(page.locator('[data-account-role]')).toHaveText('Administrator');
  await expect(page.locator('.tr-account-status')).toContainText('Signed in');
  await expect(page.locator('#trAccountSettingsTitle')).toHaveText('Account settings');

  const visual = await sheet.evaluate(el => {
    const style = getComputedStyle(el);
    const accent = getComputedStyle(el.querySelector('.tr-account-accent')).backgroundColor;
    const signout = getComputedStyle(el.querySelector('[data-account-signout]')).backgroundColor;
    return {
      background: style.backgroundColor,
      radius: style.borderRadius,
      border: style.borderTopColor,
      accent,
      signout,
    };
  });
  expect(visual.background).toBe('rgb(250, 251, 249)');
  expect(visual.radius).toBe('0px');
  expect(visual.border).toBe('rgb(222, 223, 219)');
  expect(visual.accent).toBe('rgb(255, 118, 87)');
  expect(visual.signout).toBe('rgb(255, 118, 87)');

  const sessionStillPresent = await page.evaluate(() => Boolean(localStorage.getItem('tennisRankAuthSessionV1')));
  expect(sessionStillPresent).toBe(true);

  await page.locator('.tr-account-close').click();
  await expect(shell).toBeHidden();
  await expect(account).toBeFocused();

  await account.click();
  await expect(shell).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shell).toBeHidden();
  await expect(account).toBeFocused();
});

test('account settings stay inside a 320px phone viewport with usable controls', async ({ page }) => {
  await installRoutes(page, 'player');
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await page.locator('#accountMenu').click();

  const shell = page.locator('#trAccountSettingsShell');
  const sheet = page.locator('.tr-account-sheet');
  await expect(shell).toBeVisible();
  await expect(page.locator('[data-account-role]')).toHaveText('Player');

  const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 2);
  const box = await sheet.boundingBox();
  expect(box).toBeTruthy();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(321);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(721);

  for (const selector of ['[data-account-signout]', '.tr-account-close', '.tr-account-icon-close']) {
    const control = page.locator(selector);
    const controlBox = await control.boundingBox();
    expect(controlBox.width).toBeGreaterThanOrEqual(42);
    expect(controlBox.height).toBeGreaterThanOrEqual(42);
  }
});

test('Sign out inside the themed account sheet clears the real session and returns to login', async ({ page }) => {
  await installRoutes(page, 'admin');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await page.locator('#accountMenu').click();
  await expect(page.locator('#trAccountSettingsShell')).toBeVisible();

  const logoutRequest = page.waitForRequest(request => request.url().includes('/auth/v1/logout') && request.method() === 'POST');
  await page.locator('[data-account-signout]').click();
  await logoutRequest;

  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page.locator('#appShell')).toBeHidden();
  await expect(page.locator('#loginForm')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tennisRankAuthSessionV1'))).toBeNull();
  await expect(page).toHaveURL(/\/$/);
});
