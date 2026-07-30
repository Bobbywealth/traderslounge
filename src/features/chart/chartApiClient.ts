import { normalizeCandleSeries, type CandlestickData, type HistoryCandle } from './chartData';

export interface FetchCandlesOptions {
  limit?: number;
  signal?: AbortSignal;
}

export interface ChartApiClientOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export interface CandlePayload {
  candles?: HistoryCandle[];
}

export class ChartApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Failed to fetch BWTS candles: ${status}`);
    this.name = 'ChartApiError';
    this.status = status;
  }
}

export function createChartApiClient(options: ChartApiClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBase = options.apiBase ?? (
    import.meta.env.VITE_BWTS_API_URL || import.meta.env.VITE_API_URL || ''
  );

  return {
    async fetchCandles(
      symbol: string,
      timeframe: string,
      request: FetchCandlesOptions = {},
    ): Promise<CandlestickData[]> {
      const params = new URLSearchParams({
        pair: symbol,
        timeframe,
        ...(request.limit ? { limit: String(request.limit) } : {}),
      });
      const response = await fetchImpl(`${apiBase}/api/candles?${params.toString()}`, {
        signal: request.signal,
      });

      if (!response.ok) throw new ChartApiError(response.status);

      const payload = await response.json() as CandlePayload;
      return normalizeCandleSeries(payload.candles ?? []);
    },
  };
}

export type ChartApiClient = ReturnType<typeof createChartApiClient>;
