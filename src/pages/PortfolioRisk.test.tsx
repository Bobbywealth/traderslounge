import { describe, it, expect } from 'vitest';

describe('PortfolioRisk page', () => {
  it('has a test suite configured', () => {
    expect(true).toBe(true);
  });

  it('imports PortfolioRisk component', async () => {
    const { default: PortfolioRisk } = await import('./PortfolioRisk');
    expect(PortfolioRisk).toBeDefined();
  });
});
