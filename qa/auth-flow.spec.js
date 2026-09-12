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
    accountCalls: [],
    createdAccounts: [],
    recoveryCalls: 0,
    recoveryRedirect: '',
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
      state.recoveryRedirect = url.searchParams.get('redirect_to');
      if (options.recoveryFails) return json(429, {message:'Email rate limit exceeded'});
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
        if (options.passwordFails) return json(400, {error:'Choose a different password.'});
        expect(request.postDataJSON().password.length).toBeGreaterThanOrEqual(10);
        state.passwordUpdates += 1;
        state.profile = { ...state.profile, must_change_password: false };
        return json(200, { profile: state.profile });
      }
      return json(200, { profile: state.profile });
    }
    if (path === '/api/records') return json(200, { rows: [], count: 0 });
    if (path === '/api/users') {
      if(request.method()==='POST') {
        const body=request.postDataJSON(); state.accountCalls.push(body);
        const delivery={method:'email',status:options.deliveryFails ? 'failed':'accepted',message:options.deliveryFails ? 'Email delivery unavailable. Use Send password email to retry.' : 'Password setup email requested. Check the inbox and spam folder.'};
        if(body.action==='send-password-email') return json(200,{delivery});
        const profile={id:'created-player',email:body.email,full_name:body.fullName,role:body.role,must_change_password:true};
        state.createdAccounts.push(profile);return json(201,{profile,delivery});
      }
      if(options.listFailsAfterCreate && state.createdAccounts.length) return json(503,{error:'List unavailable'});
      return json(200, { profiles: state.createdAccounts, roster: [{id:'roster-player',display_name:'Player QA',team_gender:'boys',active_status:'active',division:'varsity',accountCreated:state.createdAccounts.length>0}] });
    }
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
  await expect(page.locator('.login-arrival')).toHaveCount(0);
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
  await expect(page.locator('#authStatus')).toContainText('password reset link has been requested');
  expect(state.recoveryCalls).toBe(1);
  expect(state.recoveryRedirect).toBe('http://127.0.0.1:4173/player');
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


test('admin opens an empty shared board without reviving cached test data', async ({ page }) => {
  const profile = playerProfile({ role: 'admin', full_name: 'Coach QA' });
  await installAuthMocks(page, { profile });
  await seedSession(page, sessionValue());
  await page.addInitScript(() => {
    localStorage.setItem('tennisRankDataSnapshotV1', JSON.stringify({rows:[{Name:'Old Test Player',Gender:'Boys',Division:'Singles'}],source:'csv'}));
  });
  await page.goto(BASE);
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('#heroSourceLabel')).toHaveText('Ready to import');
  await expect(page.locator('#rankingTable')).not.toContainText('Old Test Player');
  await expect(page.locator('#csvText')).toHaveValue('');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tennisRankDataSnapshotV1'))).toBeNull();
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`login arrival respects ${reducedMotion} and never replays on reload`, async ({page}) => {
    await page.emulateMedia({reducedMotion});
    await installAuthMocks(page);
    await page.addInitScript(() => {
      window.arrivalCount = 0;
      new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === 1 && node.matches('.login-arrival')) window.arrivalCount++;
      }))).observe(document, {childList:true,subtree:true});
    });
    await page.goto(BASE);
    await page.locator('#loginEmail').fill('player@example.test');
    await page.locator('#loginPassword').fill('correct-password');
    await page.locator('#loginButton').click();
    await expect(page.locator('#appShell')).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>window.arrivalCount)).toBe(reducedMotion === 'reduce' ? 0 : 1);
    await expect(page.locator('.login-arrival')).toHaveCount(0, {timeout:2000});
    await page.reload();
    await expect(page.locator('#appShell')).toBeVisible();
    expect(await page.evaluate(()=>window.arrivalCount)).toBe(0);
  });
}

test('expired email link gives recovery guidance and removes the URL error', async ({page}) => {
  await installAuthMocks(page);
  await page.goto(BASE+'#error=access_denied&error_code=otp_expired&error_description=expired');
  await expect(page.locator('#authStatus')).toContainText('expired');
  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page).toHaveURL(BASE);
});
test('email recovery failures leave the button reusable and show no success', async ({page}) => {
  await installAuthMocks(page, {recoveryFails:true}); await page.goto(BASE);
  await page.locator('#loginEmail').fill('player@example.test'); await page.locator('#forgotPassword').click();
  await expect(page.locator('#authStatus')).toContainText('Too many email requests');
  await expect(page.locator('#forgotPassword')).toBeEnabled();
});
test('recovery link opens password setup and failed password stays gated', async ({page}) => {
  await installAuthMocks(page,{passwordFails:true});
  await page.goto(BASE+'#access_token=recovery-test&refresh_token=refresh-test&type=recovery');
  await expect(page.locator('#passwordForm')).toBeVisible();
  await page.locator('#newPassword').fill('new-secure-password'); await page.locator('#passwordButton').click();
  await expect(page.locator('#authStatus')).toContainText('different password');
  await expect(page.locator('#passwordButton')).toBeEnabled();
  await expect(page.locator('#appShell')).toBeHidden();
  await expect(page.locator('.login-arrival')).toHaveCount(0);
});

for(const deliveryFails of [false,true]) test(`account creation submits once and reports email ${deliveryFails ? 'failure' : 'request'}`, async ({page})=>{
  await page.setViewportSize({width:320,height:950});
  await page.emulateMedia({reducedMotion:'reduce'});
  await seedSession(page,sessionValue());
  const state=await installAuthMocks(page,{profile:playerProfile({role:'admin'}),deliveryFails});
  await page.goto(BASE);await page.locator('#openSettings').click();
  await page.locator('#inviteRosterPlayer').selectOption('roster-player');
  await page.locator('#inviteEmail').fill('player@example.test');
  await expect(page.locator('#invitePassword')).toBeHidden();
  await page.locator('#inviteButton').click();
  await expect(page.locator('#inviteStatus')).toContainText('Account created.');
  await expect(page.locator('#inviteStatus')).toContainText(deliveryFails ? 'delivery unavailable' : 'email requested');
  expect(state.accountCalls.length).toBe(1);
  expect(state.accountCalls[0].deliveryMethod).toBe('email');
  expect(state.accountCalls[0].temporaryPassword).toBe('');
  await expect(page.locator('#accountList')).toContainText('player@example.test');
  await page.locator('[data-account-email]').click();
  expect(state.accountCalls.length).toBe(2);
  expect(state.accountCalls[1].action).toBe('send-password-email');
  await assertNoHorizontalOverflow(page);
  await page.locator('#accountsPanel').scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/tennis-accounts-320.png'});
});
test('account creation remains successful if the following list refresh fails',async ({page})=>{
  await seedSession(page,sessionValue());
  const state=await installAuthMocks(page,{profile:playerProfile({role:'admin'}),listFailsAfterCreate:true});
  await page.goto(BASE);await page.locator('#openSettings').click();
  await page.locator('#inviteRosterPlayer').selectOption('roster-player');
  await page.locator('#inviteEmail').fill('player@example.test');
  await page.locator('#inviteButton').click();
  await expect(page.locator('#inviteStatus')).toContainText('Account created.');
  await expect(page.locator('#inviteStatus')).toContainText('account is saved');
  expect(state.accountCalls.length).toBe(1);
});
