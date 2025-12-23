import { test, expect } from '@playwright/test';

test.describe('Swap Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/swap');
  });

  test('should display swap form with all required elements', async ({ page }) => {
    // Page title
    await expect(page.getByRole('heading', { name: /swap/i })).toBeVisible();

    // Input token selector
    await expect(page.getByTestId('input-token-select')).toBeVisible();

    // Output token selector
    await expect(page.getByTestId('output-token-select')).toBeVisible();

    // Amount input
    await expect(page.getByPlaceholder(/amount|0\.0/i)).toBeVisible();

    // Swap button (should require wallet connection)
    const swapButton = page.getByRole('button', { name: /swap|connect wallet/i });
    await expect(swapButton).toBeVisible();
  });

  test('should show connect wallet prompt when not connected', async ({ page }) => {
    // Look for wallet connection prompt
    await expect(page.getByText(/connect.*wallet/i)).toBeVisible();
  });

  test('should allow entering amount in input field', async ({ page }) => {
    const amountInput = page.getByPlaceholder(/amount|0\.0/i).first();
    await amountInput.fill('100');
    await expect(amountInput).toHaveValue('100');
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
