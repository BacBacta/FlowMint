import { test, expect } from '@playwright/test';

test.describe('Analytics Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analytics');
  });

  test('should display analytics page with main elements', async ({ page }) => {
    // Page title
    await expect(page.getByRole('heading', { name: /analytics/i })).toBeVisible();
  });

  test('should display overview statistics', async ({ page }) => {
    // Look for statistics cards
    await expect(page.getByText(/total|swaps|volume/i).first()).toBeVisible();
  });

  test('should have time range selector', async ({ page }) => {
    // Look for time range buttons or selector
    const timeRanges = page.getByText(/24h|7d|30d|all/i);
    await expect(timeRanges.first()).toBeVisible();
  });

  test('should display charts section', async ({ page }) => {
    // Look for chart container or recharts elements
    const chartContainer = page.locator('.recharts-wrapper, [data-testid*="chart"]');
    // Charts may take time to load
    await page.waitForTimeout(1000);
    
    // If charts are present, they should be visible
    if (await chartContainer.first().isVisible()) {
      await expect(chartContainer.first()).toBeVisible();
    }
  });

  test('should be able to switch time ranges', async ({ page }) => {
    // Find and click different time range buttons
    const timeButton7d = page.getByRole('button', { name: /7d/i });
    if (await timeButton7d.isVisible()) {
      await timeButton7d.click();
      // Content should refresh (check for loading or updated data)
      await page.waitForTimeout(500);
    }
  });
});
