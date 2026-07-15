import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('first-time setup wizard validates required restaurant and manager fields', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered by the focused mobile setup smoke.');

  await expect(page.getByRole('heading', { name: 'Set Up This Restaurant' })).toBeVisible();
  await expect(page.getByText('Firebase required')).toBeVisible();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Name The Location' })).toBeVisible();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('status')).toContainText('Enter the restaurant name.');

  await page.getByLabel('Restaurant name').fill('RAW Test Kitchen');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Create Admin PIN' })).toBeVisible();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('status')).toContainText('Enter the manager/admin name.');

  await page.getByLabel('Manager name').fill('Nadia');
  await page.getByLabel('Management PIN').fill('123');
  await page.getByLabel('Confirm PIN').fill('123');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('status')).toContainText('Use a 4 to 8 digit PIN.');

  await page.getByLabel('Management PIN').fill('1234');
  await page.getByLabel('Confirm PIN').fill('4321');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('status')).toContainText('Manager PINs do not match.');
});

test('setup wizard remains usable on mobile viewport', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile smoke runs only on the mobile project.');

  await expect(page.getByRole('heading', { name: 'Set Up This Restaurant' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Restaurant name')).toBeVisible();
  await page.getByLabel('Restaurant name').fill('Mobile Cafe');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Manager name')).toBeVisible();
});

test('remembered shop and login survive reopening the app', async ({ page, context, isMobile }) => {
  test.skip(isMobile, 'Persistence behavior is browser-wide and covered on desktop Chromium.');

  const databaseId = 'ws_persistence_test';
  const manager = {
    id: 'staff_nadia',
    name: 'Nadia',
    role: 'Manager',
    staffSection: 'management',
    managerPin: {
      algorithm: 'sha256-salt-v1',
      salt: 'test-salt',
      hash: 'test-hash',
    },
  };

  await page.evaluate(({ restaurantId, managerAccount }) => {
    localStorage.setItem('wasteShiftStaffFreshStartVersion', 'empty-staff-roster-v1');
    localStorage.setItem('wasteShiftClientDatabaseId', restaurantId);
    localStorage.setItem('wasteShiftRestaurantProfiles', JSON.stringify({
      [restaurantId]: {
        restaurantName: 'Remembered Kitchen',
        branchName: 'Main',
        currency: 'ZAR',
        timezone: 'Africa/Johannesburg',
        setupCompleted: true,
      },
    }));
    localStorage.setItem('customStaffList', JSON.stringify([managerAccount]));
    localStorage.setItem('activeStaffId', managerAccount.id);
    localStorage.setItem('wasteShiftAuthSession', JSON.stringify({
      mode: 'management',
      staffId: managerAccount.id,
      staffName: managerAccount.name,
      roleKey: 'manager',
      databaseId: restaurantId,
      startedAt: new Date().toISOString(),
    }));
  }, { restaurantId: databaseId, managerAccount: manager });

  await page.close();
  const reopenedPage = await context.newPage();
  await reopenedPage.goto('/');

  await expect(reopenedPage.locator('.app-shell')).toBeVisible();
  await expect(reopenedPage.getByRole('heading', { name: 'Set Up This Restaurant' })).toHaveCount(0);
  await expect(reopenedPage.getByRole('heading', { name: 'Create Manager Access' })).toHaveCount(0);
  expect(reopenedPage.url()).not.toContain('restaurant=');

  await reopenedPage.goto('/?restaurant=legacy-shop');
  await expect(reopenedPage.locator('.app-shell')).toBeVisible();
  expect(reopenedPage.url()).not.toContain('restaurant=');

  await reopenedPage.locator('.navbar').getByRole('button', { name: 'Lock' }).click();
  await expect(reopenedPage.getByRole('heading', { name: 'Start Waste Logging' })).toBeVisible();
  expect(await reopenedPage.evaluate(() => localStorage.getItem('wasteShiftAuthSession'))).toBeNull();

  await reopenedPage.reload();
  await expect(reopenedPage.getByRole('heading', { name: 'Start Waste Logging' })).toBeVisible();
  await expect(reopenedPage.locator('.app-shell')).toHaveCount(0);
});

test('staff session exposes waste logging without management screens', async ({ page, isMobile }) => {
  const databaseId = 'ws_staff_role_test';
  const manager = {
    id: 'staff_manager',
    name: 'Manager',
    role: 'Manager',
    staffSection: 'management',
    managerPin: {
      algorithm: 'sha256-salt-v1',
      salt: 'test-salt',
      hash: 'test-hash',
    },
  };
  const waiter = {
    id: 'staff_waiter',
    name: 'Waiter',
    role: 'Waiter',
    roleKey: 'waiter',
    staffSection: 'front-of-house',
    staffCode: {
      algorithm: 'sha256-salt-v1',
      salt: 'staff-salt',
      hash: 'staff-hash',
    },
  };

  await page.evaluate(({ restaurantId, managerAccount, staffAccount }) => {
    localStorage.setItem('wasteShiftStaffFreshStartVersion', 'empty-staff-roster-v1');
    localStorage.setItem('wasteShiftClientDatabaseId', restaurantId);
    localStorage.setItem('wasteShiftRestaurantProfiles', JSON.stringify({
      [restaurantId]: {
        restaurantName: 'Role Test Kitchen',
        branchName: 'Main',
        currency: 'ZAR',
        timezone: 'Africa/Johannesburg',
        setupCompleted: true,
      },
    }));
    localStorage.setItem('customStaffList', JSON.stringify([managerAccount, staffAccount]));
    localStorage.setItem('activeStaffId', staffAccount.id);
    localStorage.setItem('wasteShiftAuthSession', JSON.stringify({
      mode: 'staff',
      staffId: staffAccount.id,
      staffName: staffAccount.name,
      roleKey: 'waiter',
      databaseId: restaurantId,
      startedAt: new Date().toISOString(),
    }));
  }, { restaurantId: databaseId, managerAccount: manager, staffAccount: waiter });

  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  const wasteNavigation = isMobile ? page.locator('.bottom-nav') : page.locator('.nav-links');
  await expect(wasteNavigation.getByRole('button', { name: isMobile ? 'Log' : /Log Waste/ })).toBeVisible();
  await expect(wasteNavigation.getByRole('button', { name: isMobile ? 'Waste' : /Waste Log/ })).toBeVisible();
  await expect(page.locator('.nav-button', { hasText: 'Dashboard' })).toHaveCount(0);
  await expect(page.locator('.nav-button', { hasText: 'Inventory' })).toHaveCount(0);
  await expect(page.locator('.nav-button', { hasText: 'Menu & Pricing' })).toHaveCount(0);
  await expect(page.locator('.nav-button', { hasText: 'Settings' })).toHaveCount(0);
});
