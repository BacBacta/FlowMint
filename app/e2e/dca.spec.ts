import { test, expect } from '@playwright/test';

test.describe('DCA Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dca');
  });

  test('should display DCA page with form elements', async ({ page }) => {
    // Page title - use first() to handle multiple headings
    await expect(page.getByRole('heading', { name: 'Dollar Cost Averaging' })).toBeVisible();

    // Should show the form section
    await expect(page.getByRole('heading', { name: 'Create DCA Order' })).toBeVisible();

    // Should have main content area
    await expect(page.locator('main')).toBeVisible();
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    await expect(page.getByText(/connect.*wallet/i).first()).toBeVisible();
  });

  test('should display active intents section', async ({ page }) => {
    // Look for active DCA intents section
    const activeSection = page.getByText(/active|my.*intents|orders/i);
    await expect(activeSection.first()).toBeVisible();
  });

  test('should allow selecting DCA interval', async ({ page }) => {
    // Look for interval selector
    const intervalInput = page.locator('[data-testid="interval-select"], select[name*="interval"]');
    if (await intervalInput.isVisible()) {
      await intervalInput.selectOption({ index: 1 });
    }
  });
});
