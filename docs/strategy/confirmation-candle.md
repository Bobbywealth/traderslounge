# Confirmation Candle Rules (Shared Across Scanners)

This document defines the objective confirmation-candle logic all trade scanners must use.

## Scope

- Applies to all timeframe scanners (`M5`, `M15`, `H1`, `H4`, `D1`).
- Rules are direction-agnostic unless explicitly stated.
- Each scanner must evaluate candle **N** (current closed candle) against **N-1** (prior closed candle).

## Normalized Candle Definitions

Given a candle with `open`, `high`, `low`, `close`:

- `bodyHigh = max(open, close)`
- `bodyLow = min(open, close)`
- `bodySize = abs(close - open)`
- `range = high - low`
- `upperWick = high - bodyHigh`
- `lowerWick = bodyLow - low`

A candle is valid for pattern checks only if `range > 0` and `bodySize > 0`.

## Pattern Rules

### 1) Bullish Engulfing

Valid when all conditions are true:

1. Prior candle (`N-1`) is bearish: `close[N-1] < open[N-1]`.
2. Current candle (`N`) is bullish: `close[N] > open[N]`.
3. Current real body fully engulfs prior bearish body:
   - `bodyLow[N] <= bodyLow[N-1]`
   - `bodyHigh[N] >= bodyHigh[N-1]`

### 2) Bearish Engulfing

Valid when all conditions are true:

1. Prior candle (`N-1`) is bullish: `close[N-1] > open[N-1]`.
2. Current candle (`N`) is bearish: `close[N] < open[N]`.
3. Current real body fully engulfs prior bullish body:
   - `bodyLow[N] <= bodyLow[N-1]`
   - `bodyHigh[N] >= bodyHigh[N-1]`

### 3) Rejection Candle

A rejection candle must satisfy both wick dominance and close-location requirements.

#### Bullish Rejection

- `lowerWick / bodySize >= 1.5`
- `upperWick <= bodySize`
- `close` is in top 30% of candle range:
  - `(high - close) / range <= 0.30`

#### Bearish Rejection

- `upperWick / bodySize >= 1.5`
- `lowerWick <= bodySize`
- `close` is in bottom 30% of candle range:
  - `(close - low) / range <= 0.30`

## Trigger-Level Close Buffer

When confirmation requires a close above/below a trigger level (`triggerLevel`), enforce a minimum distance buffer.

### Instrument Buffer Units

- FX majors/non-JPY: `pipSize = 0.0001`
- JPY pairs: `pipSize = 0.01`
- Indices/CFDs/Metals: use instrument `tickSize`

### Minimum Buffer

- `minBuffer = max(2 * pipOrTickSize, spreadAdjustedBuffer)`
- If spread data is unavailable, default `spreadAdjustedBuffer = 0`.

### Close-Above Trigger (Bullish)

- Valid only if: `close >= triggerLevel + minBuffer`

### Close-Below Trigger (Bearish)

- Valid only if: `close <= triggerLevel - minBuffer`

## Timeframe Consistency Requirement

- Pattern definitions and numeric thresholds in this document are identical across all timeframes.
- Timeframe-specific strategy modules may vary in context filters (trend, session, volatility), but **must not** alter these confirmation thresholds.

## Implementation Contract

All trade-trigger scanners must import and reference this document as the canonical rule source.

- Reference path: `docs/strategy/confirmation-candle.md`
- Any rule change requires updating this document first, then scanner implementation updates in the same PR.
