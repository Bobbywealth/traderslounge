# Chart Improvement Plan

## Goal

Add **trend overlay indicators** to the TradingView chart: EMA, SMA, VWAP, and Bollinger Bands. Computed client-side from the existing candle data — no API changes needed. Indicators toggle on/off in the existing chart Settings popup under a new "Indicators" tab.

## Scope (v1)

**In:** EMA (20/50/200), SMA (50/200), VWAP, Bollinger Bands (20, 2σ). Single price pane only, no separate sub-panes.
**Out:** RSI, MACD, Stochastic, ATR bands, multi-pane layout. (Tracked as v2 if appetite remains.)

## Context

- Chart library: `lightweight-charts` v5 (already pinned).
- Series API: `chart.addSeries(LineSeries, { ... })` for trend lines, `chart.addSeries(CandlestickSeries, ...)` for price.
- Candle data lives in `candleCacheRef.current[`${symbol}:${tf}`]` — already an array of `CandlestickData` with `time/open/high/low/close`.
- Existing pattern overlays at `src/pages/TradingView.tsx:1065-1102` (S/R, Fibonacci) shows how series are added and torn down on `chartRevision` / `cryptoAnalysis` change.
- Existing Settings popup at `src/pages/TradingView.tsx:1646` toggles harmonics, S/R, fib, setups, drawings via `<input type="checkbox">`. This is where the new Indicators tab lives.
- localStorage usage is already in place (`confluencex:drawings:…`). Indicator state should also persist per user (not per symbol/timeframe) — same set applies across the workspace.

## Calculation rules (canonical)

All computed in pure functions inside `src/utils/indicators.ts` to keep `TradingView.tsx` from growing further.

- **SMA(period)**: arithmetic mean of last `period` closes. Output: one value per source candle starting at index `period - 1`.
- **EMA(period)**: `α = 2 / (period + 1)`. Seed with SMA of first `period` closes. Standard recursive formula.
- **VWAP**: cumulative `(typical * volume) / cumulative volume`, where `typical = (h + l + c) / 3`. **Anchored to the session** — reset cumulative sums at the start of each session (00:00 UTC for crypto, NY 00:00 for forex/gold via the asset class). See "VWAP session anchor" below.
- **Bollinger Bands (20, 2σ)**: SMA(20) as middle, ±2 standard deviations of last 20 closes as upper/lower. No extra smoothing.

**VWAP session anchor** — derive from `BWTS_SYMBOLS[*].type` (already in scope):
- `crypto` → reset at 00:00 UTC
- `forex` / `commodity` / `stock` → reset at 00:00 America/New_York (local forex session open)

Implementation: include a `sessionStart(time, assetType)` helper that returns the UTC timestamp of the current session's start, then compare current candle's time to detect a boundary.

## File changes

### 1. NEW: `src/utils/indicators.ts`

Pure functions, no React or lightweight-charts imports. Exposed types:

```ts
export type IndicatorConfig = {
  ema20: boolean; ema50: boolean; ema200: boolean;
  sma50: boolean; sma200: boolean;
  vwap: boolean;
  bollinger: boolean;
};
export const DEFAULT_INDICATORS: IndicatorConfig = {
  ema20: false, ema50: true, ema200: false,
  sma50: false, sma200: false,
  vwap: false,
  bollinger: false,
};
export function sma(closes: number[], period: number): Array<number | null>;
export function ema(closes: number[], period: number): Array<number | null>;
export function vwapSeries(candles: CandlestickData[], assetType: AssetClass): Array<number | null>;
export function bollinger(closes: number[], period: number, mult: number): {
  upper: Array<number | null>; middle: Array<number | null>; lower: Array<number | null>;
};
export function sessionStart(time: number, assetType: AssetClass): number;
```

All outputs are aligned to the input candle array index — `null` while the window is too short. Caller drops `null` points before `series.setData`.

### 2. `src/pages/TradingView.tsx` — add state, computation, render

- **State** (one place, near the other `show*` booleans around line 167):
  ```ts
  const [indicators, setIndicators] = useState<IndicatorConfig>(() => {
    try { return { ...DEFAULT_INDICATORS, ...JSON.parse(localStorage.getItem('confluencex:indicators') || '{}') }; }
    catch { return DEFAULT_INDICATORS; }
  });
  useEffect(() => { localStorage.setItem('confluencex:indicators', JSON.stringify(indicators)); }, [indicators]);
  ```

- **Refs** for series cleanup (mirrors `v2LevelSeriesRefs.current` pattern around line 1069):
  ```ts
  const indicatorSeriesRefs = useRef<{ id: string; line?: ISeriesApi<'Line'>; upper?: ISeriesApi<'Line'>; lower?: ISeriesApi<'Line'> }[]>([]);
  ```

- **Render effect** keyed on `[indicators, chartRevision, selectedSymbol, timeframe, currentPrice, candleCacheRef.current]`. Dependency on the cache is implicit because we read it inside the effect; to force re-render when the latest candle updates, also depend on `currentPrice` (already updated at 100ms throttle from the WS). 
  - For each enabled indicator, compute the series, build `{ time, value }[]` skipping nulls, add a `LineSeries`, then `setData` and push to `indicatorSeriesRefs.current`.
  - On cleanup, remove all series in the ref and reset the array. Run on each re-render so toggles and symbol/timeframe changes work.
  - Style: pick canonical colors and 1.2 line width to match the existing S/R / Fib aesthetic. Use the same `LineStyle` enum (`Solid` for EMAs/SMA/VWAP middle, `Dashed` for Bollinger upper/lower).
  - Bollinger: three series (upper / middle / lower) sharing one logical entry so toggles are atomic.

- **Settings popup** — replace the flat list at `src/pages/TradingView.tsx:1646` with a small tabbed panel:
  - Two tabs: "Overlays" (existing checkboxes) and "Indicators" (new).
  - Indicators tab shows the EMA/SMA/VWAP/Bollinger list with live color swatches and a numeric period badge for context (e.g., "EMA 50"). Periods are fixed in v1 — no period edit UI yet.
  - Use the same `showSettings` boolean. Persist last-selected tab in state.

### 3. Validation hooks

- `src/utils/indicators.test.ts` — vitest unit tests:
  - SMA returns correct values for a known sequence (e.g., `[1..10]` → 5.5 at index 4).
  - EMA seed matches SMA; EMA reacts faster than SMA (assert a one-step move yields larger EMA delta).
  - Bollinger upper/lower symmetric around middle; known sequence gives expected σ.
  - VWAP resets at the session boundary (verify a candle at 23:59 UTC vs 00:01 UTC shows a discontinuity).
  - `sessionStart` returns the right anchor for `crypto` vs `forex` (mock `Date.now`).

## Risks & mitigations

- **Compute cost on long history** — v5 chart loads ~250 candles. EMA(200) over 250 closes is trivial. BW/Vol are O(n). No perf concern.
- **Reset on symbol/timeframe change** — VWAP needs to re-anchor per symbol. The render effect already fires on `selectedSymbol`/`timeframe` change, so passing the new `assetType` resolves it.
- **Series not torn down on hot reload** — `useEffect` cleanup must remove all series every cycle. Mirror the existing `v2LevelSeriesRefs.current` cleanup loop.
- **Color collisions with existing overlays** — Bollinger ±2σ lines and Bollinger middle share indigo/cyan with Fib levels. Use distinct hues: EMA/SMA in cool gradient (cyan → violet), VWAP in amber, Bollinger in slate-gray with reduced opacity.
- **Persist correctness** — `localStorage` is fine; on first load the merge with `DEFAULT_INDICATORS` keeps unknown keys (e.g., future Bollinger period) from breaking.
- **Determinism** — All computation is pure and seed-based. No time-of-day nondeterminism inside the indicator.

## Deployment & validation

1. Run `npm test -- src/utils/indicators.test.ts` (vitest is already wired — same script as `Dashboard.test.tsx`).
2. Run `npm run build` to confirm no TS errors.
3. Visually verify on `http://localhost:5173/`:
   - Toggle EMA 50 on EURUSD H1 → smooth purple line tracks price.
   - Toggle Bollinger on BTCUSD 15m → three dashed gray lines forming a band.
   - Toggle VWAP on EURUSD → resets at NY 00:00.
   - Navigate symbol/timeframe → indicators recompute, no stale lines.
   - Reload page → previous selection resets.
4. Stage on `feature/chart-trend-indicators` branch, push to verify deploy, then merge to `main`.

## Out of scope (v2 ideas)

- RSI / MACD / Stochastic in separate sub-panes.
- User-editable periods (e.g., EMA 26).
- Alerts on indicator crosses (e.g., EMA50 cross).
- Indicator presets ("Trend", "Mean Reversion", "Breakout").
- Save indicator layouts per symbol like manual drawings do.
