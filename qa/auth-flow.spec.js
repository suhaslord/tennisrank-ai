const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/index.html';
const SUPABASE = 'https://fake.supabase.test';

function sessionValue(overrides = {}) {
  return {
    access_token: 'qa-access-token',
    refresh_token: 'qa-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'profile-player', email: 'player@example.test' },
    ...overrides,
  };
}

function playerProfile(overrides = {}) {
  return {
    id: 'profile-player',
    email: 'player@example.test',
    full_name: 'Player QA',
    player_name: 'Player QA',
    role: 'player',
    must_change_password: false,
    ...overrides,
  };
}

async function seedSession(page, value) {
  await page.addInitScript(({ value }) => {
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify(value));
  }, { value });
}

async function installAuthMocks(page, options = {}) {
  const state = {
    refreshCalls: 0,
    sessionCalls: 0,
    loginCalls: 0,
    passwordUpdates: 0,
    recoveryCalls: 0,
    profile: options.profile || playerProfile(),
  };

  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route(`${SUPABASE}/auth/v1/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname + url.search;
    const json = (status, value) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

    if (path.includes('/token?grant_type=password')) {
      state.loginCalls += 1;
      if (options.invalidLogin) return json(400, { message: 'Invalid login credentials' });
      return json(200, {
        access_token: 'login-access-token',
        refresh_token: 'login-refresh-token',
        expires_in: 3600,
        user: { id: state.profile.id, email: state.profile.email },
      });
    }
    if (path.includes('/token?grant_type=refresh_token')) {
      state.refreshCalls += 1;
      return json(200, {
        access_token: `refreshed-access-${state.refreshCalls}`,
        refresh_token: 'qa-refresh-token',
        expires_in: 3600,
        user: { id: state.profile.id, email: state.profile.email },
      });
    }
    if (url.pathname.endsWith('/user') && request.method() === 'PUT') {
      state.passwordUpdates += 1;
      state.profile = { ...state.profile, must_change_password: false };
      return json(200, { user: { id: state.profile.id } });
    }
    if (url.pathname.endsWith('/recover')) {
      state.recoveryCalls += 1;
      return json(200, {});
    }
    if (url.pathname.endsWith('/logout')) return json(204, {});
    return json(404, { error: `Unhandled Supabase auth route ${path}` });
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status, value) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/config') return json(200, { supabaseUrl: SUPABASE, publishableKey: 'qa-public-key' });
    if (path === '/api/session') {
      state.sessionCalls += 1;
      if (options.firstSession401 && state.sessionCalls === 1) return json(401, { error: 'Expired access token.' });
      if (request.method() === 'PATCH') {
        state.profile = { ...state.profile, must_change_password: false };
        return json(200, { profile: state.profile });
      }
      return json(200, { profile: state.profile });
    }
    if (path === '/api/records') return json(200, { rows: [], count: 0 });
    if (path === '/api/users') return json(200, { profiles: [] });
    if (path === '/api/ladder') return json(200, { ladder: [], settings: [], viewer: { profileId: state.profile.id, role: state.profile.role, playerName: state.profile.player_name } });
    if (path === '/api/challenges') return json(200, { challenges: [] });
    return json(404, { error: `Unhandled QA API ${path}` });
  });

  return state;
}

async function assertNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 2);
}

test('invalid login stays on the auth gate with an inline error and reusable button', async ({ page }) => {
  const state = await installAuthMocks(page, { invalidLogin: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#authGate')).toBeVisible();
  await page.locator('#loginEmail').fill('player@example.test');
  await page.locator('#loginPassword').fill('wrong-password');
  await page.locator('#loginButton').click();
  await expect(page.locator('#authStatus')).toContainText('Invalid login credentials');
  await expect(page.locator('#authStatus')).toHaveClass(/error/);
  await expect(page.locator('#loginButton')).toBeEnabled();
  await expect(page.locator('#appShell')).toBeHidden();
  expect(state.loginCalls).toBe(1);
});

test('successful player login opens the player route and hides admin controls', async ({ page }) => {
  const state = await installAuthMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('#loginEmail').fill('player@example.test');
  await page.locator('#loginPassword').fill('correct-password');
  await page.locator('#loginButton').click();
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#authGate')).toBeHidden();
  await expect(page).toHaveURL(/\/player(?:#.*)?$/);
  await expect(page.locator('#accountRole')).toHaveText('Player');
  await expect(page.locator('#playerDashboard')).toBeVisible();
  expect(state.loginCalls).toBe(1);
});

test('expired stored session refreshes before the dashboard loads', async ({ page }) => {
  await seedSession(page, sessionValue({ expires_at: Math.floor(Date.now() / 1000) - 60 }));
  const state = await installAuthMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page).toHaveURL(/\/player(?:#.*)?$/);
  expect(state.refreshCalls).toBe(1);
  expect(state.sessionCalls).toBeGreaterThanOrEqual(1);
});

test('a 401 from the server forces one token refresh and retries the session request', async ({ page }) => {
  await seedSession(page, sessionValue());
  const state = await installAuthMocks(page, { firstSession401: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  expect(state.refreshCalls).toBe(1);
  expect(state.sessionCalls).toBe(2);
});

test('first-login password change completes before the dashboard becomes visible', async ({ page }) => {
  await seedSession(page, sessionValue());
  const state = await installAuthMocks(page, { profile: playerProfile({ must_change_password: true }) });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#passwordForm')).toBeVisible();
  await expect(page.locator('#appShell')).toBeHidden();
  await expect(page.locator('#authTitle')).toContainText('Choose your password');
  await page.locator('#newPassword').fill('new-secure-password');
  await page.locator('#passwordButton').click();
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page).toHaveURL(/\/player(?:#.*)?$/);
  expect(state.passwordUpdates).toBe(1);
});

test('forgot password without an email gives inline guidance and focuses email', async ({ page }) => {
  await installAuthMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('#forgotPassword').click();
  await expect(page.locator('#authStatus')).toContainText('Enter your email first');
  await expect(page.locator('#authStatus')).toHaveClass(/error/);
  await expect(page.locator('#loginEmail')).toBeFocused();
});

test('forgot password sends recovery only after an email is present', async ({ page }) => {
  const state = await installAuthMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('#loginEmail').fill('player@example.test');
  await page.locator('#forgotPassword').click();
  await expect(page.locator('#authStatus')).toContainText('Password reset email sent');
  expect(state.recoveryCalls).toBe(1);
});

test('auth UI remains readable and non-overflowing at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await installAuthMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page.locator('#loginEmail')).toBeVisible();
  await expect(page.locator('#loginPassword')).toBeVisible();
  await expect(page.locator('#loginButton')).toBeVisible();
  await assertNoHorizontalOverflow(page);
  const button = await page.locator('#loginButton').boundingBox();
  expect(button.height).toBeGreaterThanOrEqual(44);
});
