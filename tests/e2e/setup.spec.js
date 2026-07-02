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
