import { test, expect } from '@playwright/test';
import { DashboardPage } from './pages/DashboardPage';

test.describe('Dashboard', () => {
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    // Login as demo user
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    dashboardPage = new DashboardPage(page);
  });

  test('should load dashboard successfully', async ({ page }) => {
    await dashboardPage.expectLoaded();
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });

  test('should display market data', async ({ page }) => {
    await dashboardPage.waitForLoad();
    const cardCount = await dashboardPage.getMarketCardCount();
    expect(cardCount).toBeGreaterThan(0);
  });

  test('should handle loading state', async ({ page }) => {
    // This test verifies the loading state is shown briefly
    await dashboardPage.goto();
    // Loading should appear and then disappear
    await dashboardPage.waitForLoad();
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API failure
    await page.route('**/api/dashboard-snapshot', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });
    
    await dashboardPage.goto();
    await dashboardPage.expectError();
  });

  test('should refresh data', async ({ page }) => {
    await dashboardPage.waitForLoad();
    await dashboardPage.clickRefresh();
    // Verify refresh doesn't crash
    await expect(dashboardPage.chartContainer).toBeVisible();
  });

  test('should handle network offline', async ({ page }) => {
    await dashboardPage.waitForLoad();
    
    // Go offline
    await page.context().setOffline(true);
    
    // Try to refresh
    await dashboardPage.clickRefresh();
    
    // Should show error or retry state
    await expect(dashboardPage.errorMessage).toBeVisible();
    
    // Go back online
    await page.context().setOffline(false);
  });
});

test.describe('Dashboard - Responsive', () => {
  test('should display correctly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    
    // Login
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    // Verify mobile layout
    await expect(page.locator('text=Dashboard')).toBeVisible();
    
    // Check no horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width || 375;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth);
  });
});
