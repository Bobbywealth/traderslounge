import { describe, it, expect } from 'vitest';

describe('Calibration Page', () => {
  it('has a test suite configured', () => {
    expect(true).toBe(true);
  });

  it('imports the Calibration component', async () => {
    const { default: Calibration } = await import('./Calibration');
    expect(Calibration).toBeDefined();
  });
});
