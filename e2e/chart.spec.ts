import { test, expect } from '@playwright/test';
import { ChartPage } from './pages/ChartPage';

test.describe('Chart', () => {
  let chartPage: ChartPage;

  test.beforeEach(async ({ page }) => {
    // Login as demo user
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    chartPage = new ChartPage(page);
  });

  test('should load chart successfully', async ({ page }) => {
    await chartPage.goto();
    await chartPage.waitForChartLoad();
    await chartPage.expectChartLoaded();
  });

  test('should display chart without white screen', async ({ page }) => {
    await chartPage.goto();
    await chartPage.waitForChartLoad();
    await chartPage.expectNoWhiteScreen();
  });

  test('should switch symbols', async ({ page }) => {
    await chartPage.goto();
    await chartPage.waitForChartLoad();
    
    // Switch to a different symbol
    await chartPage.selectSymbol('ETHUSD');
    
    // Wait for chart to reload
    await chartPage.waitForChartLoad();
    await chartPage.expectChartLoaded();
  });

  test('should switch timeframes', async ({ page }) => {
    await chartPage.goto();
    await chartPage.waitForChartLoad();
    
    // Switch timeframe
    await chartPage.selectTimeframe('1H');
    
    // Wait for chart to reload
    await chartPage.waitForChartLoad();
    await chartPage.expectChartLoaded();
  });

  test('should handle rapid symbol switching', async ({ page }) => {
    await chartPage.goto();
    await chartPage.waitForChartLoad();
    
    // Rapidly switch symbols
    await chartPage.selectSymbol('ETHUSD');
    await chartPage.selectSymbol('BTCUSD');
    await chartPage.selectSymbol('XAUUSD');
    
    // Wait for final load
    await chartPage.waitForChartLoad();
    await chartPage.expectChartLoaded();
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API failure
    await page.route('**/api/candles**', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Failed to load candles' }),
      });
    });
    
    await chartPage.goto();
    
    // Should show error state
    await chartPage.expectError();
    
    // Should have retry button
    await expect(chartPage.retryButton).toBeVisible();
  });

  test('should retry on error', async ({ page }) => {
    let callCount = 0;
    
    // Mock API to fail first time, succeed second
    await page.route('**/api/candles**', (route) => {
      callCount++;
      if (callCount === 1) {
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Temporary failure' }),
        });
      } else {
        route.fulfill({
          status: 200,
          body: JSON.stringify({ candles: [] }),
        });
      }
    });
    
    await chartPage.goto();
    await chartPage.expectError();
    
    // Click retry
    await chartPage.clickRetry();
    
    // Should succeed
    await chartPage.waitForChartLoad();
  });

  test('should handle WebSocket reconnection', async ({ page }) => {
    await chartPage.goto();
    await chartPage.waitForChartLoad();
    
    // Simulate WebSocket disconnect by blocking ws connections
    await page.route('**/ws**', (route) => route.abort());
    
    // Wait a bit
    await page.waitForTimeout(2000);
    
    // Restore WebSocket
    await page.unroute('**/ws**');
    
    // Chart should still be functional
    await chartPage.expectChartLoaded();
  });
});

test.describe('Chart - Mobile', () => {
  test('should be usable on mobile devices', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    
    // Login
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    // Navigate to chart
    await page.goto('/chart');
    
    // Verify chart loads
    await expect(page.locator('[data-testid="chart-container"]')).toBeVisible();
    
    // Check no horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width || 375;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth);
  });
});
