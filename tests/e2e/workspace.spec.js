import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?workspace=1');
});

test('manager can navigate the complete restaurant workspace', async ({ page, isMobile }) => {
  await expect(page.getByRole('heading', { name: 'Today At A Glance' })).toBeVisible();

  const navigation = isMobile ? page.locator('.bottom-nav') : page.locator('.navbar');
  await navigation.getByRole('button', { name: 'Invoices', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible();
  const invoiceViews = page.locator('[aria-label="Invoice views"]');
  await expect(invoiceViews.getByRole('button', { name: 'New invoice' })).toBeVisible();

  await invoiceViews.getByRole('button', { name: 'Ingredients' }).click();
  await expect(page.getByRole('heading', { name: 'Ingredient Library' })).toBeVisible();

  await invoiceViews.getByRole('button', { name: 'Processed' }).click();
  await expect(page.getByRole('heading', { name: 'Supplier Invoice Library' })).toBeVisible();

  await invoiceViews.getByRole('button', { name: 'Stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stock Movement Ledger' })).toBeVisible();

  await navigation.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Menu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Library/ }).click();
  await expect(page.getByText('Chicken Burger').first()).toBeVisible();
});

test('manager can log waste and see it in the shared log', async ({ page, isMobile }) => {
  const navigation = isMobile ? page.locator('.bottom-nav') : page.locator('.navbar');
  const logButton = isMobile
    ? navigation.locator('.bottom-nav-button.is-primary')
    : navigation.locator('.nav-button').filter({ hasText: 'Log waste' });
  await logButton.click();

  await page.getByLabel('Ingredient or stock item').fill('Chicken breast');
  await page.getByLabel('Quantity').fill('100');
  await page.getByLabel('Unit').selectOption('g');
  await page.getByRole('main').getByRole('button', { name: 'Log waste', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Logged Chicken breast');

  const wasteLogButton = isMobile
    ? navigation.locator('.bottom-nav-button').filter({ hasText: 'History' })
    : navigation.locator('.nav-button').filter({ hasText: 'History' });
  await wasteLogButton.click();
  await expect(page.getByText('Chicken breast').first()).toBeVisible();
});

test('mobile workspace has no horizontal page overflow', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile overflow check runs only on the mobile project.');

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasOverflow).toBe(false);
  await expect(page.locator('.bottom-nav')).toBeVisible();
});
