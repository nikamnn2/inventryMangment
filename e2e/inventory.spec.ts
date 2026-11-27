import { expect, test, Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  const res = await request.post('http://localhost:3000/api/test/reset');
  expect(res.ok()).toBeTruthy();
});

async function signIn(page: Page) {
  await page.goto('/login');
  // the test-only admin that playwright.config.ts gives the in-memory API
  await page.locator('#user').fill('admin@invenza.com');
  await page.locator('#pw').fill('aluminium');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('Login', () => {
  test('shows the aluminium & glass login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByText('Every profile.')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/login.png', fullPage: true });
  });

  test('password can be revealed and hidden', async ({ page }) => {
    await page.goto('/login');
    const pw = page.locator('#pw');
    await expect(pw).toHaveAttribute('type', 'password');
    await page.getByLabel('Show password').click();
    await expect(pw).toHaveAttribute('type', 'text');
  });

  test('signing in navigates to the dashboard', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  });

  test('wrong password shows an error and stays on login', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#user').fill('admin@invenza.com');
    await page.locator('#pw').fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
    await expect(page).toHaveURL(/\/login/);
  });

  test('protected pages redirect to login without a session', async ({ page }) => {
    await page.goto('/sales');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the session survives a reload and ends on sign out', async ({ page }) => {
    await signIn(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
    await page.getByLabel('Sign out').click();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Backend persistence', () => {
  test('a recorded sale is stored in MongoDB and survives a reload', async ({ page }) => {
    await signIn(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Sales' }).click();
    await page.locator('input[name=qty]').fill('3');
    await page.locator('input[name=customer]').fill('Persisted Customer');
    await page.getByRole('button', { name: /Record sale/ }).click();
    await expect(page.getByText('ISSUED')).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Sales history' }).click();
    await expect(page.getByText('Persisted Customer')).toBeVisible();
    await expect(page.locator('table.tbl tbody tr')).toHaveCount(4);
  });

  test('a new product and bundle are saved by the API', async ({ page, request }) => {
    await signIn(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Products' }).click();
    await page.getByRole('button', { name: /Add product/ }).click();
    await page.locator('input[name=code]').fill('AL-7777');
    await page.locator('input[name=name]').fill('Persisted Profile');
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText('Product saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('AL-7777')).toBeVisible();
    const token = await page.evaluate(() => localStorage.getItem('invenza.token'));
    const res = await request.get('http://localhost:3000/api/products/AL-7777', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
  });

  test('a new bundle gets a generated ID from the server', async ({ page }) => {
    await signIn(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Bundles' }).click();
    await page.getByRole('button', { name: /Add bundle/ }).click();
    await page.locator('input[name=pieces]').fill('5');
    await page.locator('input[name=weight]').fill('25');
    await page.getByRole('button', { name: 'Save bundle' }).click();
    await expect(page.locator('table.tbl tbody tr')).toHaveCount(9);
    await expect(page.locator('table.tbl tbody tr').first().locator('td.mono')).toHaveText(/^d+$/);
  });

  test('stock and report CSV exports download from the API', async ({ page }) => {
    await signIn(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Stock Overview' }).click();
    const [stockCsv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export CSV/ }).click()]);
    expect(stockCsv.suggestedFilename()).toBe('stock-overview.csv');
    await page.getByRole('navigation').getByRole('link', { name: 'Reports' }).click();
    const [salesCsv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export CSV/ }).first().click()]);
    expect(salesCsv.suggestedFilename()).toBe('sales-report.csv');
  });
});

test.describe('App shell & menus', () => {
  test('every menu item opens its page', async ({ page }) => {
    await signIn(page);
    const menus: [string, string][] = [
      ['Products', 'Products'], ['Bundles', 'Bundles'], ['Sales', 'Sales'], ['Stock Overview', 'Stock Overview'],
      ['Customers', 'Customers'], ['Suppliers', 'Suppliers'], ['Reports', 'Reports'], ['Settings', 'Settings'], ['Dashboard', 'Good '],
    ];
    for (const [link, heading] of menus) {
      await page.getByRole('navigation').getByRole('link', { name: link }).click();
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    }
  });

  test('sign out returns to login', async ({ page }) => {
    await signIn(page);
    await page.getByLabel('Sign out').click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Dashboard', () => {
  test('shows KPIs, charts and recent bundles', async ({ page }) => {
    await signIn(page);
    await expect(page.getByText('Total pieces')).toBeVisible();
    await expect(page.getByText('Stock by bundle')).toBeVisible();
    await expect(page.getByText('Low-stock alerts', { exact: true })).toBeVisible();
    await expect(page.locator('table.tbl tbody tr')).toHaveCount(5);
    await page.screenshot({ path: 'e2e/screenshots/dashboard.png', fullPage: true });
  });
});

test.describe('Products', () => {
  test('filters by type and search', async ({ page }) => {
    await signIn(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Products' }).click();
    await page.getByRole('button', { name: 'Glass', exact: true }).click();
    await expect(page.locator('table.tbl tbody tr')).toHaveCount(4);
    await page.getByPlaceholder(/Search name/).fill('frosted');
    await expect(page.locator('table.tbl tbody tr')).toHaveCount(1);
  });

  test('adds a new product', async ({ page }) => {
    await signIn(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Products' }).click();
    await page.getByRole('button', { name: /Add product/ }).click();
    await page.locator('input[name=code]').fill('AL-9999');
    await page.locator('input[name=name]').fill('Test Profile');
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText('AL-9999')).toBeVisible();
  });
});

test.describe('Sales', () => {
  test('rejects a quantity above available stock', async ({ page }) => {
    await signIn(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Sales' }).click();
    await page.locator('input[name=qty]').fill('9999');
    await page.getByRole('button', { name: /Record sale/ }).click();
    await expect(page.getByText(/available in this bundle/)).toBeVisible();
  });

  test('records a sale and shows the bill', async ({ page }) => {
    await signIn(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Sales' }).click();
    await page.locator('input[name=qty]').fill('2');
    await page.locator('input[name=customer]').fill('Test Customer');
    await page.getByRole('button', { name: /Record sale/ }).click();
    await expect(page.getByText('ISSUED')).toBeVisible();
    await expect(page.locator('.receipt')).toContainText('Test Customer');
    await page.screenshot({ path: 'e2e/screenshots/sales.png', fullPage: true });
  });
});

test.describe('Flow-map parity', () => {
  const go = (page: Page, link: string) => page.getByRole('navigation').getByRole('link', { name: link }).click();

  test('rejects a duplicate Die No and requires required fields', async ({ page }) => {
    await signIn(page);
    await go(page, 'Products');
    await page.getByRole('button', { name: /Add product/ }).click();
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText('Die No and Product name are required.')).toBeVisible();
    await page.locator('input[name=code]').fill('AL-1001');
    await page.locator('input[name=name]').fill('Dup');
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText('Die No AL-1001 already exists.')).toBeVisible();
  });

  test('edits a product', async ({ page }) => {
    await signIn(page);
    await go(page, 'Products');
    await page.getByRole('row', { name: /AL-1001/ }).getByRole('button', { name: 'Edit' }).click();
    await page.locator('input[name=name]').fill('Renamed Frame');
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText('Renamed Frame')).toBeVisible();
  });

  test('bundle form computes average weight and label dialog opens', async ({ page }) => {
    await signIn(page);
    await go(page, 'Bundles');
    await page.getByRole('button', { name: /Add bundle/ }).click();
    await page.locator('input[name=pieces]').fill('10');
    await page.locator('input[name=weight]').fill('55');
    await expect(page.locator('input[name=avg]')).toHaveValue('5.500');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Label' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Bundle label' })).toBeVisible();
  });

  test('sale: scan not found, then a valid scan selects the bundle', async ({ page }) => {
    await signIn(page);
    await go(page, 'Sales');
    await page.locator('input[name=scan]').fill('nope-123');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByText(/Bundle not found/)).toBeVisible();
    await page.locator('input[name=scan]').fill('ab12cd34');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.locator('select[name=bundle]')).toHaveValue('ab12cd34ef901234');
  });

  test('sales history lists bills and opens details', async ({ page }) => {
    await signIn(page);
    await go(page, 'Sales');
    await page.getByRole('tab', { name: 'Sales history' }).click();
    await expect(page.locator('table.tbl tbody tr')).toHaveCount(3);
    await page.getByRole('row', { name: /INV-1042/ }).getByRole('button', { name: 'View' }).click();
    await expect(page.getByRole('dialog', { name: 'Sale details' })).toContainText('Shree Glazing Works');
  });

  test('stock filters by availability, product and search', async ({ page }) => {
    await signIn(page);
    await go(page, 'Stock Overview');
    await expect(page.locator('table.tbl tbody tr')).toHaveCount(8);
    await page.getByLabel('Availability').selectOption('sold');
    await expect(page.getByText('No bundles match these filters.')).toBeVisible();
    await page.getByLabel('Availability').selectOption('all');
    await page.getByLabel('Product filter').selectOption('GL-1010');
    await expect(page.locator('table.tbl tbody tr')).toHaveCount(1);
  });

  test('reports date range narrows results', async ({ page }) => {
    await signIn(page);
    await go(page, 'Reports');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.getByText('3 bills in range')).toBeVisible();
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.getByText('No sales in this period.')).toBeVisible();
  });

  test('changing the low-stock threshold updates alerts', async ({ page }) => {
    await signIn(page);
    await go(page, 'Settings');
    await page.locator('input[name=limit]').fill('10');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await go(page, 'Dashboard');
    await expect(page.getByText('Bundles under 10 pcs')).toBeVisible();
  });
});

test.describe('Responsive', () => {
  test('mobile drawer opens and navigates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await signIn(page);
    await page.getByLabel('Open menu').click();
    await page.getByRole('navigation').getByRole('link', { name: 'Stock Overview' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stock Overview');
  });
});
