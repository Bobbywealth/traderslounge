import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

test.describe('Authentication', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('should display login form', async ({ page }) => {
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
  });

  test('should login with valid credentials', async ({ page }) => {
    await loginPage.login('demo@trader.com', 'demo123');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await loginPage.login('invalid@email.com', 'wrongpassword');
    await loginPage.expectError('Invalid email or password');
  });

  test('should login as demo user', async ({ page }) => {
    await loginPage.loginAsDemo();
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    // Login first
    await loginPage.login('demo@trader.com', 'demo123');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    // Click logout
    await page.locator('button').filter({ hasText: /logout/i }).click();
    
    // Should redirect to login
    await page.waitForURL('**/', { timeout: 5000 });
    await expect(loginPage.emailInput).toBeVisible();
  });

  test('should redirect to login when accessing protected route', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/', { timeout: 5000 });
    await expect(loginPage.emailInput).toBeVisible();
  });
});

test.describe('Demo User Restrictions', () => {
  test('demo user should not access admin features', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAsDemo();
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    
    // Try to access admin route
    await page.goto('/admin');
    
    // Should be redirected or show unauthorized
    const isOnAdmin = page.url().includes('/admin');
    if (isOnAdmin) {
      await expect(page.locator('text=Unauthorized')).toBeVisible();
    }
  });
});
