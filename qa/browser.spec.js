const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/index.html';

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
        display_name: `Player ${rank}`,
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

async function installMocks(page, role) {
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
    const json = value => ({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    let response;
    if (path === '/api/config') response = json({ supabaseUrl: 'https://fake.supabase.test', publishableKey: 'qa-public-key' });
    else if (path === '/api/session') response = json({ profile });
    else if (path === '/api/records') response = json({ rows: [], count: 0 });
    else if (path === '/api/users') response = json({ profiles: [] });
    else if (path === '/api/ladder') response = json(ladderPayload(role));
    else if (path === '/api/challenges' && req.method() === 'GET') response = json({ challenges: role === 'admin' ? [pendingApproval()] : [] });
    else if (path === '/api/challenges' && req.method() === 'POST') response = { status: 201, contentType: 'application/json', body: JSON.stringify({ challengeId: 'challenge-new' }) };
    else if (path === '/api/challenges' && req.method() === 'PATCH') response = json({ ok: true });
    else if (path === '/api/match-score') response = { status: 201, contentType: 'application/json', body: JSON.stringify({ matchId: 'match-new', approvalStatus: 'pending' }) };
    else if (path === '/api/admin/verify-match') response = json({ ok: true });
    else if (path === '/api/admin/ladder') response = json({ ok: true });
    else if (path === '/api/admin/seed-ladder') response = { status: 201, contentType: 'application/json', body: JSON.stringify({ seeded: 8 }) };
    else response = { status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled QA route ${path}` }) };
    await route.fulfill(response);
  });
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width + 2);
}

test('player sees official ladder and can issue an eligible challenge', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installMocks(page, 'player');
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
  await page.locator('input[name="time1"]').fill('2026-08-20T16:00');
  const challengeRequest = apiRequest(page, '/api/challenges', (request, body) => request.method() === 'POST' && body.defenderPlayerId === 'p7');
  await page.locator('#challengeCreateForm button[type="submit"]').click();
  const challenge = await challengeRequest;
  expect(bodyOf(challenge).defenderPlayerId).toBe('p7');
  await expect(page.locator('#challengeDialog')).not.toBeVisible();

  await assertNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
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

  await page.locator('[data-coach-tab="roster"]').click();
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

test('mobile ladder and challenge center do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMocks(page, 'player');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#ladderExperience')).toBeVisible();
  await expect(page.locator('#challengeCenter')).toBeVisible();
  await assertNoHorizontalOverflow(page);
});
