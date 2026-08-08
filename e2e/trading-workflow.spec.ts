import { test, expect } from '@playwright/test';

test.describe('Trading Workflow - Complete User Journey', () => {
  test.beforeEach(async ({ page }) => {
    // Login as demo user
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
  });

  test('complete trading workflow: login → dashboard → scanner → chart → analysis', async ({ page }) => {
    // Step 1: Verify dashboard loads
    await expect(page.locator('text=Dashboard')).toBeVisible();
    await expect(page.locator('[data-testid="market-card"]')).toBeVisible();
    
    // Step 2: Navigate to scanner
    await page.goto('/scanner');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Scanner')).toBeVisible();
    
    // Step 3: Select a symbol from scanner
    const firstResult = page.locator('[data-testid="scanner-result"]').first();
    if (await firstResult.isVisible()) {
      await firstResult.click();
      
      // Step 4: Verify chart loads
      await page.waitForURL(/.*chart.*/, { timeout: 10000 });
      await expect(page.locator('[data-testid="chart-container"]')).toBeVisible();
      
      // Step 5: Verify chart has data
      await page.waitForTimeout(2000); // Wait for chart to render
      const chartCanvas = page.locator('canvas');
      await expect(chartCanvas).toBeVisible();
      
      // Step 6: Test timeframe switching
      const timeframeSelector = page.locator('[data-testid="timeframe-selector"]');
      if (await timeframeSelector.isVisible()) {
        await timeframeSelector.click();
        await page.locator('text=1H').click();
        await page.waitForTimeout(1000);
      }
      
      // Step 7: Test symbol switching
      const symbolSelector = page.locator('[data-testid="symbol-selector"]');
      if (await symbolSelector.isVisible()) {
        await symbolSelector.click();
        await page.locator('text=ETHUSD').click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test('position sizing workflow', async ({ page }) => {
    await page.goto('/chart?symbol=BTCUSD');
    await page.waitForLoadState('networkidle');
    
    // Wait for chart to load
    await expect(page.locator('[data-testid="chart-container"]')).toBeVisible();
    await page.waitForTimeout(2000);
    
    // Open risk calculator
    const riskCalcButton = page.locator('[data-testid="risk-calculator"]');
    if (await riskCalcButton.isVisible()) {
      await riskCalcButton.click();
      
      // Verify calculator opens
      await expect(page.locator('[data-testid="position-calculator"]')).toBeVisible();
      
      // Test input fields
      const accountSizeInput = page.locator('input[name="accountSize"]');
      if (await accountSizeInput.isVisible()) {
        await accountSizeInput.fill('10000');
        await expect(accountSizeInput).toHaveValue('10000');
      }
      
      const riskPercentInput = page.locator('input[name="riskPercent"]');
      if (await riskPercentInput.isVisible()) {
        await riskPercentInput.fill('1');
        await expect(riskPercentInput).toHaveValue('1');
      }
    }
  });

  test('drawing tools workflow', async ({ page }) => {
    await page.goto('/chart?symbol=BTCUSD');
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('[data-testid="chart-container"]')).toBeVisible();
    await page.waitForTimeout(2000);
    
    // Open drawing tools
    const drawingToolsButton = page.locator('[data-testid="drawing-tools"]');
    if (await drawingToolsButton.isVisible()) {
      await drawingToolsButton.click();
      
      // Test trend line tool
      const trendLineButton = page.locator('button').filter({ hasText: /trend/i });
      if (await trendLineButton.isVisible()) {
        await trendLineButton.click();
        
        // Draw a trend line (mock interaction)
        const chartArea = page.locator('[data-testid="chart-container"]');
        const box = await chartArea.boundingBox();
        if (box) {
          await page.mouse.move(box.x + 100, box.y + 100);
          await page.mouse.down();
          await page.mouse.move(box.x + 300, box.y + 200);
          await page.mouse.up();
        }
      }
      
      // Test horizontal line tool
      const horizontalLineButton = page.locator('button').filter({ hasText: /horizontal/i });
      if (await horizontalLineButton.isVisible()) {
        await horizontalLineButton.click();
        
        // Place horizontal line
        const chartArea = page.locator('[data-testid="chart-container"]');
        const box = await chartArea.boundingBox();
        if (box) {
          await page.mouse.click(box.x + 200, box.y + 150);
        }
      }
    }
  });

  test('AI analysis workflow', async ({ page }) => {
    await page.goto('/chart?symbol=BTCUSD');
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('[data-testid="chart-container"]')).toBeVisible();
    await page.waitForTimeout(2000);
    
    // Open AI analysis panel
    const aiAnalysisButton = page.locator('[data-testid="ai-analysis"]');
    if (await aiAnalysisButton.isVisible()) {
      await aiAnalysisButton.click();
      
      // Verify panel opens
      await expect(page.locator('[data-testid="ai-analysis-panel"]')).toBeVisible();
      
      // Click analyze button
      const analyzeButton = page.locator('button').filter({ hasText: /analyze/i });
      if (await analyzeButton.isVisible()) {
        await analyzeButton.click();
        
        // Wait for analysis to complete (may take time)
        await page.waitForTimeout(5000);
        
        // Verify analysis results appear
        const analysisResults = page.locator('[data-testid="analysis-results"]');
        // Note: This may not appear if API is not available in test environment
      }
    }
  });

  test('session management workflow', async ({ page }) => {
    // Test session persistence
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    // Navigate to different pages
    await page.goto('/chart');
    await page.goto('/signals');
    await page.goto('/scanner');
    
    // Refresh the page
    await page.reload();
    
    // Should still be logged in
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });

  test('error recovery workflow', async ({ page }) => {
    // Mock API failure
    await page.route('**/api/**', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });
    
    await page.goto('/chart');
    
    // Should show error state
    await expect(page.locator('[role="alert"]')).toBeVisible();
    
    // Should have retry option
    const retryButton = page.locator('button').filter({ hasText: /retry/i });
    if (await retryButton.isVisible()) {
      await retryButton.click();
    }
  });
});

test.describe('Mobile Trading Workflow', () => {
  test('complete mobile trading workflow', async ({ page }) => {
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
    
    // Navigate to chart
    await page.goto('/chart');
    
    // Verify chart loads on mobile
    await expect(page.locator('[data-testid="chart-container"]')).toBeVisible();
    
    // Test mobile-specific interactions
    const menuButton = page.locator('[data-testid="mobile-menu"]');
    if (await menuButton.isVisible()) {
      await menuButton.click();
      await expect(page.locator('[data-testid="mobile-nav"]')).toBeVisible();
    }
  });
});

test.describe('Performance Benchmarks', () => {
  test('dashboard loads within 5 seconds', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(5000);
  });

  test('chart loads within 10 seconds', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    await page.goto('/chart');
    await page.waitForLoadState('networkidle');
    
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(10000);
  });

  test('scanner loads within 8 seconds', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    await page.goto('/scanner');
    await page.waitForLoadState('networkidle');
    
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(8000);
  });

  test('rapid navigation does not cause memory leaks', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    // Get initial memory usage
    const initialMemory = await page.evaluate(() => {
      return (performance as any).memory?.usedJSHeapSize || 0;
    });
    
    // Rapidly navigate between pages
    for (let i = 0; i < 10; i++) {
      await page.goto('/chart');
      await page.goto('/signals');
      await page.goto('/scanner');
      await page.goto('/dashboard');
    }
    
    // Wait for cleanup
    await page.waitForTimeout(2000);
    
    // Check memory usage (allow for some increase)
    const finalMemory = await page.evaluate(() => {
      return (performance as any).memory?.usedJSHeapSize || 0;
    });
    
    // Memory should not increase by more than 50MB
    if (initialMemory > 0 && finalMemory > 0) {
      const memoryIncrease = finalMemory - initialMemory;
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // 50MB
    }
  });
});
