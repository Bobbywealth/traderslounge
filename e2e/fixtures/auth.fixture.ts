import { test as base, expect, type Page } from '@playwright/test';

/**
 * Custom test fixture for authentication
 */
export const test = base.extend<{
  authenticatedPage: Page;
  demoPage: Page;
}>({
  AuthenticatedPage: async ({ page }, use) => {
    // Navigate to login page
    await page.goto('/');
    
    // Fill in demo credentials
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    
    // Click login button
    await page.click('button[type="submit"]');
    
    // Wait for navigation to dashboard
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    // Verify we're logged in
    await expect(page.locator('text=Dashboard')).toBeVisible();
    
    await use(page);
  },

  DemoPage: async ({ page }, use) => {
    // Login as demo user
    await page.goto('/');
    await page.fill('input[type="email"]', 'demo@trader.com');
    await page.fill('input[type="password"]', 'demo123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    await use(page);
  },
});

export { expect };
