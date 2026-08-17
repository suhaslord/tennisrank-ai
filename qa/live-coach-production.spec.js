const { test, expect } = require('@playwright/test');
const BASE = process.env.BASE_URL;
const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD;
const BASELINE = process.env.BASELINE_SNAPSHOT_ID;
const HIGH_EMAIL = 'qa-defender-tennisrank-20260816@example.com';
const LOW_EMAIL = 'qa-challenger-tennisrank-20260816@example.com';
const HIGH_TEMP = 'QA-Defender-TR-2026!';
const LOW_TEMP = 'QA-Challenger-TR-2026!';
const HIGH_NEW = 'QA-Defender-TR-2026!New';
const LOW_NEW = 'QA-Challenger-TR-2026!New';

const cell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
};
const csv = rows => rows.map(r => r.map(cell).join(',')).join('\n');

const chaosCsv = csv([
  ['RIHS TENNIS — CHAOS MASTER IMPORT','','','','','','','','','',''],
  ['Deliberately ugly coach-style sheet: title rows, odd headers, mixed dates, noise columns and mixed singles/doubles.','','','','','','','','','',''],
  ['ATHLETE / TEAM','VS / OTHER SIDE','W-L?','SET LINE','SQUAD','EVENT-ish','PLAYED','Court','Coach note','','Import flag?'],
  ['Aiden Shah','Leo Kim','W','6-3, 6-4','Boys','Singles','2026-08-04','1','steady baseline','','keep'],
  ['Maya Lee','Zoe Rivera','L','4-6, 6-3, 8-10','Girls','Singles','8/4/2026','2','close match','','yes'],
  ['Ravi Patel','Noah Chen','W','7-6, 6-2','Boys','Singles','Aug 5 2026','3','','','TRUE'],
  ['Priya Nair','Ava Thompson','W','6-1, 6-2','Girls','Singles','2026-08-05','4','dominant','','1'],
  ['Leo Kim','Mateo Ruiz','W','6-4, 3-6, 10-7','Boys','Singles','2026-08-06','1','match tiebreak','','Y'],
  ['Zoe Rivera','Sofia Garcia','W','6-2, 6-4','Girls','Singles','08/06/26','2','','','publish'],
  ['Noah Chen','Ethan Park','L','5-7, 2-6','Boys','Singles','2026-08-07','3','late start','','ok'],
  ['Ava Thompson','Lily Nguyen','W','7-5, 6-3','Girls','Singles','7 Aug 2026','4','','','yes'],
  ['Mateo Ruiz','Daniel Brooks','W','6-0, 6-2','Boys','Singles','2026/08/08','1','','','go'],
  ['Sofia Garcia','Emma Wilson','L','3-6, 6-7','Girls','Singles','2026-08-08','2','','','keep'],
  ['Ethan Park','Omar Khan','W','8-6','Boys','Singles','8-9-2026','3','legacy pro set','','keep'],
  ['Lily Nguyen','Chloe Martin','W','6-4, 6-4','Girls','Singles','09-Aug-2026','4','','','keep'],
  ['Aiden Shah / Leo Kim','Ravi Patel / Noah Chen','W','6-4, 7-5','Boys','Doubles','2026-08-10','1','team string','','keep'],
  ['Maya Lee & Zoe Rivera','Priya Nair & Ava Thompson','L','3-6, 6-4, 7-10','Girls','Doubles','2026-08-10','2','ampersand teams','','keep'],
  ['Mateo Ruiz + Ethan Park','Daniel Brooks + Omar Khan','W','6-2, 6-3','Boys','2v2','Aug 11, 2026','3','','','keep'],
  ['Sofia Garcia / Lily Nguyen','Emma Wilson / Chloe Martin','W','7-6, 6-4','Girls','Doubles','11/08/2026','4','day/month ambiguity','','keep'],
]);

const recoveryCsv = csv([
  ['QA RECOVERY ROSTER — title row','','','','','','','',''],
  ['Name','Gender','Division','Player 1','Player 2','Winner','Loser','Score','Date'],
  ['QA Winner','Boys','Singles','','','','','',''],
  ['QA Second','Boys','Singles','','','','','',''],
  ['QA Zero','Boys','Singles','','','','','',''],
  ['QA Loser','Boys','Singles','','','','','',''],
  ['QA Girl Winner','Girls','Singles','','','','','',''],
  ['QA Girl Zero','Girls','Singles','','','','','',''],
  ['QA Girl Loser','Girls','Singles','','','','','',''],
  ['QA Pair One & QA Pair Two','Boys','Doubles','','','','','',''],
  ['QA Pair Three & QA Pair Four','Girls','Doubles','','','','','',''],
  ['','Boys','Singles','QA Winner','QA Loser','QA Winner','QA Loser','6-2','2026-08-16'],
  ['','Boys','Singles','QA Second','QA Loser','QA Second','QA Loser','6-3','2026-08-16'],
  ['','Girls','Singles','QA Girl Winner','QA Girl Loser','QA Girl Winner','QA Girl Loser','6-1','2026-08-16'],
  ['','Boys','Doubles','QA Pair One & QA Pair Two','QA Bench One & QA Bench Two','QA Pair One & QA Pair Two','QA Bench One & QA Bench Two','8-4','2026-08-16'],
  ['','Girls','Doubles','QA Pair Three & QA Pair Four','QA Bench Three & QA Bench Four','QA Pair Three & QA Pair Four','QA Bench Three & QA Bench Four','8-5','2026-08-16'],
]);

const equipmentCsv = csv([
  ['EQUIPMENT INVENTORY — NOT TENNIS RESULTS','','','','',''],
  ['TennisRank should reject or ignore this data rather than hallucinating rankings.','','','','',''],
  ['Item','Count','Storage','Condition','Replacement Cost','Last Checked'],
  ['Tennis balls','144','Shed A','Good','129.99','2026-08-01'],
  ['Practice rackets','18','Locker 2','Mixed','540','2026-07-30'],
  ['Cones','36','Shed B','Good','72','2026-08-02'],
  ['First aid kits','3','Coach office','Good','135','2026-08-01'],
]);
const badCsv = 'hello,world\nnot,tennis\n42,99\n';

async function login(page, email, password, newPassword) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.locator('#loginButton').click();
  if (newPassword) {
    const pw = page.locator('#passwordForm');
    if (await pw.isVisible({ timeout: 4000 }).catch(() => false)) {
      await page.locator('#newPassword').fill(newPassword);
      await page.locator('#passwordButton').click();
    }
  }
  await expect(page.locator('#appShell')).toBeVisible({ timeout: 15000 });
}
async function logout(page) {
  await page.locator('#accountMenu').click();
  await expect(page.locator('#authGate')).toBeVisible({ timeout: 10000 });
}
async function api(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const r = await window.TennisRankAuth.fetch(path, options);
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  }, { path, options });
}
async function uploadCsvAndPreview(page, name, content) {
  await page.locator('#tabCsv').click();
  await page.locator('#csvFile').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) });
  await expect(page.locator('#importPreviewModal')).toBeVisible({ timeout: 20000 });
  return page.locator('#importPreviewBody').innerText();
}
async function publishPreview(page) {
  await page.locator('[data-preview-confirm]').click();
  await expect(page.locator('#importPreviewModal')).toBeHidden({ timeout: 15000 });
  await page.waitForTimeout(1200);
}
async function createPlayerAccount(page, playerId, email, password) {
  await expect(page.locator('#inviteRosterPlayer')).toBeVisible({ timeout: 12000 });
  await page.locator('#inviteRosterPlayer').selectOption(playerId);
  const name = await page.locator('#inviteFullName').inputValue();
  if (!name) await page.locator('#inviteFullName').fill('QA Player');
  await page.locator('#inviteEmail').fill(email);
  await page.locator('#invitePassword').fill(password);
  await page.locator('#inviteButton').click();
  await expect(page.locator('#inviteStatus')).toContainText(/Account created/i, { timeout: 15000 });
}
async function ranks(page, team='boys') {
  const out = await api(page, '/api/ladder');
  expect(out.status).toBe(200);
  return out.body.ladder.filter(x => x.team_gender === team).sort((a,b)=>a.rank_position-b.rank_position);
}
const rankMap = list => Object.fromEntries(list.map(x => [x.player_id, x.rank_position]));

test('live Coach Lokesh production dry run', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  page.on('dialog', d => d.accept());
  let adminLoggedIn = false;
  try {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    adminLoggedIn = true;
    await expect(page.locator('#rankingsSection')).toBeVisible();
    await expect(page.locator('#settingsPanel')).toBeVisible();
    await expect(page.locator('#accountsPanel')).toBeVisible();
    await expect(page.locator('#coachOpsDashboard')).toBeVisible({ timeout: 12000 });

    const baselineHistory = await api(page, '/api/records?mode=history');
    expect(baselineHistory.status).toBe(200);
    expect(baselineHistory.body.snapshots.some(x => x.id === BASELINE)).toBeTruthy();

    const preview = await uploadCsvAndPreview(page, 'Coach_Lokesh_Chaos_Master.csv', chaosCsv);
    expect(preview).toContain('Boys Singles');
    expect(preview).toContain('Girls Singles');
    expect(preview).toContain('Boys Doubles');
    expect(preview).toContain('Girls Doubles');
    await publishPreview(page);

    const messyCalc = await page.evaluate(async () => {
      const r = await window.TennisRankAuth.fetch('/api/records');
      const p = await r.json();
      return window.calculateRankings(p.rows).rankings;
    });
    expect(messyCalc.some(x => x.name === 'Aiden Shah / Leo Kim' && x.division === 'doubles')).toBeTruthy();
    expect(messyCalc.some(x => x.name === 'Mateo Ruiz + Ethan Park' && x.division === 'doubles')).toBeTruthy();
    expect(new Set(messyCalc.map(x => `${x.gender}|${x.division}`))).toEqual(new Set(['boys|singles','girls|singles','boys|doubles','girls|doubles']));

    const boys = await ranks(page, 'boys');
    expect(boys.length).toBeGreaterThanOrEqual(3);
    const high = boys[0];
    const low = boys[2];

    await createPlayerAccount(page, high.player_id, HIGH_EMAIL, HIGH_TEMP);
    await createPlayerAccount(page, low.player_id, LOW_EMAIL, LOW_TEMP);
    await logout(page);

    await login(page, LOW_EMAIL, LOW_TEMP, LOW_NEW);
    await expect(page.locator('#playerDashboard')).toBeVisible();
    await expect(page.locator('#settingsPanel')).toBeHidden();
    await expect(page.locator('#accountsPanel')).toBeHidden();
    await expect(page.locator('#coachLadderConsole')).toHaveCount(0);
    const challengeButton = page.locator(`.ladder-row[data-player-id="${high.player_id}"] .ladder-challenge-button`);
    await expect(challengeButton).toBeVisible({ timeout: 12000 });
    await challengeButton.click();
    const proposal = new Date(Date.now() + 48*60*60*1000).toISOString().slice(0,16);
    await page.locator('#challengeCreateForm input[name="time1"]').fill(proposal);
    await page.locator('#challengeCreateForm button[type="submit"]').click();
    await expect(page.locator('#challengeCenter')).toContainText(/pending response/i, { timeout: 12000 });

    const duplicate = await api(page, '/api/challenges', { method: 'POST', body: JSON.stringify({ defenderPlayerId: high.player_id, proposedTimes: [new Date(Date.now()+72*60*60*1000).toISOString()] }) });
    expect(duplicate.status).toBeGreaterThanOrEqual(400);
    await logout(page);

    await login(page, HIGH_EMAIL, HIGH_TEMP, HIGH_NEW);
    const accept = page.locator('[data-challenge-action="accept"]').first();
    await expect(accept).toBeVisible({ timeout: 12000 });
    await accept.click();
    const schedule = page.locator('[data-challenge-action="schedule"]').first();
    await expect(schedule).toBeVisible({ timeout: 12000 });
    await schedule.click();
    const scheduled = new Date(Date.now() + 49*60*60*1000).toISOString().slice(0,16);
    await page.locator('#challengeScheduleForm input[name="scheduledFor"]').fill(scheduled);
    await page.locator('#challengeScheduleForm input[name="courtLocation"]').fill('RIHS QA Court');
    await page.locator('#challengeScheduleForm button[type="submit"]').click();
    const score = page.locator('[data-challenge-action="score"]').first();
    await expect(score).toBeVisible({ timeout: 12000 });
    await score.click();
    await page.locator('#challengeScoreForm select[name="winnerPlayerId"]').selectOption(low.player_id);
    await page.locator('#challengeScoreForm textarea[name="scoreSummary"]').fill('6-4, 6-3');
    await page.locator('#challengeScoreForm button[type="submit"]').click();
    await expect(page.locator('#challengeCenter')).toContainText(/pending coach approval/i, { timeout: 12000 });
    await logout(page);

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    adminLoggedIn = true;
    const beforeApproval = rankMap(await ranks(page, 'boys'));
    const approve = page.locator('[data-verify="approve"]').first();
    await expect(approve).toBeVisible({ timeout: 12000 });
    await approve.click();
    await page.waitForTimeout(1000);
    const afterApproval = rankMap(await ranks(page, 'boys'));
    expect(afterApproval[low.player_id]).toBe(beforeApproval[high.player_id]);
    expect(afterApproval[high.player_id]).toBeGreaterThan(beforeApproval[high.player_id]);
    await expect(page.locator('[data-verify="approve"]')).toHaveCount(0);
    await page.locator('#refreshCoachOps').click();
    const undoChallenge = page.locator('#coachUndoList [data-undo-snapshot]').first();
    await expect(undoChallenge).toBeVisible({ timeout: 12000 });
    await undoChallenge.click();
    await page.waitForTimeout(1000);
    expect(rankMap(await ranks(page, 'boys'))).toEqual(beforeApproval);

    const invalidScore = await api(page, '/api/match-score', { method:'POST', body: JSON.stringify({ challengeId:'00000000-0000-0000-0000-000000000001', winnerPlayerId:high.player_id, scoreSummary:'6-6' }) });
    expect(invalidScore.status).toBe(400);

    const recoveryPreview = await uploadCsvAndPreview(page, 'QA_Roster_Recovery.csv', recoveryCsv);
    expect(recoveryPreview).toContain('Boys Singles');
    expect(recoveryPreview).toContain('Girls Singles');
    expect(recoveryPreview).toContain('Boys Doubles');
    expect(recoveryPreview).toContain('Girls Doubles');
    await publishPreview(page);
    const recoveryRankings = await page.evaluate(async () => {
      const r = await window.TennisRankAuth.fetch('/api/records');
      const p = await r.json();
      return window.calculateRankings(p.rows).rankings;
    });
    const zero = recoveryRankings.find(x => x.name === 'QA Zero' && x.gender === 'boys' && x.division === 'singles');
    const winner = recoveryRankings.find(x => x.name === 'QA Winner');
    const loser = recoveryRankings.find(x => x.name === 'QA Loser');
    expect(zero).toMatchObject({ wins: 0, losses: 0 });
    const boysRecovery = recoveryRankings.filter(x => x.gender==='boys' && x.division==='singles');
    expect(boysRecovery.indexOf(winner)).toBeLessThan(boysRecovery.indexOf(zero));
    expect(boysRecovery.indexOf(zero)).toBeLessThan(boysRecovery.indexOf(loser));
    expect(recoveryRankings.some(x => x.name === 'QA Pair One & QA Pair Two' && x.division === 'doubles')).toBeTruthy();
    expect(recoveryRankings.some(x => x.name === 'QA Pair Three & QA Pair Four' && x.division === 'doubles')).toBeTruthy();

    await page.locator('#refreshImportHistory').click();
    const restoreButton = page.locator('#importHistoryList [data-restore-import]').first();
    await expect(restoreButton).toBeVisible({ timeout: 12000 });
    await restoreButton.click();
    await page.waitForTimeout(1400);
    const afterRestore = await api(page, '/api/records');
    expect(afterRestore.status).toBe(200);
    expect(afterRestore.body.rows.some(r => JSON.stringify(r).includes('Aiden Shah'))).toBeTruthy();
    expect(afterRestore.body.rows.some(r => JSON.stringify(r).includes('QA Zero'))).toBeFalsy();

    const beforeManual = rankMap(await ranks(page, 'boys'));
    const third = (await ranks(page,'boys'))[2];
    await page.locator('[data-coach-tab="roster"]').click();
    const row = page.locator(`[data-roster-player="${third.player_id}"]`);
    await row.locator('[data-new-rank]').fill('1');
    await row.locator('[data-move]').click();
    await page.waitForTimeout(1000);
    expect(rankMap(await ranks(page,'boys'))[third.player_id]).toBe(1);
    await page.locator('#refreshCoachOps').click();
    const undoManual = page.locator('#coachUndoList [data-undo-snapshot]').first();
    await expect(undoManual).toBeVisible({ timeout: 12000 });
    await undoManual.click();
    await page.waitForTimeout(1000);
    expect(rankMap(await ranks(page,'boys'))).toEqual(beforeManual);

    const safeBefore = JSON.stringify((await api(page, '/api/records')).body.rows);
    await page.locator('#tabCsv').click();
    await page.locator('#csvFile').setInputFiles({ name:'IGNORE_Equipment.csv', mimeType:'text/csv', buffer:Buffer.from(equipmentCsv) });
    await page.waitForTimeout(3500);
    const equipmentModal = await page.locator('#importPreviewModal').isVisible().catch(()=>false);
    if (equipmentModal) {
      const text = await page.locator('#importPreviewBody').innerText();
      throw new Error(`Unrelated equipment data reached publish preview: ${text.slice(0,500)}`);
    }
    expect(JSON.stringify((await api(page, '/api/records')).body.rows)).toBe(safeBefore);
    await page.locator('#csvFile').setInputFiles({ name:'bad.csv', mimeType:'text/csv', buffer:Buffer.from(badCsv) });
    await page.waitForTimeout(2500);
    expect(await page.locator('#importPreviewModal').isVisible().catch(()=>false)).toBeFalsy();
    expect(JSON.stringify((await api(page, '/api/records')).body.rows)).toBe(safeBefore);
  } finally {
    try {
      if (!adminLoggedIn || !(await page.locator('#appShell').isVisible().catch(()=>false))) {
        await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      }
      await api(page, '/api/records', { method:'POST', body: JSON.stringify({ action:'restore', snapshotId: BASELINE }) });
    } catch (e) {
      console.error('FINAL_RESTORE_FAILED', e.message);
    }
  }
});
