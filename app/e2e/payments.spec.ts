import { test, expect } from '@playwright/test';

test.describe('Payments Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/payments');
  });

  test('should display payments page with main elements', async ({ page }) => {
    // Page title
    await expect(page.getByRole('heading', { name: /payment/i })).toBeVisible();
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    await expect(page.getByText(/connect.*wallet/i)).toBeVisible();
  });

  test('should display tabs for creating and paying', async ({ page }) => {
    // Look for create payment link tab
    const createTab = page.getByText(/create|merchant/i);
    await expect(createTab.first()).toBeVisible();

    // Look for pay tab
    const payTab = page.getByText(/pay|send/i);
    await expect(payTab.first()).toBeVisible();
  });

  test('should have form for creating payment link', async ({ page }) => {
    // Click create tab if needed
    const createTab = page.getByRole('tab', { name: /create/i });
    if (await createTab.isVisible()) {
      await createTab.click();
    }

    // Should show merchant ID or order ID input
    await expect(page.getByText(/merchant|order.*id|amount/i).first()).toBeVisible();
  });
});
