const { test, expect } = require('@playwright/test');

test.describe('Matchday Arcade Soccer browser smoke tests', () => {
  test('loads the main menu and core team selection controls', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#btnQuickMatch')).toBeVisible();
    await expect(page.locator('#btnStart')).toBeVisible();
    await expect(page.locator('#lstHome')).toBeVisible();
    await expect(page.locator('#lstAway')).toBeVisible();
    await expect(page.locator('#segDiff')).toBeVisible();
    await expect(page.locator('#segLen')).toBeVisible();
    await expect(page.locator('#segPitch')).toBeVisible();
    expect(pageErrors, 'uncaught browser errors on initial load').toEqual([]);
  });

  test('quick match can start, pause, resume, and return to menu', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await page.locator('#btnQuickMatch').click();
    await expect(page.locator('#menu')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#hud')).toBeVisible();
    await page.locator('#btnPause').click();
    await expect(page.locator('#pauseScr')).toBeVisible();
    await page.locator('#btnResume').click();
    await expect(page.locator('#pauseScr')).toBeHidden();
    await page.locator('#btnPause').click();
    await page.locator('#btnQuit').click();
    await expect(page.locator('#menu')).toBeVisible();
    expect(pageErrors, 'uncaught browser errors during a match').toEqual([]);
  });

  test('Career Mode, Dream Team, online and cup entry points respond', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    for (const id of ['btnCareer', 'btnDt', 'btnOnline', 'btnCup', 'btnRush', 'btnLb', 'btnAcc']) {
      await expect(page.locator('#' + id)).toBeVisible();
      await expect(page.locator('#' + id)).toBeEnabled();
    }
    await page.locator('#btnCareer').click();
    await expect(page.locator('#careerScr')).toBeVisible();
    await expect(page.locator('#cBody')).toBeVisible();
    expect(pageErrors, 'uncaught browser errors when opening Career Mode').toEqual([]);
  });

  test('extra modes and purchase shop are present and open without crashing', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#mdStripeShopBtn')).toBeVisible();
    await page.locator('#mdStripeShopBtn').click();
    await expect(page.locator('#mdStripeShop')).toHaveClass(/open/);
    await page.locator('#mdspClose').click();
    await expect(page.locator('#mdStripeShop')).not.toHaveClass(/open/);
    await expect(page.locator('#mdFeatureModal')).toHaveCount(1);
    expect(pageErrors, 'uncaught browser errors when opening the shop').toEqual([]);
  });
});
