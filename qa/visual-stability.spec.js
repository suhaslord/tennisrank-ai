const { test, expect } = require('@playwright/test');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4173/qa-index.html';

async function settleMotion(page) {
  await page.waitForTimeout(850);
}

async function expectNoHorizontalOverflow(page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.viewport + 2);
}

async function expectInsideViewport(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

async function expectVerticalOrder(page, selectors) {
  const boxes = [];
  for (const selector of selectors) boxes.push(await page.locator(selector).boundingBox());
  boxes.forEach(box => expect(box).not.toBeNull());
  for (let i = 1; i < boxes.length; i += 1) {
    expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1);
  }
}

async function expectTouchHeight(page, selector, minimum = 44) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(minimum);
}

async function css(page, selector, property) {
  return page.locator(selector).evaluate((node, prop) => getComputedStyle(node)[prop], property);
}

async function showApp(page, role = 'admin') {
  await page.evaluate(roleName => {
    document.body.classList.remove('auth-loading', 'role-player', 'role-admin');
    document.body.classList.add(roleName === 'admin' ? 'role-admin' : 'role-player');
    document.querySelector('#authGate').hidden = true;
    document.querySelector('#appShell').hidden = false;
    window.scrollTo(0, 0);
  }, role);
  await page.waitForTimeout(120);
}

async function showAdminImport(page) {
  await showApp(page, 'admin');
  await page.evaluate(() => document.querySelector('#settingsPanel').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(180);
}

async function expectLoginState(page) {
  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page.locator('#loginForm')).toBeVisible();
  await expect(page.locator('#passwordForm')).toBeHidden();
  await expect(page.locator('#bootstrapForm')).toBeHidden();
  await expect(page.locator('#appShell')).toBeHidden();
  await expect(page.locator('.cursor-ball')).toHaveCount(0);

  const cursors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).cursor,
    button: getComputedStyle(document.querySelector('#loginButton')).cursor,
    input: getComputedStyle(document.querySelector('#loginEmail')).cursor,
  }));
  expect(cursors.body).not.toBe('none');
  expect(cursors.button).toBe('pointer');
  expect(cursors.input).toBe('text');

  expect(await css(page, '.auth-card', 'backgroundColor')).toBe('rgb(255, 255, 255)');
  expect(await css(page, '#authTitle', 'color')).toBe('rgb(23, 26, 32)');
  expect(await css(page, '#loginButton', 'backgroundColor')).toBe('rgb(243, 107, 33)');
  expect(await css(page, '#authTitle', 'fontWeight')).toBe('500');
  expect(await css(page, '#authStatus', 'color')).toBe('rgb(92, 94, 98)');
  const visualBefore = await page.locator('.auth-visual').evaluate(node => getComputedStyle(node, '::before').display);
  expect(visualBefore).toBe('none');

  const imageLoaded = await page.locator('.auth-visual img').evaluate(img => img.complete && img.naturalWidth > 0);
  expect(imageLoaded).toBe(true);
  await expectVerticalOrder(page, ['#loginEmail', '#loginPassword', '#loginButton']);
  await expectTouchHeight(page, '#loginButton');
  await expectNoHorizontalOverflow(page);
}

test('desktop login is Tesla-clean with restrained staged motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await settleMotion(page);
  await expectLoginState(page);
  await expectInsideViewport(page, '#loginEmail');
  await expectInsideViewport(page, '#loginPassword');
  await expectInsideViewport(page, '#loginButton');
  expect(await page.locator('html').getAttribute('data-tr-motion')).toBe('enabled');
  await expect(page.locator('#authTitle')).toHaveClass(/tr-motion-item/);
  await expect(page.locator('#authTitle')).toHaveClass(/is-tr-visible/);
  expect(await css(page, '#authTitle', 'opacity')).toBe('1');
  await page.locator('#loginEmail').focus();
  expect(await css(page, '#loginEmail', 'outlineWidth')).not.toBe('0px');
  await page.screenshot({ path: 'qa-artifacts/login-desktop.png', fullPage: true });
});

test('login stays polished at 390px and 320px', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await settleMotion(page);
    await expectLoginState(page);
    await expectInsideViewport(page, '#loginEmail');
    await expectInsideViewport(page, '#loginPassword');
    await expectInsideViewport(page, '#loginButton');
    await expectInsideViewport(page, '.auth-card');
    if (width === 390) await page.screenshot({ path: 'qa-artifacts/login-mobile.png', fullPage: true });
  }
});

test('reduced-motion mode is effectively static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(80);
  expect(await page.locator('html').getAttribute('data-tr-motion')).toBe('reduced');
  expect(await css(page, '#authTitle', 'opacity')).toBe('1');
  expect(await css(page, '#authTitle', 'transform')).toBe('none');
  const duration = await css(page, '#authTitle', 'transitionDuration');
  const seconds = Math.max(...duration.split(',').map(value => parseFloat(value) || 0));
  expect(seconds).toBeLessThanOrEqual(0.001);
});

test('authenticated hero preserves Tesla photography and hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await showApp(page, 'admin');
  await settleMotion(page);
  await expect(page.locator('.hero-section')).toBeVisible();
  await expect(page.locator('.hero-section h1')).toContainText('Your season');
  expect(await css(page, '.hero-section h1', 'color')).toBe('rgb(255, 255, 255)');
  const photoLoaded = await page.locator('.hero-photo').evaluate(img => img.complete && img.naturalWidth > 0);
  expect(photoLoaded).toBe(true);
  expect(await page.locator('.hero-actions button').count()).toBeLessThanOrEqual(2);
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 120));
  await page.waitForTimeout(420);
  await expect(page.locator('.topbar')).toHaveClass(/is-scrolled/);
  expect(await css(page, '.topbar', 'backgroundColor')).toContain('255, 255, 255');
  await page.screenshot({ path: 'qa-artifacts/home-desktop.png', fullPage: false });
});

test('desktop import remains a white editorial workspace with stable motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await showAdminImport(page);
  await settleMotion(page);
  await expect(page.locator('#settingsPanel')).toBeVisible();
  await expect(page.locator('.import-compatibility')).toContainText('Excel');
  expect(await css(page, '#settingsPanel', 'backgroundColor')).toBe('rgb(255, 255, 255)');
  expect(await css(page, '#settingsPanel', 'color')).toBe('rgb(23, 26, 32)');
  expect(await css(page, '#analyzerCard', 'backgroundColor')).toBe('rgb(255, 255, 255)');
  expect(await css(page, '#connectSheet', 'backgroundColor')).toBe('rgb(243, 107, 33)');
  expect(await css(page, '#settingsPanel h2', 'fontWeight')).toBe('500');
  await expectTouchHeight(page, '#connectSheet');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'qa-artifacts/import-desktop.png', fullPage: true });
});

test('responsive matrix has no page-level overflow', async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 780 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await showAdminImport(page);
    await settleMotion(page);
    await expectInsideViewport(page, '#settingsPanel');
    await expectInsideViewport(page, '#sheetUrl');
    await expectInsideViewport(page, '#connectSheet');
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await showAdminImport(page);
  await settleMotion(page);
  await page.screenshot({ path: 'qa-artifacts/import-mobile.png', fullPage: true });
});

test('critical mobile navigation and controls meet touch target guidance', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await showApp(page, 'admin');
  await settleMotion(page);
  await expectTouchHeight(page, '#navHome');
  await expectTouchHeight(page, '#navRankings');
  await expectTouchHeight(page, '#navSettings');
  await expectNoHorizontalOverflow(page);
});

test('challenge dialog motion remains bounded and non-bouncy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.className = 'challenge-dialog';
    dialog.innerHTML = '<div class="challenge-dialog-inner"><h3>Challenge player</h3><button class="challenge-action primary">Send challenge</button></div>';
    document.body.appendChild(dialog);
    dialog.showModal();
  });
  await page.waitForTimeout(80);
  await expectInsideViewport(page, '.challenge-dialog');
  await expectTouchHeight(page, '.challenge-dialog button');
  expect(await css(page, '.challenge-dialog', 'animationName')).toContain('tr-dialog-enter');
  expect(await css(page, '.challenge-dialog', 'animationTimingFunction')).toContain('cubic-bezier');
  await expectNoHorizontalOverflow(page);
});
