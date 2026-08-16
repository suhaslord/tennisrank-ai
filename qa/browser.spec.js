const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/index.html';

function futureLocal(days = 4, hour = 16) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  date.setHours(hour, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function ladderPayload(role = 'player') {
  const profileId = role === 'admin' ? 'profile-admin' : 'profile-player';
  const ladder = Array.from({ length: 8 }, (_, index) => {
    const rank = index + 1;
    return {
      player_id: `p${rank}`,
      team_gender: 'boys',
      rank_position: rank,
      previous_rank_position: rank,
      status: 'available',
      updated_at: '2026-08-15T20:00:00Z',
      player: {
        id: `p${rank}`,
        profile_id: rank === 8 ? 'profile-player' : null,
        display_name: rank === 5 ? 'Player Five With A Deliberately Long Tennis Display Name' : `Player ${rank}`,
        team_gender: 'boys',
        grade_level: 10,
        division: 'varsity',
        active_status: 'active',
      },
    };
  });
  return {
    ladder,
    settings: [
      { team_gender: 'boys', max_challenge_distance: 3, response_deadline_hours: 48, challenge_expiration_hours: 168, injury_rank_protection: true },
      { team_gender: 'girls', max_challenge_distance: 3, response_deadline_hours: 48, challenge_expiration_hours: 168, injury_rank_protection: true },
    ],
    viewer: { profileId, role, playerName: role === 'player' ? 'Player 8' : null },
  };
}

function pendingApproval() {
  return {
    id: 'challenge-1',
    challenger_id: 'p8',
    defender_id: 'p6',
    team_gender: 'boys',
    status: 'pending_coach_approval',
    proposed_times: ['2026-08-20T20:00:00Z'],
    scheduled_for: '2026-08-20T20:00:00Z',
    court_location: 'River Islands courts',
    challenger: { id: 'p8', profile_id: 'profile-player', display_name: 'Player 8' },
    defender: { id: 'p6', profile_id: null, display_name: 'Player 6' },
    match: {
      id: 'match-1',
      challenge_id: 'challenge-1',
      score_summary: '6-4, 7-5',
      winner_id: 'p8',
      approval_status: 'pending',
    },
    isOpen: true,
  };
}

function scheduledChallenge() {
  return {
    id: 'challenge-scheduled',
    challenger_id: 'p8',
    defender_id: 'p6',
    team_gender: 'boys',
    status: 'scheduled',
    proposed_times: [],
    scheduled_for: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    court_location: 'River Islands courts',
    challenger: { id: 'p8', profile_id: 'profile-player', display_name: 'Player 8' },
    defender: { id: 'p6', profile_id: null, display_name: 'Player 6' },
    match: null,
    isOpen: true,
  };
}

function bodyOf(request) {
  try { return request.postDataJSON() || {}; }
  catch { return {}; }
}

function apiRequest(page, path, predicate = () => true) {
  return page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === path && predicate(request, bodyOf(request));
  });
}

async function installMocks(page, role, options = {}) {
  const profile = role === 'admin'
    ? { id: 'profile-admin', email: 'coach@example.test', full_name: 'Coach QA', player_name: null, role: 'admin', must_change_password: false }
    : { id: 'profile-player', email: 'player8@example.test', full_name: 'Player Eight', player_name: 'Player 8', role: 'player', must_change_password: false };

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

  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const body = bodyOf(req);
    const json = value => ({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    let response;
    if (path === '/api/config') response = json({ supabaseUrl: 'https://fake.supabase.test', publishableKey: 'qa-public-key' });
    else if (path === '/api/session') response = json({ profile });
    else if (path === '/api/records') response = json({ rows: [], count: 0 });
    else if (path === '/api/users') response = json({ profiles: [] });
    else if (path === '/api/ladder') response = json(ladderPayload(role));
    else if (path === '/api/challenges' && req.method() === 'GET') {
      const defaultChallenges = role === 'admin' ? [pendingApproval()] : [];
      response = json({ challenges: options.challenges ?? defaultChallenges });
    } else if (path === '/api/challenges' && req.method() === 'POST') {
      if (options.writeDelayMs) await new Promise(resolve => setTimeout(resolve, options.writeDelayMs));
      response = options.failChallengePost
        ? { status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'An active challenge already exists.' }) }
        : { status: 201, contentType: 'application/json', body: JSON.stringify({ challengeId: 'challenge-new' }) };
    } else if (path === '/api/challenges' && req.method() === 'PATCH') response = json({ ok: true });
    else if (path === '/api/match-score') {
      if (options.writeDelayMs) await new Promise(resolve => setTimeout(resolve, options.writeDelayMs));
      response = { status: 201, contentType: 'application/json', body: JSON.stringify({ matchId: 'match-new', approvalStatus: 'pending' }) };
    } else if (path === '/api/admin/verify-match') response = json({ ok: true });
    else if (path === '/api/admin/ladder') {
      if (options.failStatusMutation && body.action === 'status') {
        response = { status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'This player status could not be changed.' }) };
      } else response = json({ ok: true });
    } else if (path === '/api/admin/seed-ladder') response = { status: 201, contentType: 'application/json', body: JSON.stringify({ seeded: 8 }) };
    else response = { status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled QA route ${path}` }) };
    await route.fulfill(response);
  });
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width + 2);
}

async function expectMinHeight(locator, minimum = 44) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(minimum);
}

test('player sees official ladder and can issue an eligible challenge exactly once', async ({ page }) => {
  const pageErrors = [];
  const challengePosts = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/challenges' && request.method() === 'POST') challengePosts.push(request);
  });
  await installMocks(page, 'player', { writeDelayMs: 120 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#authGate')).toBeHidden();
  await expect(page.locator('#ladderExperience')).toBeVisible();
  await expect(page.locator('#ladderBoardTitle')).toContainText('Boys singles');
  await expect(page.locator('.ladder-challenge-button')).toHaveCount(3);
  await expect(page.locator('.ladder-row[data-player-id="p5"] .ladder-challenge-button')).toBeVisible();
  await expect(page.locator('.ladder-row[data-player-id="p6"] .ladder-challenge-button')).toBeVisible();
  await expect(page.locator('.ladder-row[data-player-id="p7"] .ladder-challenge-button')).toBeVisible();

  await page.locator('.ladder-row[data-player-id="p7"] .ladder-challenge-button').click();
  await expect(page.locator('#challengeDialog')).toBeVisible();
  const timeInput = page.locator('input[name="time1"]');
  await expect(timeInput).toHaveAttribute('min', /T\d{2}:\d{2}$/);
  await timeInput.fill(futureLocal());
  const challengeRequest = apiRequest(page, '/api/challenges', (request, body) => request.method() === 'POST' && body.defenderPlayerId === 'p7');
  await page.locator('#challengeCreateForm').evaluate(form => {
    form.requestSubmit();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  const challenge = await challengeRequest;
  expect(bodyOf(challenge).defenderPlayerId).toBe('p7');
  await expect(page.locator('#challengeDialog')).not.toBeVisible();
  expect(challengePosts).toHaveLength(1);

  await assertNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
});

test('challenge server errors stay inline and the form becomes usable again', async ({ page }) => {
  await installMocks(page, 'player', { failChallengePost: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('.ladder-row[data-player-id="p7"] .ladder-challenge-button').click();
  await page.locator('input[name="time1"]').fill(futureLocal());
  const submit = page.locator('#challengeCreateForm button[type="submit"]');
  await submit.click();
  await expect(page.locator('#challengeFormStatus')).toContainText('active challenge');
  await expect(page.locator('#challengeFormStatus')).toHaveClass(/error/);
  await expect(submit).toBeEnabled();
  await expect(page.locator('#challengeDialog')).toBeVisible();
});

test('score entry matches backend winner-perspective validation before sending', async ({ page }) => {
  let scorePosts = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/match-score' && request.method() === 'POST') scorePosts += 1;
  });
  await installMocks(page, 'player', { challenges: [scheduledChallenge()] });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-challenge-action="score"]').click();
  const score = page.locator('#challengeScoreForm [name="scoreSummary"]');
  await score.fill('4-6, 6-4, 8-10');
  await page.locator('#challengeScoreForm button[type="submit"]').click();
  await expect(page.locator('#challengeFormStatus')).toContainText(/winner.s perspective/i);
  expect(scorePosts).toBe(0);

  await score.fill('6-4, 4-6, 10-8');
  const request = apiRequest(page, '/api/match-score', request => request.method() === 'POST');
  await page.locator('#challengeScoreForm button[type="submit"]').click();
  await request;
  expect(scorePosts).toBe(1);
});

test('coach sees approval queue and roster controls', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installMocks(page, 'admin');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#coachLadderConsole')).toBeVisible();
  await expect(page.locator('[data-coach-panel="approvals"]')).toContainText('Player 8 vs Player 6');
  await expect(page.locator('[data-verify="approve"]')).toBeVisible();
  const approveRequest = apiRequest(page, '/api/admin/verify-match', (request, body) => request.method() === 'POST' && body.action === 'approve');
  await page.locator('[data-verify="approve"]').click();
  const approve = await approveRequest;
  expect(bodyOf(approve).matchId).toBe('match-1');

  const approvalsTab = page.locator('[data-coach-tab="approvals"]');
  await approvalsTab.focus();
  await approvalsTab.press('ArrowRight');
  await expect(page.locator('[data-coach-tab="roster"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-coach-panel="roster"]')).toBeVisible();

  const p3 = page.locator('[data-roster-player="p3"]');
  const statusRequest = apiRequest(page, '/api/admin/ladder', (request, body) => request.method() === 'PATCH' && body.action === 'status' && body.playerId === 'p3');
  await p3.locator('[data-status]').selectOption('injured');
  const status = await statusRequest;
  expect(bodyOf(status).status).toBe('injured');

  await expect(page.locator('[data-coach-panel="roster"]')).toBeVisible();
  const p4 = page.locator('[data-roster-player="p4"]');
  await p4.locator('[data-new-rank]').fill('2');
  const moveRequest = apiRequest(page, '/api/admin/ladder', (request, body) => request.method() === 'PATCH' && body.action === 'move' && body.playerId === 'p4');
  await p4.locator('[data-move]').click();
  const move = await moveRequest;
  expect(bodyOf(move).newRank).toBe(2);

  await assertNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
});

test('failed coach status mutation reverts the control and unlocks the roster', async ({ page }) => {
  await installMocks(page, 'admin', { failStatusMutation: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-coach-tab="roster"]').click();
  const row = page.locator('[data-roster-player="p3"]');
  const select = row.locator('[data-status]');
  await expect(select).toHaveValue('active');
  await select.selectOption('injured');
  await expect(page.locator('#tennisrankWorkflowToast')).toContainText('could not be changed');
  await expect(select).toHaveValue('active');
  await expect(select).toBeEnabled();
  await expect(row.locator('[data-move]')).toBeEnabled();
  await expect(page.locator('#coachLadderConsole')).toHaveAttribute('aria-busy', 'false');
});

test('invalid manual rank is blocked locally instead of sending a broken request', async ({ page }) => {
  let moveRequests = 0;
  page.on('request', request => {
    const body = bodyOf(request);
    if (new URL(request.url()).pathname === '/api/admin/ladder' && request.method() === 'PATCH' && body.action === 'move') moveRequests += 1;
  });
  await installMocks(page, 'admin');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-coach-tab="roster"]').click();
  const row = page.locator('[data-roster-player="p4"]');
  const input = row.locator('[data-new-rank]');
  await input.fill('99');
  await row.locator('[data-move]').click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#tennisrankWorkflowToast')).toContainText(/rank from 1 to 8/i);
  expect(moveRequests).toBe(0);
});

test('mobile ladder and challenge controls remain usable at 390px and 320px', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await installMocks(page, 'player');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#ladderExperience')).toBeVisible();
    await expect(page.locator('#challengeCenter')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    const buttons = page.locator('.ladder-challenge-button');
    for (let index = 0; index < await buttons.count(); index += 1) await expectMinHeight(buttons.nth(index));
    await buttons.last().click();
    await expectMinHeight(page.locator('.challenge-dialog-close'));
    await expectMinHeight(page.locator('#challengeCreateForm button[type="submit"]'));
    await expectMinHeight(page.locator('#challengeCreateForm [data-close-dialog]'));
    await assertNoHorizontalOverflow(page);
  }
});
