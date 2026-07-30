export interface ChartRequestToken {
  id: number;
  signal: AbortSignal;
}

/**
 * Coordinates chart-related HTTP requests so fast symbol/timeframe changes
 * cannot commit stale responses into the active workspace.
 */
export class ChartRequestController {
  private requestId = 0;
  private controller: AbortController | null = null;

  begin(): ChartRequestToken {
    this.controller?.abort();
    this.controller = new AbortController();
    this.requestId += 1;

    return {
      id: this.requestId,
      signal: this.controller.signal,
    };
  }

  isCurrent(token: Pick<ChartRequestToken, 'id'>): boolean {
    return token.id === this.requestId && !this.controller?.signal.aborted;
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : Boolean(
        error
        && typeof error === 'object'
        && 'name' in error
        && (error as { name?: unknown }).name === 'AbortError',
      );
}
