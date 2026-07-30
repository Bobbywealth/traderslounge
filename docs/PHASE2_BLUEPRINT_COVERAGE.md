# Phase 2 — Full Blueprint Coverage

Branch: `phase2/full-blueprint-coverage` off `main` (post-Phase 1 merge).

This phase implements the remaining sections of Bobby's 21-section
institutional asset-analysis blueprint that Phase 1 deferred:

  - §2 Volume
  - §3 Order Flow & Liquidity (institutional surface)
  - §4 Stochastic RSI / CCI / SuperTrend / Ichimoku
  - §9 Candlestick Patterns (institutional surface)
  - §12 On-Chain
  - §13 Fundamentals
  - §14 Sentiment
  - §15 Correlation Analysis
  - §16 Relative Strength

It also documents the two sections that remain out of scope for the
crypto-first product:

  - §10 Implied Volatility — requires options markets (no crypto IV).
  - §11 Options Flow — requires options markets; deferred until
    stocks/ETFs are added.

## What ships in this phase

| § | Module | Data sources |
|---|---|---|
| 2 | `volume.py` | Surfaces RVol / VWAP / OBV + regime from the canonical analyzer |
| 3 | `liquidity_institutional.py` | Surfaces FVGs, order blocks, equal-highs/lows, volume profile |
| 4 | `additional_indicators.py` | Surfaces StochRSI, CCI, SuperTrend, Ichimoku + consensus vote |
| 9 | `candlestick_patterns.py` | Surfaces patterns with confidence + directional implication |
| 12 | `onchain.py` | CoinGecko supply (free) + Binance USD-M funding/OI/L/SR (geo-blocked from US) |
| 13 | `fundamentals.py` | CoinGecko metadata + DefiLlama TVL (free) |
| 14 | `sentiment.py` | alternative.me Fear & Greed Index + CoinDesk RSS keyword classifier |
| 15 | `correlation.py` | Pairwise log-return correlations across available scanner pairs |
| 16 | `relative_strength.py` | RS pct vs BTC (crypto) or USDJPY (FX/metal); leadership ranking |

## Data-provider layer (`scanner/data_providers/`)

Six free, keyless wrappers, all stdlib-only urllib with retry /
timeout:

  - `_http.py` — shared `get_json`, `get_text`, `HttpError`.
  - `fear_greed.py` — alternative.me Fear & Greed.
  - `defillama.py` — TVL for any protocol (https://api.llama.fi/).
  - `coingecko.py` — coin metadata, supply, market data
    (https://api.coingecko.com/api/v3/).
  - `binance_futures.py` — Binance USD-M funding rate, OI,
    long/short ratio, top trader ratio. **Geo-blocked from US
    egress (HTTP 451)**. Wrappers exist so the institutional block
    reports `available: False reason: geo_blocked_or_unreachable`
    honestly when Render hits the wall; lights up automatically when
    the deploy region or provider changes.
  - `bybit.py` — alternative non-US futures provider (same geo
    caveat as Binance).
  - `coindesk_rss.py` — CoinDesk RSS news parser (stdlib XML).

When a metric requires a paid provider (whale alerts, MVRV, NVT,
active addresses, ETF flows, token unlocks, regulatory news
aggregation, social sentiment, analyst ratings), the institutional
module reports it under ``unavailable`` with an explicit reason so
the renderer can show the gap rather than fabricated values.

## Files added in Phase 2

```
scanner/data_providers/__init__.py
scanner/data_providers/_http.py
scanner/data_providers/fear_greed.py
scanner/data_providers/defillama.py
scanner/data_providers/coingecko.py
scanner/data_providers/binance_futures.py
scanner/data_providers/bybit.py
scanner/data_providers/coindesk_rss.py

scanner/modules/institutional/volume.py
scanner/modules/institutional/liquidity_institutional.py
scanner/modules/institutional/additional_indicators.py
scanner/modules/institutional/candlestick_patterns.py
scanner/modules/institutional/onchain.py
scanner/modules/institutional/fundamentals.py
scanner/modules/institutional/sentiment.py
scanner/modules/institutional/correlation.py
scanner/modules/institutional/relative_strength.py

tests/test_institutional_volume.py
tests/test_institutional_liquidity.py
tests/test_institutional_additional_indicators.py
tests/test_institutional_candlestick_patterns.py
tests/test_institutional_sentiment.py
tests/test_institutional_data_providers.py
tests/test_institutional_onchain.py
tests/test_institutional_fundamentals.py
tests/test_institutional_correlation.py

docs/PHASE2_BLUEPRINT_COVERAGE.md (this file)
```

## Sections explicitly out of scope

| § | Reason |
|---|---|
| 10 Implied Volatility | Requires options markets; crypto spot markets don't have IV. Would only matter if we later add stock/ETF scope. |
| 11 Options Flow (P/C, GEX, dealer, OI, max pain, blocks) | Same. Out of crypto scope; deferred until a stock/ETF asset class is added. |

## Design rules (carried forward from Phase 1)

1. **No score mutation.** No Phase 2 module touches `total_score`,
   `CAPS`, `direction`, or any existing gate. All outputs are
   report-only fields under `analysis["institutional"]`.
2. **No fabrication.** Missing data → `{"available": False,
   "reason": "..."}` with an explicit reason. Provider-required
   metrics that are geo-blocked, auth-walled, or paywalled are
   listed under the section's ``unavailable`` block, never guessed.
3. **Estimate labeling.** Every section that uses provider data
   that isn't fully deterministic (sentiment scores, scenario
   probabilities, AB=CD ratios, Elliott counts, RS-vs-benchmark
   math) tags its output ``kind: "estimate"`` with a per-module
   disclaimer.
4. **Stdlib only.** New HTTP layer uses only ``urllib.request``,
   ``json``, ``xml.etree.ElementTree``; mirrors the rest of the
   scanner.
5. **Defensive try/except.** Every provider call is wrapped in
   :func:`_try` (or equivalent) so a transient provider failure
   becomes a structured ``{"status": ..., "reason": ...}``
   instead of a 500 error on the canonical endpoint.

## Test status

- 49 new Phase 2 tests pass.
- Full suite: 265 tests, 13 failures + 3 errors — same as
  pre-Phase-2 baseline. The 1 test that changed status
  (`test_build_institutional_returns_all_sections`) was updated to
  enumerate the Phase 1 + Phase 2 section set; no behavioral change
  to existing tests.

## Live verification

After pushing and Render auto-deploy, every pair on
``/api/analysis`` now returns:

  - 11 Phase 1 sections (unchanged)
  - 4 surfaced-inline Phase 2 sections
  - 5 provider-dependent Phase 2 sections (some `available: False`
    when the provider is geo-blocked, with explicit reason)
  - 5 composite sections (unchanged)

for a total of **25 institutional sections** in the canonical
analysis response. The canonical published-signals feed remains
byte-equivalent (the wrapper is pure additive attachment).

## Honest gaps that remain even after Phase 2

These require paid providers or additional egress. The institutional
block surfaces them under each section's ``unavailable`` map:

  - On-chain: exchange inflows, whale alerts, MVRV, NVT, active
    addresses, miner activity (Glassnode / CryptoQuant / CoinMetrics
    / Whale Alert).
  - Fundamentals: token unlock schedules (TokenUnlocksApp / Messari),
    ETF flows (Coinglass Pro / Farside Investors), developer activity
    (GitHub API is rate-limited).
  - Sentiment: social sentiment (LunarCrush / Santiment), Google
    Trends, curated regulatory / analyst feeds.
  - Correlation: SPX, NASDAQ, Gold, DXY, UST yields (Twelve Data /
    Polygon / FRED).

These are all explicit, paid-provider-requiring gaps. When a key is
added (or a non-US Render region is provisioned for futures APIs),
the corresponding institutional sections light up automatically
without code changes — the wrappers and modules already exist.