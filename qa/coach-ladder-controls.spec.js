const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:4173/qa-ai-index.html';
const SUPABASE = 'https://fake.supabase.test';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeEntry(id, name, team, rank) {
  return {
    id: `entry-${id}`,
    player_id: id,
    team_gender: team,
    rank_position: rank,
    previous_rank_position: rank,
    status: 'available',
    player: {
      id,
      display_name: name,
      active_status: 'active',
      profile_id: null,
      division: 'varsity',
    },
  };
}

async function installStatefulBackend(page) {
  const profile = {
    id: 'coach-controls',
    email: 'coach-controls@example.test',
    full_name: 'Coach Controls',
    player_name: null,
    role: 'admin',
    must_change_password: false,
  };

  const state = {
    ladder: [
      makeEntry('b1', 'Noah Williams', 'boys', 1),
      makeEntry('b2', 'Liam Chen', 'boys', 2),
      makeEntry('b3', 'Ethan Kim', 'boys', 3),
      makeEntry('g1', 'Ava Patel', 'girls', 1),
      makeEntry('g2', 'Mia Rodriguez', 'girls', 2),
    ],
    moveRequests: 0,
    statusRequests: 0,
    failNextMove: false,
    failNextStatus: false,
    failNextLadderRead: false,
  };

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

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/config') return ok({ supabaseUrl: SUPABASE, publishableKey: 'qa-public-key' });
    if (path === '/api/session') return ok({ profile });
    if (path === '/api/records') return ok({ rows: [], count: 0, snapshots: [] });
    if (path === '/api/users') return ok({ profiles: [], roster: [] });
    if (path === '/api/challenges') return ok({ challenges: [] });

    if (path === '/api/ladder') {
      if (state.failNextLadderRead) {
        state.failNextLadderRead = false;
        return ok({ error: 'simulated ladder refresh failure' }, 503);
      }
      return ok({
        ladder: clone(state.ladder),
        settings: [
          { team_gender: 'boys', max_challenge_distance: 3 },
          { team_gender: 'girls', max_challenge_distance: 3 },
        ],
        viewer: { profileId: profile.id, role: 'admin' },
        needsAttention: {}, teamStatus: {}, audit: [], undoCandidates: [], missingAccounts: [], importWarnings: [],
      });
    }

    if (path === '/api/admin/ladder' && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      if (body.action === 'move') {
        state.moveRequests += 1;
        await new Promise(resolve => setTimeout(resolve, 120));
        if (state.failNextMove) {
          state.failNextMove = false;
          return ok({ error: 'simulated move rejection' }, 409);
        }
        const target = state.ladder.find(entry => entry.player_id === body.playerId);
        if (!target) return ok({ error: 'Player not found' }, 404);
        const team = state.ladder.filter(entry => entry.team_gender === target.team_gender).sort((a, b) => a.rank_position - b.rank_position);
        const newRank = Number(body.newRank);
        if (!Number.isInteger(newRank) || newRank < 1 || newRank > team.length) return ok({ error: 'New rank is outside the ladder' }, 400);
        const oldRank = target.rank_position;
        if (newRank < oldRank) {
          team.filter(entry => entry.player_id !== target.player_id && entry.rank_position >= newRank && entry.rank_position < oldRank)
            .forEach(entry => { entry.previous_rank_position = entry.rank_position; entry.rank_position += 1; });
        } else if (newRank > oldRank) {
          team.filter(entry => entry.player_id !== target.player_id && entry.rank_position > oldRank && entry.rank_position <= newRank)
            .forEach(entry => { entry.previous_rank_position = entry.rank_position; entry.rank_position -= 1; });
        }
        target.previous_rank_position = oldRank;
        target.rank_position = newRank;
        return ok({ ok: true, action: 'move' });
      }

      if (body.action === 'status') {
        state.statusRequests += 1;
        await new Promise(resolve => setTimeout(resolve, 100));
        if (state.failNextStatus) {
          state.failNextStatus = false;
          return ok({ error: 'simulated status rejection' }, 409);
        }
        const target = state.ladder.find(entry => entry.player_id === body.playerId);
        if (!target) return ok({ error: 'Player not found' }, 404);
        if (!['active', 'injured', 'inactive'].includes(body.status)) return ok({ error: 'Invalid player status' }, 400);
        target.player.active_status = body.status;
        target.status = body.status === 'active' ? 'available' : 'injury_hold';
        return ok({ ok: true, action: 'status' });
      }
      return ok({ error: 'Unsupported admin ladder action' }, 400);
    }

    if (path === '/api/admin/seed-ladder') return ok({ seeded: 0 }, 201);
    return ok({ error: `Unhandled QA route ${path}` }, 404);
  });

  return state;
}

async function openRosterControls(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#coachLadderConsole')).toBeVisible();
  await page.locator('[data-coach-tab="roster"]').click();
  await expect(page.locator('[data-coach-panel="roster"]')).toBeVisible();
}

function rowFor(page, playerId) {
  return page.locator(`[data-roster-player="${playerId}"]`);
}

test('coach move shifts ranks once, survives reload, rejects invalid input, and reverts a failed move', async ({ page }) => {
  const state = await installStatefulBackend(page);
  await openRosterControls(page);

  const ethan = rowFor(page, 'b3');
  await expect(ethan.locator('.coach-rank-number')).toHaveText('#3');

  await ethan.locator('[data-new-rank]').fill('9');
  await ethan.locator('[data-move]').click();
  await expect(ethan.locator('[data-new-rank]')).toHaveAttribute('aria-invalid', 'true');
  expect(state.moveRequests).toBe(0);
  await expect(page.locator('#tennisrankWorkflowToast')).toContainText('rank from 1 to 3');

  await ethan.locator('[data-new-rank]').fill('1');
  await ethan.locator('[data-move]').evaluate(button => { button.click(); button.click(); });
  await expect.poll(() => state.moveRequests).toBe(1);
  await expect.poll(() => state.ladder.find(entry => entry.player_id === 'b3').rank_position).toBe(1);

  await expect(rowFor(page, 'b3').locator('.coach-rank-number')).toHaveText('#1');
  await expect(rowFor(page, 'b1').locator('.coach-rank-number')).toHaveText('#2');
  await expect(rowFor(page, 'b2').locator('.coach-rank-number')).toHaveText('#3');
  await expect(page.locator('#coachLadderConsole')).toHaveAttribute('aria-busy', 'false');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#coachLadderConsole')).toBeVisible();
  await page.locator('[data-coach-tab="roster"]').click();
  await expect(rowFor(page, 'b3').locator('.coach-rank-number')).toHaveText('#1');

  state.failNextMove = true;
  const noah = rowFor(page, 'b1');
  await noah.locator('[data-new-rank]').fill('3');
  await noah.locator('[data-move]').click();
  await expect.poll(() => state.moveRequests).toBe(2);
  await expect(noah.locator('[data-new-rank]')).toHaveValue('2');
  await expect(page.locator('#coachLadderConsole')).toHaveAttribute('aria-busy', 'false');
});

test('injured status persists, restores active, rolls back rejection, and never leaves controls locked', async ({ page }) => {
  const state = await installStatefulBackend(page);
  await openRosterControls(page);

  const liam = rowFor(page, 'b2');
  const status = liam.locator('[data-status]');
  await status.focus();
  await status.selectOption('injured');
  await expect.poll(() => state.statusRequests).toBe(1);
  await expect.poll(() => state.ladder.find(entry => entry.player_id === 'b2').player.active_status).toBe('injured');
  await expect(rowFor(page, 'b2').locator('[data-status]')).toHaveValue('injured');
  await expect(rowFor(page, 'b2').locator('.coach-roster-meta')).toContainText('injured');
  await expect(page.locator('#coachLadderConsole')).toHaveAttribute('aria-busy', 'false');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-coach-tab="roster"]').click();
  await expect(rowFor(page, 'b2').locator('[data-status]')).toHaveValue('injured');
  await expect(rowFor(page, 'b2').locator('.coach-roster-meta')).toContainText('injured');

  await rowFor(page, 'b2').locator('[data-status]').focus();
  await rowFor(page, 'b2').locator('[data-status]').selectOption('active');
  await expect.poll(() => state.statusRequests).toBe(2);
  await expect.poll(() => state.ladder.find(entry => entry.player_id === 'b2').player.active_status).toBe('active');
  await expect(rowFor(page, 'b2').locator('[data-status]')).toHaveValue('active');

  state.failNextStatus = true;
  const noah = rowFor(page, 'b1');
  await noah.locator('[data-status]').focus();
  await noah.locator('[data-status]').selectOption('injured');
  await expect.poll(() => state.statusRequests).toBe(3);
  await expect(noah.locator('[data-status]')).toHaveValue('active');
  await expect(noah.locator('[data-status]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#coachLadderConsole')).toHaveAttribute('aria-busy', 'false');

  state.failNextLadderRead = true;
  await noah.locator('[data-status]').focus();
  await noah.locator('[data-status]').selectOption('injured');
  await expect.poll(() => state.statusRequests).toBe(4);
  await expect.poll(() => state.ladder.find(entry => entry.player_id === 'b1').player.active_status).toBe('injured');
  await expect.poll(async () => page.evaluate(() => window.TennisRankCoachState?.isRefreshing?.())).toBe(false, { timeout: 4000 });
  await expect(page.locator('#coachLadderConsole')).toHaveAttribute('aria-busy', 'false');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-coach-tab="roster"]').click();
  await expect(rowFor(page, 'b1').locator('[data-status]')).toHaveValue('injured');
});

test('coach ladder controls use the same flat cream/orange visual system', async ({ page }) => {
  await installStatefulBackend(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRosterControls(page);

  const visual = await page.locator('#coachLadderConsole').evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    radius: getComputedStyle(el).borderRadius,
    tabBackground: getComputedStyle(el.querySelector('[data-coach-tab="roster"][aria-selected="true"]')).backgroundColor,
    rankColor: getComputedStyle(el.querySelector('.coach-rank-number')).color,
    inputRadius: getComputedStyle(el.querySelector('[data-new-rank]')).borderRadius,
  }));

  expect(visual.background).toBe('rgba(0, 0, 0, 0)');
  expect(visual.radius).toBe('0px');
  expect(visual.tabBackground).toBe('rgb(255, 118, 87)');
  expect(visual.rankColor).toBe('rgb(216, 73, 43)');
  expect(visual.inputRadius).toBe('0px');
});
