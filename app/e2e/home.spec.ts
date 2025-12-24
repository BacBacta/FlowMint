import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should display the homepage with main elements', async ({ page }) => {
    await page.goto('/');

    // Check title
    await expect(page).toHaveTitle(/FlowMint/i);

    // Check header is present
    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Check main navigation links (use exact match or first)
    await expect(page.getByRole('link', { name: 'Swap', exact: true })).toBeVisible();

    // Check footer is present
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
  });

  test('should navigate to swap page', async ({ page }) => {
    await page.goto('/');

    // Use exact match to avoid multiple elements
    await page.getByRole('link', { name: 'Swap', exact: true }).click();
    await expect(page).toHaveURL('/swap');
  });

  test('should navigate to DCA page', async ({ page }) => {
    await page.goto('/');

    // Use exact match
    await page.getByRole('link', { name: 'DCA', exact: true }).click();
    await expect(page).toHaveURL('/dca');
  });

  test('should navigate to analytics page', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: /analytics/i }).first().click();
    await expect(page).toHaveURL('/analytics');
  });
});
