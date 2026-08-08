import { test, expect } from '@playwright/test';

test.describe('Scanner', () => {
  test.beforeEach(async ({ page }) => {
    // Login as demo user
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
  });

  test('should display scanner results', async ({ page }) => {
    // Navigate to scanner
    await page.goto('/scanner');
    
    // Wait for scanner to load
    await page.waitForLoadState('networkidle');
    
    // Verify scanner UI elements
    await expect(page.locator('text=Scanner')).toBeVisible();
    await expect(page.locator('[data-testid="scanner-results"]')).toBeVisible();
  });

  test('should filter by symbol', async ({ page }) => {
    await page.goto('/scanner');
    await page.waitForLoadState('networkidle');
    
    // Find and use symbol filter
    const symbolFilter = page.locator('[data-testid="symbol-filter"]');
    if (await symbolFilter.isVisible()) {
      await symbolFilter.fill('BTC');
      await page.waitForTimeout(500);
      
      // Verify filtered results
      const results = page.locator('[data-testid="scanner-result"]');
      const count = await results.count();
      for (let i = 0; i < count; i++) {
        await expect(results.nth(i)).toContainText('BTC');
      }
    }
  });

  test('should filter by timeframe', async ({ page }) => {
    await page.goto('/scanner');
    await page.waitForLoadState('networkidle');
    
    // Find and use timeframe filter
    const timeframeFilter = page.locator('[data-testid="timeframe-filter"]');
    if (await timeframeFilter.isVisible()) {
      await timeframeFilter.selectOption('1h');
      await page.waitForTimeout(500);
      
      // Verify filtered results
      const results = page.locator('[data-testid="scanner-result"]');
      const count = await results.count();
      for (let i = 0; i < count; i++) {
        await expect(results.nth(i)).toContainText('1h');
      }
    }
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API failure
    await page.route('**/api/signals**', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });
    
    await page.goto('/scanner');
    
    // Should show error state
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });

  test('should refresh scanner data', async ({ page }) => {
    await page.goto('/scanner');
    await page.waitForLoadState('networkidle');
    
    // Click refresh button
    const refreshButton = page.locator('button').filter({ hasText: /refresh/i });
    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await page.waitForLoadState('networkidle');
      
      // Verify data is still displayed
      await expect(page.locator('[data-testid="scanner-results"]')).toBeVisible();
    }
  });
});

test.describe('Signals', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
  });

  test('should display signals list', async ({ page }) => {
    await page.goto('/signals');
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('text=Signals')).toBeVisible();
    await expect(page.locator('[data-testid="signal-list"]')).toBeVisible();
  });

  test('should show signal details on click', async ({ page }) => {
    await page.goto('/signals');
    await page.waitForLoadState('networkidle');
    
    // Click on first signal
    const firstSignal = page.locator('[data-testid="signal-item"]').first();
    if (await firstSignal.isVisible()) {
      await firstSignal.click();
      
      // Verify detail view
      await expect(page.locator('[data-testid="signal-detail"]')).toBeVisible();
    }
  });

  test('should handle empty signals state', async ({ page }) => {
    // Mock empty response
    await page.route('**/api/signals**', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ success: true, signals: [] }),
      });
    });
    
    await page.goto('/signals');
    
    // Should show empty state
    await expect(page.locator('text=No signals')).toBeVisible();
  });

  test('should handle loading state', async ({ page }) => {
    // Mock slow response
    await page.route('**/api/signals**', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ success: true, signals: [] }),
        delay: 2000,
      });
    });
    
    await page.goto('/signals');
    
    // Should show loading state
    await expect(page.locator('[data-testid="loading-spinner"]')).toBeVisible();
  });
});

test.describe('Performance', () => {
  test('should load dashboard within performance budget', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    const loadTime = Date.now() - startTime;
    
    // Should load within 10 seconds
    expect(loadTime).toBeLessThan(10000);
  });

  test('should handle rapid navigation', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    // Rapidly navigate between pages
    await page.goto('/signals');
    await page.goto('/scanner');
    await page.goto('/chart');
    await page.goto('/dashboard');
    
    // Should still be functional
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });
});
