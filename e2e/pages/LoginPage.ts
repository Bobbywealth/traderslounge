import { type Page, type Locator } from '@playwright/test';

/**
 * Page object for the login page
 */
export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly error_message: Locator;
  readonly demoButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('input[type="email"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.loginButton = page.locator('button[type="submit"]');
    this.error_message = page.locator('[role="alert"]');
    this.demoButton = page.locator('text=Try Demo');
  }

  async goto() {
    await this.page.goto('/');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async loginAsDemo() {
    await this.demoButton.click();
  }

  async expectError(message: string) {
    await this.error_message.waitFor({ state: 'visible' });
    await this.error_message.filter({ hasText: message });
  }
}
