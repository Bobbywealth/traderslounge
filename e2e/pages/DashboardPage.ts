import { type Page, type Locator } from '@playwright/test';

/**
 * Page object for the dashboard page
 */
export class DashboardPage {
  readonly page: Page;
  readonly title: Locator;
  readonly loadingSpinner: Locator;
  readonly errorMessage: Locator;
  readonly marketCards: Locator;
  readonly signalList: Locator;
  readonly refreshButton: Locator;
  readonly killSwitchIndicator: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.locator('h1, h2').filter({ hasText: /dashboard/i });
    this.loadingSpinner = page.locator('[data-testid="loading-spinner"]');
    this.errorMessage = page.locator('[role="alert"]');
    this.marketCards = page.locator('[data-testid="market-card"]');
    this.signalList = page.locator('[data-testid="signal-list"]');
    this.refreshButton = page.locator('button').filter({ hasText: /refresh/i });
    this.killSwitchIndicator = page.locator('[data-testid="kill-switch"]');
  }

  async goto() {
    await this.page.goto('/dashboard');
  }

  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  async expectLoaded() {
    await this.title.waitFor({ state: 'visible', timeout: 10000 });
  }

  async expectLoading() {
    await this.loadingSpinner.waitFor({ state: 'visible', timeout: 5000 });
  }

  async expectError() {
    await this.errorMessage.waitFor({ state: 'visible', timeout: 5000 });
  }

  async getMarketCardCount() {
    return await this.marketCards.count();
  }

  async clickRefresh() {
    await this.refreshButton.click();
  }

  async expectKillSwitchActive() {
    await this.killSwitchIndicator.waitFor({ state: 'visible' });
  }
}
