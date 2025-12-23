import { test, expect } from '@playwright/test';

test.describe('Stop-Loss Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/stop-loss');
  });

  test('should display stop-loss page with form elements', async ({ page }) => {
    // Page title
    await expect(page.getByRole('heading', { name: /stop.*loss|stop-loss/i })).toBeVisible();

    // Token selection
    await expect(page.getByText(/token|from/i).first()).toBeVisible();

    // Price trigger input
    await expect(page.getByText(/price|trigger/i).first()).toBeVisible();
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    await expect(page.getByText(/connect.*wallet/i)).toBeVisible();
  });

  test('should display current price information', async ({ page }) => {
    // Look for current price display
    const priceDisplay = page.getByText(/current.*price|price.*now|\$/i);
    await expect(priceDisplay.first()).toBeVisible();
  });

  test('should show active stop-loss orders section', async ({ page }) => {
    // Look for active orders section
    const activeSection = page.getByText(/active|my.*orders|intents/i);
    await expect(activeSection.first()).toBeVisible();
  });
});
