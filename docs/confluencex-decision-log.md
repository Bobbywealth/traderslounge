# ConfluenceX Phase 1 Decision Log

Branch: `feat/phase1-trust-consistency` (from `origin/main`).
Parked work: `feat/billing-phase5-park` (Stripe infra staged for Phase 5).
Bobby's parallel work: 5 uncommitted scanner files preserved as-is.

These decisions apply to the entire Phase 1 → Phase 5 roadmap. They were
made by BobbyHomeBot acting on Bobby's "do whats best" instruction at
2026-08-01 23:44 EDT. Bobby is free to override any of them.

## Phase ordering (Bobby's spec, locked)

- Phase 1: Trust and consistency (NOW)
- Phase 2: Core customer value (unified Market Analysis page)
- Phase 3: Alerts and personalization
- Phase 4: Forward-tested proof and learning loop
- Phase 5: Monetization (Stripe billing)

## Defaults applied (no answer from Bobby)

1. **Canonical scoring scale** — 0–100 across all pages. The 0–80 scale
   currently shown in Settings is the inconsistent one and gets unified
   into 0–100. Code in `src/utils/scoring.ts` (or wherever the scale
   helpers live) should be the single source of truth.

2. **Execution subsystem** — preserved internally for now, gated behind
   admin auth only. Demo Trader and regular customers see zero execution
   language, zero kill switch, zero operational controls. The internal
   path stays available for Bobby's later use; it is not deleted.

3. **Data provider label** — multi-provider. Show whatever provider is
   actually feeding each chart/data surface (Binance, TradeLocker, FMP).
   Do not collapse to a single provider. Always show provider name AND
   data freshness timestamp on every chart and data block.

4. **Alert delivery channels** — in-app + Telegram. Telegram bot is
   already running for ConfluenceX. Email is a later phase. Push (web
   push / mobile push) is not in scope.

5. **Demo Trader scope** — read-only trial only. No watchlists, no
   alerts, no journal-write. Confirm-the-product-only.

6. **The 5 uncommitted scanner/*.py edits** — Bobby's parallel work.
   Coding agents leave them strictly alone. They are NOT in scope for
   Phase 1. Bobby will land them separately.

## Phase 1 acceptance criteria

Bobby's literal checklist:

- [ ] Remove all execution-worker language from Positions, Settings, and
      any other customer-facing surface
- [ ] Hide operational controls from regular users
- [ ] Hide operational controls from Demo Trader
- [ ] Remove the kill switch from the customer interface entirely
- [ ] If internal/admin path needs the kill switch, gate it behind admin
      auth — never customer-visible
- [ ] One canonical scoring system (0–100) used everywhere
- [ ] Settings currently shows thresholds out of 80 — unify to 0–100
- [ ] Label data freshness on every chart/data surface
- [ ] Label data provider name on every chart/data surface
- [ ] Fix loading states (no infinite spinners, no missing loaders)
- [ ] Fix stale-data displays (clear "as of HH:MM" timestamp)
- [ ] Fix impossible-distance values (e.g. RR > 20, distances > 1000 pips)
- [ ] Fix null/NaN display errors (no raw `null`, no `0/0`, no `NaN%`)
- [ ] Phase 1 commits first, draft PR against main before any later
      phase lands

## Scope guardrails (do NOT cross in Phase 1)

- Do NOT build the unified Market Analysis page (Phase 2)
- Do NOT build alerts/personalization (Phase 3)
- Do NOT build proof/journal (Phase 4)
- Do NOT touch any Stripe code or expose any billing UI yet (Phase 5 work
  is parked under `feat/billing-phase5-park` for now)
- Do NOT touch the 5 uncommitted scanner/*.py edits
- Do NOT merge to main
- Do NOT enable Stripe live mode (irrelevant here since Phase 5 hasn't
  landed, but stays as a rule)

## Files most likely involved in Phase 1

Inspect before editing:
- `src/pages/Positions.tsx` — strip execution-worker language
- `src/pages/Settings.tsx` — strip execution language, unify scoring
- `src/pages/Signals.tsx`, `src/pages/LiveScanner.tsx`,
  `src/pages/TradingView.tsx` — fix scoring scales, null displays
- `src/components/TradingChart.tsx` — add data freshness + provider label
- `src/components/MetricCard.tsx` — null-safe, stale-safe
- `src/components/SetupCard.tsx` — null-safe, fix null/0/0
- `src/components/DecisionQualityPanel.tsx` — confirm 0–100 scale
- `src/components/PerformanceChart.tsx` — null-safe
- `src/utils/format.ts` and any scoring helpers — single source of truth
- `src/contexts/AuthContext.tsx` — confirm Demo role does not see
  operational controls
- `src/components/Header.tsx`, `src/components/Sidebar.tsx` — search
  for "kill switch" / "execution" labels

## Done = Phase 1 PR

When Phase 1 lands:
- Branch `feat/phase1-trust-consistency` is pushed
- A draft PR is open against `main` (no merge)
- Tests pass on the new code
- 7 pre-existing failures on main remain unchanged (none introduced)
- Desktop + mobile screenshots of the affected pages (no execution
  language, unified scoring, freshness + provider labels, clean null
  displays) are captured
- A short report lists every file changed and the user-visible delta
