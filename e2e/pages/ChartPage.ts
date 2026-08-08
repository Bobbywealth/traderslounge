import { type Page, type Locator } from '@playwright/test';

/**
 * Page object for the chart/trading view page
 */
export class ChartPage {
  readonly page: Page;
  readonly chartContainer: Locator;
  readonly loadingSpinner: Locator;
  readonly errorMessage: Locator;
  readonly retryButton: Locator;
  readonly symbolSelector: Locator;
  readonly timeframeSelector: Locator;
  readonly drawingTools: Locator;
  readonly indicatorsPanel: Locator;
  readonly riskCalculator: Locator;
  readonly aiAnalysisPanel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.chartContainer = page.locator('[data-testid="chart-container"]');
    this.loadingSpinner = page.locator('[data-testid="chart-loading"]');
    this.errorMessage = page.locator('[data-testid="chart-error"]');
    this.retryButton = page.locator('button').filter({ hasText: /retry/i });
    this.symbolSelector = page.locator('[data-testid="symbol-selector"]');
    this.timeframeSelector = page.locator('[data-testid="timeframe-selector"]');
    this.drawingTools = page.locator('[data-testid="drawing-tools"]');
    this.indicatorsPanel = page.locator('[data-testid="indicators-panel"]');
    this.riskCalculator = page.locator('[data-testid="risk-calculator"]');
    this.aiAnalysisPanel = page.locator('[data-testid="ai-analysis"]');
  }

  async goto(symbol?: string) {
    const url = symbol ? `/chart?symbol=${symbol}` : '/chart';
    await this.page.goto(url);
  }

  async waitForChartLoad() {
    await this.chartContainer.waitFor({ state: 'visible', timeout: 30000 });
    // Wait for loading to complete
    await this.loadingSpinner.waitFor({ state: 'hidden', timeout: 30000 });
  }

  async expectChartLoaded() {
    await this.chartContainer.waitFor({ state: 'visible', timeout: 10000 });
  }

  async expectError() {
    await this.errorMessage.waitFor({ state: 'visible', timeout: 5000 });
  }

  async clickRetry() {
    await this.retryButton.click();
  }

  async selectSymbol(symbol: string) {
    await this.symbolSelector.click();
    await this.page.locator(`text=${symbol}`).click();
  }

  async selectTimeframe(timeframe: string) {
    await this.timeframeSelector.click();
    await this.page.locator(`text=${timeframe}`).click();
  }

  async openDrawingTools() {
    await this.drawingTools.click();
  }

  async openIndicators() {
    await this.indicatorsPanel.click();
  }

  async openRiskCalculator() {
    await this.riskCalculator.click();
  }

  async openAiAnalysis() {
    await this.aiAnalysisPanel.click();
  }

  async expectNoWhiteScreen() {
    // Verify the page didn't crash to a white screen
    const body = this.page.locator('body');
    await expect(body).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
}
