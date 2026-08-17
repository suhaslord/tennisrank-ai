const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:4173/';

test('ranking, import sync, and player dashboard modules load together', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ supabaseUrl: 'https://example.supabase.co', publishableKey: 'test-key' }),
  }));

  await page.goto(APP_URL);
  await expect(page.locator('#authGate')).toBeVisible();

  const loaded = await page.evaluate(() => ({
    ranking: Boolean(window.TennisRankRankingPolicy),
    importSync: Boolean(window.TennisRankImportAutoSync),
    playerDashboard: Boolean(window.TennisRankPlayerDashboard),
    playerInsights: Boolean(window.TennisRankPlayerInsights),
    calculateWrapped: Boolean(window.calculateRankings?.__coachRankingPolicy),
  }));
  expect(loaded).toEqual({ ranking: true, importSync: true, playerDashboard: true, playerInsights: true, calculateWrapped: true });

  const ordered = await page.evaluate(() => window.TennisRankRankingPolicy.sortRankings([
    { name: 'Losing Player', wins: 1, losses: 2 },
    { name: 'New Player', wins: 0, losses: 0 },
    { name: 'Winning Player', wins: 2, losses: 1 },
  ]).map(player => player.name));
  expect(ordered).toEqual(['Winning Player', 'New Player', 'Losing Player']);
});

test('linked player sees persistent official rank, momentum, recent form, JV and grade', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const profile = {
    id: 'profile-player',
    email: 'player@example.test',
    full_name: 'Player QA',
    player_name: 'Player QA',
    role: 'player',
    must_change_password: false,
  };

  await page.addInitScript(({ profile }) => {
    localStorage.setItem('tennisRankAuthSessionV1', JSON.stringify({
      access_token: 'qa-access',
      refresh_token: 'qa-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: profile.id, email: profile.email },
    }));
  }, { profile });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/config') return reply({ supabaseUrl: 'https://example.supabase.co', publishableKey: 'test-key' });
    if (path === '/api/session') return reply({ profile });
    if (path === '/api/records') return reply({
      rows: [
        { Name: 'Player QA', Gender: 'Boys', Division: 'Singles' },
        { Gender: 'Boys', Division: 'Singles', 'Player 1': 'Player QA', 'Player 2': 'Opponent QA', Winner: 'Player QA', Loser: 'Opponent QA', Score: '6-3', Date: '2026-08-16' },
        { Gender: 'Boys', Division: 'Singles', 'Player 1': 'Player QA', 'Player 2': 'Second QA', Winner: 'Second QA', Loser: 'Player QA', Score: '7-5', Date: '2026-08-15' },
        { Gender: 'Boys', Division: 'Singles', 'Player 1': 'Player QA', 'Player 2': 'Third QA', Winner: 'Player QA', Loser: 'Third QA', Score: '6-2', Date: '2026-08-14' },
      ],
      count: 4,
    });
    if (path === '/api/ladder') return reply({
      ladder: [
        {
          player_id: 'opponent-id', team_gender: 'boys', rank_position: 1, previous_rank_position: 1, status: 'available',
          player: { id: 'opponent-id', profile_id: null, display_name: 'Opponent QA', team_gender: 'boys', grade_level: 11, division: 'varsity', active_status: 'active' },
        },
        {
          player_id: 'player-id', team_gender: 'boys', rank_position: 2, previous_rank_position: 4, status: 'available',
          player: { id: 'player-id', profile_id: profile.id, display_name: 'Player QA', team_gender: 'boys', grade_level: 10, division: 'jv', active_status: 'active' },
        },
      ],
      settings: [{ team_gender: 'boys', max_challenge_distance: 3 }],
      rankHistory: [
        { id: 'h1', old_rank: 5, new_rank: 4, reason: 'import_sync', challenge_match_id: null, changed_at: '2026-08-01T00:00:00Z' },
        { id: 'h2', old_rank: 4, new_rank: 2, reason: 'challenge_result', challenge_match_id: 'm1', changed_at: '2026-08-16T00:00:00Z' },
      ],
      viewer: { profileId: profile.id, role: 'player', playerName: 'Player QA', playerId: 'player-id', teamGender: 'boys', rosterDivision: 'jv', gradeLevel: 10, linkState: 'direct' },
    });
    if (path === '/api/challenges') return reply({ challenges: [], linkedPlayer: { id: 'player-id' }, linkState: 'direct' });
    if (path === '/api/users') return reply({ profiles: [] });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled QA route ${path}` }) });
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#playerDashboard')).toBeVisible();
  await expect(page.locator('#playerIdentityStrip')).toContainText('Official singles rank');
  await expect(page.locator('#playerIdentityStrip')).toContainText('#2');
  await expect(page.locator('#playerIdentityStrip')).toContainText('JV');
  await expect(page.locator('#playerIdentityStrip')).toContainText('Grade 10');
  await expect(page.locator('#playerStatGrid .player-stat').nth(2).locator('strong')).toHaveText('#2');

  const insights = page.locator('#playerSeasonInsights');
  await expect(insights).toBeVisible({ timeout: 12000 });
  await expect(insights).toContainText('Current rank');
  await expect(insights).toContainText('Season start');
  await expect(insights).toContainText('Best rank');
  await expect(insights).toContainText('Season movement');
  await expect(insights).toContainText('#5');
  await expect(insights).toContainText('#2');
  await expect(insights).toContainText('↑ 3');
  await expect(insights.locator('.rank-chart')).toBeVisible();
  await expect(insights.locator('.form-chip.win')).toHaveCount(2);
  await expect(insights.locator('.form-chip.loss')).toHaveCount(1);
  await expect(insights).toContainText('2-1 last 3');
  await expect(insights).toContainText('Challenge result');
  await expect(insights).toContainText('Spreadsheet import');

  await page.waitForTimeout(300);
  await expect(page.locator('#playerStatGrid .player-stat').nth(2).locator('strong')).toHaveText('#2');
  expect(pageErrors).toEqual([]);
});
