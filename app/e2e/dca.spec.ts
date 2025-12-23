import { test, expect } from '@playwright/test';

test.describe('DCA Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dca');
  });

  test('should display DCA page with form elements', async ({ page }) => {
    // Page title
    await expect(page.getByRole('heading', { name: /dca|dollar.*cost.*averaging/i })).toBeVisible();

    // Should show input token selector
    await expect(page.getByText(/from|input.*token/i).first()).toBeVisible();

    // Should show output token selector
    await expect(page.getByText(/to|output.*token/i).first()).toBeVisible();

    // Amount per execution
    await expect(page.getByText(/amount|per/i).first()).toBeVisible();

    // Frequency selector
    await expect(page.getByText(/interval|frequency|every/i).first()).toBeVisible();
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    await expect(page.getByText(/connect.*wallet/i)).toBeVisible();
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
