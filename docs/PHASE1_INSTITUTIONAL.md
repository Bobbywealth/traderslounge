# Phase 1 — Institutional Multi-Factor Analysis (OHLCV-only)

Branch: `phase1/institutional-multi-factor` off `Bobbywealth/traderslounge` `main`
at commit `047e425` (2026-07-30).

This phase delivers the OHLCV-only subset of Bobby's 21-section
institutional asset-analysis blueprint against the existing V2
analyzer. The on-chain, options-flow, fundamental, broad-sentiment,
and broad-correlation work is deferred to a later provider-integration
phase.

## Design rules (enforced everywhere)

1. **No score mutation.** No Phase 1 module touches `total_score`,
   `CAPS`, `direction`, or any existing gate. All outputs are
   report-only fields under `analysis["institutional"]`.
2. **No fabrication.** Missing data → `{"available": False, ...}`.
   Never invented numbers.
3. **Estimate labeling.** Every Elliott count, AB=CD candidate, and
   scenario probability is tagged `"kind": "estimate"`. Renderers and
   backtesters can distinguish estimate-only from measured numbers.
4. **Stdlib only.** Mirrors the rest of the scanner. No new deps.
5. **Canonical plan is the only publishable.** Day and position
   variants are reference sketches; Signals publication still uses
   `published_signals.build_published_signal` against the canonical
   `trade_plan`.

## What ships in this phase

| Blueprint § | Module | Output (under `analysis.institutional.*`) |
|---|---|---|
| 1 (MTF structure) | `market_structure_mtf.py` | `per_timeframe` (D1/H4/H1 trend, BOS, CHOCH, last swing), `composite` (agreement %, conflicting TFs) |
| 4 (RSI hidden div) | `hidden_divergence.py` | `hidden_bullish`, `hidden_bearish`, swing window, RSI last |
| 4 (MACD) | `macd_interpret.py` | `line`, `signal`, `histogram`, `crossover_state`, `histogram_momentum`, `divergence_hint`, `side_of_zero` |
| 7 (Elliott) | `elliott.py` | `primary` (structure, current_wave, next_expected, rules_passed/failed, confidence), `alternative` |
| 8 (AB=CD) | `ab_cd.py` | `candidates[]` (each with ratio, actual_ratio, bc_retrace_pct, completion_pct, pivots, projected_d) |
| 10 (HV) | `historical_volatility.py` | `current_hv_annualized`, `p20`, `p80`, `regime` (compressed / normal / expanded) |
| 17 (Scenarios) | `scenarios.py` | `scenarios.bull/base/bear` (probability_pct, target, rr_estimate), `entry_source`, `eligible` |
| 18 (Plans) | `trade_plans.py` | `plans.day/swing/position` (entry, stop, tp1, tp2, rr_tp1, rr_tp2, eligible, reason) |
| 19 (Risk 1–10) | `risk_rating.py` | `rating`, `label`, `raw_score`, `components` (htf_disagreement, vol_regime, calendar, bwts_score_band, freshness) |
| 20 (Monitoring) | `monitoring.py` | `alerts[]` (invalidation, HTF conflict, calendar, volume confirmation, vol regime, risk rating, divergence hints) |
| 21 (Exec summary) | `executive_summary.py` | `bias`, `conviction_pct`, `best_rr`, `horizon`, `key_levels[]`, `invalidation`, `thesis_text` |

## What still does NOT ship in Phase 1

The following blueprint sections are intentionally deferred because
they require provider integration beyond OHLCV:

- **11 (Options Flow)** — P/C, GEX, dealer positioning, OI, max pain,
  unusual activity, block trades. Not applicable to crypto-first
  scope; needs stock/ETF provider when that scope is added.
- **12 (On-Chain)** — exchange flows, whale activity, stablecoin
  inflows, miners, funding, OI, liquidations, L/S, MVRV, NVT,
  dormancy, active addresses. Needs a separate data source.
- **13 (Fundamentals)** — tokenomics, TVL, developer activity, ETF
  developments, regulatory news. News utilities already exist in the
  repo but don't feed the V2 score; wiring them in is a separate task.
- **14 (Sentiment)** — Fear & Greed Index, social, Google Trends,
  news sentiment aggregation, retail positioning, analyst ratings.
  Needs provider integrations.
- **15 (Correlation)** — broad matrix against SPX/NQ/BTC/Gold/DXY/UST
  yields/sector ETFs/peers. One-benchmark correlation already exists;
  the full matrix is deferred.

## Files added in Phase 1

```
scanner/modules/institutional/__init__.py          — aggregator + wrapper
scanner/modules/institutional/_imports.py           — re-exports helpers
scanner/modules/institutional/market_structure_mtf.py
scanner/modules/institutional/hidden_divergence.py
scanner/modules/institutional/macd_interpret.py
scanner/modules/institutional/elliott.py
scanner/modules/institutional/ab_cd.py
scanner/modules/institutional/historical_volatility.py
scanner/modules/institutional/scenarios.py
scanner/modules/institutional/trade_plans.py
scanner/modules/institutional/risk_rating.py
scanner/modules/institutional/monitoring.py
scanner/modules/institutional/executive_summary.py

tests/test_institutional_init.py
tests/test_institutional_mtf_structure.py
tests/test_institutional_hidden_divergence.py
tests/test_institutional_macd.py
tests/test_institutional_elliott.py
tests/test_institutional_ab_cd.py
tests/test_institutional_historical_volatility.py
tests/test_institutional_scenarios.py
tests/test_institutional_trade_plans.py
tests/test_institutional_risk_rating.py
tests/test_institutional_monitoring.py
tests/test_institutional_executive_summary.py
tests/test_institutional_analyze_with_institutional.py

docs/PHASE1_INSTITUTIONAL.md (this file)
```

53 new tests, all passing. No regressions in existing tests
(pre-existing 13 failures + 3 errors in `trade_manager_persistence`
unaffected by this work).

## How to call

```python
from scanner.modules.institutional import (
    build_institutional,        # attach to an existing analysis dict
    analyze_with_institutional, # wrapper around crypto_analysis.analyze_crypto
)

# Option A: opt-in wrapper (recommended)
result = analyze_with_institutional(snapshot, calendar_state="CLEAR")
# result["institutional"] is the new block
# all other top-level fields identical to analyze_crypto(snapshot)

# Option B: build the block from an existing analysis dict
analysis = analyze_crypto(snapshot)
analysis["institutional"] = build_institutional(
    analysis, snapshot, calendar_state="CLEAR", primary_timeframe="1h",
)
```

## Operational constraints still binding

- **Render billing is suspended.** The live API is not responding
  (the SPA shell is served but `/api/*` falls through). Until billing
  is restored, Phase 1 cannot be deployed or tested end-to-end
  against live data.
- **V2 BTCUSD backtest still crashes** with `unhashable type: 'dict'`.
  Any Phase 1 claim that says "backtest-validated" must wait for that
  fix first.
- **Auth remediation is in flight.** Phase 1 does not touch the auth
  path; the in-memory JWT + localStorage refresh-token plan approved
  on 2026-07-30 remains the active auth workstream.
- **Phase 1 does not claim statistical calibration.** Elliott counts,
  AB=CD ratios, and scenario probabilities are explicit estimates,
  not provider-backed or statistically calibrated. Renderers and
  downstream consumers must respect the `kind: "estimate"` tag and the
  per-module disclaimer strings.

## Validation plan before shipping

Before this branch merges to `main` or ships to production, the
following must happen:

1. Restore Render billing so the API can serve the new code.
2. Fix the V2 BTC backtest crash and the FX validation gap.
3. Re-run the live Signals feed against the wrapper and confirm the
   canonical `published_signals` block is byte-equivalent to the
   pre-Phase-1 output (the wrapper must not mutate the canonical
   analysis).
4. Spot-check 5–10 real pairs through the wrapper and confirm each
   `institutional` section is populated, every estimate is tagged,
   and missing data returns `available: False` rather than zeros.
5. Frontend opt-in: the institutional block is opt-in, so the
   existing dashboard/scanner/signals UI does not need changes to
   ship Phase 1; the renderer work that exposes the new fields is a
   follow-on UI task.