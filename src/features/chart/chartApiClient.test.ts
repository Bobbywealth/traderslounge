import { describe, expect, it, vi } from 'vitest';
import { ChartApiError, createChartApiClient } from './chartApiClient';

const okResponse = (body: unknown): Response => ({
  ok: true,
  status: 200,
  json: async () => body,
} as Response);

describe('createChartApiClient', () => {
  it('normalizes, sorts, and deduplicates candle payloads', async () => {
    const fetchImpl = vi.fn(async () => okResponse({
      candles: [
        [1_700_000_060_000, '2', '4', '1', '3'],
        [1_700_000_000, '1', '3', '0.5', '2'],
        [1_700_000_000, '1.5', '3', '1', '2.5'],
      ],
    })) as unknown as typeof fetch;
    const client = createChartApiClient({ apiBase: 'https://example.test', fetchImpl });

    const candles = await client.fetchCandles('BTCUSD', '1h', { limit: 2 });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/api/candles?pair=BTCUSD&timeframe=1h&limit=2',
      expect.objectContaining({ signal: undefined }),
    );
    expect(candles).toEqual([
      { time: 1_700_000_000, open: 1.5, high: 3, low: 1, close: 2.5 },
      { time: 1_700_000_060, open: 2, high: 4, low: 1, close: 3 },
    ]);
  });

  it('forwards the abort signal', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ candles: [] })) as unknown as typeof fetch;
    const client = createChartApiClient({ fetchImpl });
    const controller = new AbortController();

    await client.fetchCandles('ETHUSD', '5m', { signal: controller.signal });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/candles?pair=ETHUSD&timeframe=5m',
      { signal: controller.signal },
    );
  });

  it('throws a typed error for non-success responses', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 } as Response)) as unknown as typeof fetch;
    const client = createChartApiClient({ fetchImpl });

    await expect(client.fetchCandles('XAUUSD', '4h')).rejects.toEqual(
      expect.objectContaining<Partial<ChartApiError>>({ name: 'ChartApiError', status: 503 }),
    );
  });
});
