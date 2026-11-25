import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

const PAGES = ['dashboard', 'products', 'bundles', 'sales', 'stock', 'customers', 'suppliers', 'reports', 'members', 'settings'];
const SHOTS = process.env['SHOT_DIR'];
const API = process.env['E2E_API'] ?? 'http://localhost:3000';

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${API}/api/test/reset`)).ok()).toBeTruthy();
});

/** The page itself must never scroll sideways; wide tables scroll inside their own wrapper. */
async function expectNoPageOverflow(page: import('@playwright/test').Page, label: string) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect.soft(scrollWidth, `${label} scrolls sideways (${scrollWidth}px > ${innerWidth}px)`).toBeLessThanOrEqual(innerWidth);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('login and activation pages fit the screen', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 20_000 });
      await expectNoPageOverflow(page, 'login');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.name}-login.png`, fullPage: true });

      await page.goto('/activate');
      await expect(page.getByText('Link not valid')).toBeVisible({ timeout: 20_000 });
      await expectNoPageOverflow(page, 'activate');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.name}-activate.png`, fullPage: true });
    });

    test('every page fits the screen', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      for (const route of PAGES) {
        await page.goto(`/${route}`);
        await expect(page.locator('h1').first()).toBeVisible();
        await page.waitForTimeout(300);
        await expectNoPageOverflow(page, route);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.name}-${route}.png`, fullPage: true });
      }
    });

    test('dialogs fit the screen', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: /sign in/i }).click();
      for (const [route, button] of [['products', /add product/i], ['bundles', /add bundle|new bundle/i], ['members', /add member/i]] as const) {
        await page.goto(`/${route}`);
        await page.getByRole('button', { name: button }).first().click();
        const modal = page.locator('.modal').first();
        await expect(modal).toBeVisible();
        const box = (await modal.boundingBox())!;
        expect(box.x, `${route} dialog starts off-screen`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${route} dialog runs off-screen`).toBeLessThanOrEqual(vp.width);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.name}-${route}-dialog.png` });
      }
    });
  });
}
