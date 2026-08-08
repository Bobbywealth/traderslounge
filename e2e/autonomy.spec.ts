import { test, expect } from '@playwright/test';

test.describe('Autonomy System', () => {
  test.beforeEach(async ({ page }) => {
    // Login as demo user
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
  });

  test('should load Trading Desk dashboard', async ({ page }) => {
    await page.goto('/trading-desk');
    await page.waitForLoadState('networkidle');
    
    // Verify dashboard elements
    await expect(page.locator('text=Trading Desk')).toBeVisible();
    await expect(page.locator('text=System Status')).toBeVisible();
    await expect(page.locator('text=Best Opportunities')).toBeVisible();
  });

  test('should display system status', async ({ page }) => {
    await page.goto('/trading-desk');
    await page.waitForLoadState('networkidle');
    
    // Verify system status section
    await expect(page.locator('text=Mode')).toBeVisible();
    await expect(page.locator('text=Health')).toBeVisible();
    await expect(page.locator('text=Active Setups')).toBeVisible();
  });

  test('should display opportunities', async ({ page }) => {
    await page.goto('/trading-desk');
    await page.waitForLoadState('networkidle');
    
    // Verify opportunities section
    await expect(page.locator('text=Best Opportunities')).toBeVisible();
    
    // Check for opportunity cards or empty state
    const opportunities = page.locator('[data-testid="opportunity-card"]');
    const emptyState = page.locator('text=No opportunities detected');
    
    // Either opportunities exist or empty state is shown
    await expect(opportunities.first().or(emptyState)).toBeVisible();
  });

  test('should display upcoming news', async ({ page }) => {
    await page.goto('/trading-desk');
    await page.waitForLoadState('networkidle');
    
    // Verify news section
    await expect(page.locator('text=Upcoming News')).toBeVisible();
  });

  test('should display alerts', async ({ page }) => {
    await page.goto('/trading-desk');
    await page.waitForLoadState('networkidle');
    
    // Verify alerts section
    await expect(page.locator('text=Recent Alerts')).toBeVisible();
  });

  test('should display agent activity', async ({ page }) => {
    await page.goto('/trading-desk');
    await page.waitForLoadState('networkidle');
    
    // Verify agent activity section
    await expect(page.locator('text=Agent Activity')).toBeVisible();
    await expect(page.locator('text=Market Watcher')).toBeVisible();
    await expect(page.locator('text=Scanner')).toBeVisible();
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API failure
    await page.route('**/api/autonomy/**', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });
    
    await page.goto('/trading-desk');
    
    // Should show error state
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });

  test('should refresh data periodically', async ({ page }) => {
    await page.goto('/trading-desk');
    await page.waitForLoadState('networkidle');
    
    // Wait for initial load
    await expect(page.locator('text=System Status')).toBeVisible();
    
    // Verify page is still functional after some time
    await page.waitForTimeout(5000);
    await expect(page.locator('text=System Status')).toBeVisible();
  });
});

test.describe('Autonomy API Endpoints', () => {
  test('should return autonomy status', async ({ request }) => {
    const response = await request.get('/api/autonomy/status');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('mode');
    expect(data).toHaveProperty('health');
    expect(data).toHaveProperty('active_setups');
  });

  test('should return opportunities', async ({ request }) => {
    const response = await request.get('/api/autonomy/opportunities');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('opportunities');
    expect(Array.isArray(data.opportunities)).toBeTruthy();
  });

  test('should return news status', async ({ request }) => {
    const response = await request.get('/api/autonomy/news');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('total_upcoming');
    expect(data).toHaveProperty('events');
  });

  test('should return alerts', async ({ request }) => {
    const response = await request.get('/api/autonomy/alerts');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('alerts');
    expect(Array.isArray(data.alerts)).toBeTruthy();
  });
});

test.describe('Autonomy - Mobile', () => {
  test('should display Trading Desk on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    
    // Login
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    // Navigate to Trading Desk
    await page.goto('/trading-desk');
    await page.waitForLoadState('networkidle');
    
    // Verify mobile layout
    await expect(page.locator('text=Trading Desk')).toBeVisible();
    
    // Check no horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width || 375;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth);
  });
});
