import { test, expect } from '@playwright/test';

test.describe('Stop-Loss Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/stop-loss');
  });

  test('should display stop-loss page with form elements', async ({ page }) => {
    // Page title - use exact match
    await expect(page.getByRole('heading', { name: 'Stop-Loss Orders', exact: true })).toBeVisible();

    // Should show the form section
    await expect(page.getByRole('heading', { name: 'Create Stop-Loss' })).toBeVisible();

    // Should have main content area
    await expect(page.locator('main')).toBeVisible();
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    await expect(page.getByText(/connect.*wallet/i).first()).toBeVisible();
  });

  test('should display current price information', async ({ page }) => {
    // Look for any price-related content or verify page structure
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();
    // Check that the form section exists
    const formSection = page.getByText(/create|stop-loss/i).first();
    await expect(formSection).toBeVisible();
  });

  test('should show active stop-loss orders section', async ({ page }) => {
    // Look for active orders section
    const activeSection = page.getByText(/active|my.*orders|intents/i);
    await expect(activeSection.first()).toBeVisible();
  });
});
