import { describe, expect, it } from 'vitest';
import { ChartRequestController, isAbortError } from './chartRequestController';

describe('ChartRequestController', () => {
  it('aborts the previous request when a new request begins', () => {
    const controller = new ChartRequestController();
    const first = controller.begin();
    const second = controller.begin();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(controller.isCurrent(first)).toBe(false);
    expect(controller.isCurrent(second)).toBe(true);
  });

  it('invalidates the current request when cancelled', () => {
    const controller = new ChartRequestController();
    const token = controller.begin();

    controller.cancel();

    expect(token.signal.aborted).toBe(true);
    expect(controller.isCurrent(token)).toBe(false);
  });
});

describe('isAbortError', () => {
  it('recognizes DOM and plain-object abort errors', () => {
    expect(isAbortError(new DOMException('cancelled', 'AbortError'))).toBe(true);
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError(new Error('network failed'))).toBe(false);
  });
});
