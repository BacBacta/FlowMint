import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should display the homepage with main elements', async ({ page }) => {
    await page.goto('/');

    // Check title
    await expect(page).toHaveTitle(/FlowMint/i);

    // Check header is present
    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Check main navigation links
    await expect(page.getByRole('link', { name: /swap/i })).toBeVisible();

    // Check footer is present
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
  });

  test('should navigate to swap page', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: /swap/i }).click();
    await expect(page).toHaveURL('/swap');
  });

  test('should navigate to DCA page', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: /dca/i }).click();
    await expect(page).toHaveURL('/dca');
  });

  test('should navigate to analytics page', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: /analytics/i }).click();
    await expect(page).toHaveURL('/analytics');
  });
});
