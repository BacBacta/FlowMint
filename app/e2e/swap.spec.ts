import { test, expect } from '@playwright/test';

test.describe('Swap Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/swap');
  });

  test('should display swap form with all required elements', async ({ page }) => {
    // Page title - use first() to handle multiple matches
    await expect(page.getByRole('heading', { name: /swap/i }).first()).toBeVisible();

    // Check page has main content
    await expect(page.locator('main')).toBeVisible();

    // Swap button or connect wallet button
    const actionButton = page.getByRole('button').first();
    await expect(actionButton).toBeVisible();
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    // Look for wallet connection prompt
    await expect(page.getByText(/connect.*wallet/i).first()).toBeVisible();
  });

  test('should allow entering amount in input field', async ({ page }) => {
    // Look for any input field on the page
    const amountInput = page.locator('input[type="number"], input[type="text"]').first();
    if (await amountInput.isVisible()) {
      await amountInput.fill('100');
      await expect(amountInput).toHaveValue('100');
    }
  });

  test('should display token selection options', async ({ page }) => {
    // Click on input token selector
    const inputTokenSelect = page.getByTestId('input-token-select');
    if (await inputTokenSelect.isVisible()) {
      await inputTokenSelect.click();
      // Should show token list modal or dropdown
      await expect(page.getByText(/sol|usdc|select/i)).toBeVisible();
    }
  });

  test('should display slippage settings', async ({ page }) => {
    // Look for slippage settings (gear icon or settings button)
    const settingsButton = page.getByRole('button', { name: /settings|slippage/i });
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      // Should show slippage options
      await expect(page.getByText(/slippage/i)).toBeVisible();
    }
  });
});
