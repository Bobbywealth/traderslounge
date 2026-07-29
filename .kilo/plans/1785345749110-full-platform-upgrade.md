# Traders Lounge - Full Platform Upgrade Plan

## Executive Summary

Traders Lounge is a multi-asset trading decision-support platform with React frontend, Python scanner backend, and dual scoring systems (V1 forex/gold 80pt, V2 crypto 100pt). The system supports forex, gold, and crypto markets via Twelve Data and Binance.

**Critical Issues Found:**
- Crypto-specific terminology contaminates forex/gold UI
- Two separate scoring systems with no unified treatment
- No authentication on any API endpoint
- N+1 request patterns in Dashboard/Scanner
- Hardcoded API keys in source code
- No formal lifecycle states - signals regenerate fresh each scan with no expiration
- Default symbol is BTCUSD instead of EURUSD
- No confidence framework with coverage percentage

**Scope:** 40 sections from master prompt, implementing over ~150 discrete requirements.

---

## Phase 1 — Credibility and Terminology (High Priority)

### 1.1 Multi-Asset Terminology Refactor
**Files to change:**
- `src/pages/Dashboard.tsx` — Remove "Full-spectrum crypto engine", "Ranked crypto market states", "CRYPTO CONFLUENCE ENGINE"
- `src/pages/LiveScanner.tsx` — Remove hardcoded BTCUSD references
- `src/pages/LandingPage.tsx` — Replace BTCUSD/ETHUSD/SOLUSD with forex/gold pairs
- `src/services/bwtsApi.ts` — Remove `asset_class: 'crypto'` hardcode
- `src/components/Header.tsx` — Update any crypto references
- `src/pages/Signals.tsx` — Remove crypto-specific refresh list

**New terminology:**
- `MarketAnalysis` instead of `CryptoAnalysis`
- `Confluence Intelligence Engine` instead of `Crypto Confluence Engine`
- `Ranked Market Opportunities` instead of `Ranked crypto market states`
- `Confluence Score` instead of `V2 Score`
- `Opportunity Queue` instead of `V2 Priority Queue`
- `Build Trade Plan` instead of `Build V2 plan`

### 1.2 Asset Class Metadata
Add asset class classification to all market displays:
```typescript
type AssetClass = 'forex' | 'metals' | 'cryptocurrency' | 'indices' | 'commodities';

interface MarketInfo {
  symbol: string;
  displayName: string;
  baseAsset: string;
  quoteAsset: string;
  assetClass: AssetClass;
  pipSize: number;
  contractSize: number;
  dataProvider: string;
  session: string;
  timezone: string;
}
```

### 1.3 Score Coverage and Confidence Framework
**Files to change:**
- `scanner/crypto_analysis.py` — Add coverage calculation
- `scanner/api.py` — Expose coverage in API response
- `src/types/signals.ts` — Add Coverage, Confidence types
- `src/pages/Dashboard.tsx` — Display coverage % and confidence tier

**Required API fields per analysis:**
```json
{
  "confluence_score": 73,
  "available_points": 67,
  "max_points": 100,
  "coverage": 0.67,
  "confidence": "moderate",
  "confidence_tier": "qualified",
  "missing_categories": ["volume", "fibonacci"],
  "stale_categories": [],
  "positive_contributors": ["structure", "momentum"],
  "negative_contributors": ["liquidity"],
  "categories_confirmed": 6,
  "categories_unavailable": 2,
  "data_freshness_seconds": 120,
  "analysis_timestamp": "2026-07-29T13:00:00Z",
  "market_data_timestamp": "2026-07-29T12:59:45Z",
  "snapshot_id": "abc123",
  "model_version": "v2.1.0"
}
```

**Confidence tier rules (configurable):**
- Coverage < 50%: maximum tier = WATCH
- Coverage 50-74%: maximum tier = DEVELOPING
- Coverage 75-89%: maximum tier = QUALIFIED
- Coverage >= 90%: eligible for HIGH

### 1.4 Missing Data Behavior Audit
Audit all modules for silent zero-points behavior:
- `modules/htf_bias.py` — Returns NEUTRAL + 0 points when insufficient data
- `modules/adr_calculator.py` — Returns None when insufficient data
- `modules/fibonacci.py` — Returns 0 points with "No recent swing leg"
- `modules/market_structure.py` — Returns 0 points with "Insufficient LTF data"
- `modules/liquidity.py` — Returns 0 points with "Insufficient data"
- `modules/rsi_filter.py` — Returns 0 points with "Insufficient data for RSI"

**Fix:** Distinguish clearly between UNAVAILABLE, NEUTRAL, BEARISH, BULLISH, STALE, ERROR, INSUFFICIENT_SAMPLE.

### 1.5 Economic Event Risk Banner
**Files to change:**
- `src/components/EconomicRiskBanner.tsx` — NEW component
- `src/pages/Dashboard.tsx` — Add banner at top
- `scanner/news_filter.py` — Enhance to return affected symbols list

**Banner content:**
```
USD event risk: FOMC statement in 64 minutes.
New USD entries blocked until 2:45 PM ET.
Affected: EURUSD, GBPUSD, XAUUSD, NAS100
Existing setups remain visible but cannot become Ready.
[Expand] [Dismiss]
```

### 1.6 Exact Wait Reasons
Replace generic WAIT states with structured reason codes:
- NEWS_BLOCK_HIGH_IMPACT
- NEWS_COOLING_PERIOD
- ADR_EXHAUSTED
- INSUFFICIENT_VOLUME_DATA
- INSUFFICIENT_CANDLE_HISTORY
- DIRECTION_CONFLICT
- RR_BELOW_MINIMUM
- ENTRY_TOO_EXTENDED
- STALE_CANDLES
- STRUCTURE_NOT_CONFIRMED
- SPREAD_TOO_WIDE
- LIQUIDITY_NOT_CONFIRMED
- VOLATILITY_TOO_HIGH
- VOLATILITY_TOO_LOW
- PORTFOLIO_RISK_EXCEEDED
- PROVIDER_RATE_LIMITED
- PROVIDER_UNAVAILABLE
- MODEL_COVERAGE_LOW

---

## Phase 2 — Decision Workflow

### 2.1 Formal Signal Lifecycle
**Current state:** Direction stability has FORMING/CONFIRMED/WEAKENING/INVALIDATED but V1 has no lifecycle. No lifecycle events stored.

**New lifecycle states:**
- OBSERVING
- DEVELOPING
- NEAR_TRIGGER
- READY
- ACTIVE
- TP1_REACHED
- TP2_REACHED
- TP3_REACHED
- BREAK_EVEN
- STOPPED
- EXPIRED
- INVALIDATED
- BLOCKED_BY_NEWS
- BLOCKED_BY_DATA
- BLOCKED_BY_SPREAD
- BLOCKED_BY_RISK
- CLOSED

**Files to change:**
- `scanner/signal.py` — Add LifecycleState enum
- `scanner/direction_stability.py` — Rename/remap to lifecycle
- `scanner/persistence.py` — Add lifecycle_events table
- `scanner/api.py` — Return lifecycle state in signals
- `src/types/signals.ts` — Add lifecycle types
- `src/pages/Dashboard.tsx` — Display lifecycle state

**Lifecycle events table schema:**
```sql
CREATE TABLE lifecycle_events (
  id TEXT PRIMARY KEY,
  setup_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason_code TEXT,
  human_readable TEXT,
  timestamp TEXT NOT NULL,
  snapshot_id TEXT,
  model_version TEXT
);
```

### 2.2 Structured Trigger Conditions
**Files to change:**
- `scanner/crypto_analysis.py` — Generate structured triggers
- `scanner/trade_planner.py` — Output structured triggers
- `src/types/signals.ts` — Add Trigger type
- `src/pages/Dashboard.tsx` — Display trigger in expanded row

**Trigger data model:**
```typescript
interface Trigger {
  type: 'candle_close_above' | 'candle_close_below' | 'price_enters_zone' |
        'score_crosses_above' | 'coverage_crosses_above' | 'news_blackout_ends' |
        'direction_conflict_resolves' | 'adr_resets' | 'spread_below_threshold';
  symbol: string;
  timeframe?: string;
  operator?: '>' | '<' | '>=' | '<=' | 'between';
  price?: number;
  priceHigh?: number;  // for between
  priceLow?: number;
  requiredCandleState?: string;
  expiration?: string;
  currentProgress?: number;
  completed: boolean;
  humanReadable: string;
}
```

### 2.3 Opportunity Queue Redesign
**Files to change:**
- `src/pages/Dashboard.tsx` — Complete Opportunity Queue redesign
- `src/components/OpportunityCard.tsx` — NEW component
- `src/components/SetupDetailPanel.tsx` — NEW component for expanded rows

**Queue columns:**
| Column | Source |
|--------|--------|
| Rank | Sort by score |
| Symbol | signal.pair |
| Asset Class | marketInfo.assetClass |
| Direction | signal.direction |
| Lifecycle | lifecycle_state |
| Score | confluence_score |
| Coverage | coverage percentage |
| Confidence | confidence_tier |
| Score Change | score_history |
| Trigger Distance | trigger proximity |
| Net R:R | trade_plan.net_rr |
| News State | news_gate.status |
| Data Freshness | data_freshness_seconds |
| Last Change | lifecycle_event.timestamp |
| Alert Status | user_alert_config |

### 2.4 Score Momentum and History
**Files to change:**
- `scanner/persistence.py` — Store score snapshots
- `scanner/api.py` — Return score history
- `src/services/bwtsApi.ts` — Add score history endpoint
- `src/pages/Dashboard.tsx` — Display sparklines and changes

**Score history API:**
```json
{
  "current_score": 68,
  "change_15m": 3,
  "change_1h": 9,
  "change_4h": -2,
  "change_24h": 5,
  "high_today": 71,
  "low_today": 61,
  "time_near_trigger_minutes": 18,
  "direction_stability": "stable",
  "sparkline_1h": [65, 66, 68, 67, 68]
}
```

**Note:** Store snapshots as they existed, do not recalculate historical values.

### 2.5 Dashboard Snapshot Endpoint
**Files to change:**
- `scanner/api.py` — Add `/api/dashboard-snapshot` endpoint
- `src/services/bwtsApi.ts` — Use unified endpoint

**Unified response:**
```json
{
  "snapshot_id": "abc123",
  "generated_at": "2026-07-29T13:00:00Z",
  "market_data_timestamp": "2026-07-29T12:59:45Z",
  "scanner_health": "healthy",
  "provider_health": {
    "twelve_data": "ok",
    "binance": "ok"
  },
  "economic_event_risk": { ... },
  "markets": [ ... ],
  "latest_analysis_per_market": { ... },
  "trade_plan_state": { ... },
  "score_history_summary": { ... },
  "performance_summary": { ... },
  "model_version": "v2.1.0"
}
```

### 2.6 N+1 Request Pattern Fix
**Current:** Dashboard makes 3 requests + N pair analysis requests
**Fix:** Single `/api/dashboard-snapshot` returns all data in one response

---

## Phase 3 — Risk and Trade Planning

### 3.1 Asset-Class-Aware Position Sizing
**Files to change:**
- `scanner/risk_manager.py` — Add asset-class-specific calculations
- `scanner/trade_planner.py` — Use asset-aware sizing
- `src/types/trading.ts` — Add asset class types

**Forex formula:**
```
lot_size = (account_balance * risk_pct) / (sl_pips * pip_value_per_lot)
```

**Gold formula:**
```
lot_size = (account_balance * risk_pct) / (sl_distance * contract_size * point_value)
```

**Crypto formula:**
```
lot_size = (account_balance * risk_pct) / (sl_distance * contract_size * tick_value)
```

### 3.2 Net R:R with Transaction Costs
**Current:** 24 bps hardcoded
**Fix:** Per-asset-class cost assumptions
```python
TRANSACTION_COST_BPS = {
    'forex': 12,      # 12 bps per side = 1.2 pips EURUSD typical
    'metals': 20,     # Gold spread typically wider
    'cryptocurrency': 25,  # Crypto exchange fees
    'indices': 15,
}
```

### 3.3 Portfolio Exposure Controls
**Files to change:**
- `scanner/risk_manager.py` — Add portfolio exposure checks
- `scanner/trade_planner.py` — Check before marking READY
- `src/pages/Dashboard.tsx` — Show exposure warnings

**Checks before READY:**
- Total open risk <= max_total_open_risk
- Directional currency exposure <= max_currency_exposure
- Correlated pair exposure <= max_correlated_exposure
- Number of active setups <= max_active_setups
- Asset class concentration <= max_class_concentration

**Example warning:**
> This EURUSD long would increase your short-USD exposure to 1.8%. Configured limit: 1.5%.

### 3.4 Trade Plan Presentation
**Files to change:**
- `scanner/trade_planner.py` — Enhance output format
- `src/components/TradePlanPanel.tsx` — NEW component
- `src/pages/Dashboard.tsx` — Show trade plan in expanded row

**Trade plan output:**
```json
{
  "direction": "BUY",
  "entry_type": "limit",
  "entry_zone": { "low": 2381.50, "high": 2383.00 },
  "trigger_price": 2382.50,
  "stop_price": 2374.20,
  "stop_rationale": "Below structure support and ATR buffer",
  "tp1": 2392.00,
  "tp2": 2398.50,
  "tp3": 2405.00,
  "target_allocation": { "tp1": 0.33, "tp2": 0.33, "tp3": 0.34 },
  "gross_rr": 3.2,
  "net_rr": 2.98,
  "spread_assumption_bps": 12,
  "commission_assumption_bps": 12,
  "slippage_assumption_bps": 5,
  "account_risk_pct": 0.5,
  "position_size": 0.78,
  "setup_expiration": "2026-07-30T00:00:00Z",
  "invalidation": "Price closes below 2370.00",
  "break_even_rule": "Move to B/E when TP1 hit",
  "trailing_stop_rule": null,
  "time_stop_rule": "Exit at 23:00 ET if not triggered",
  "news_management_rule": "No new entries 15 min before high-impact events",
  "max_chase_distance_pips": 10
}
```

### 3.5 Non-Eligible Setup Explanation
When no trade plan available, show:
- Why not eligible (specific reason codes)
- What condition is missing
- Whether developing, blocked, or invalidated
- Whether thesis remains valid
- When it will be reconsidered

---

## Phase 4 — Performance and Forward-Testing

### 4.1 Immutable Setup Ledger
**Files to change:**
- `scanner/persistence.py` — Add setup_snapshots table
- `scanner/crypto_analysis.py` — Generate snapshot on publish
- `scanner/api.py` — Prevent update of historical records

**Schema:**
```sql
CREATE TABLE setup_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  direction TEXT NOT NULL,
  publication_timestamp TEXT NOT NULL,
  candle_timestamp TEXT NOT NULL,
  data_provider_timestamps JSON NOT NULL,
  model_version TEXT NOT NULL,
  confluence_score INTEGER NOT NULL,
  coverage REAL NOT NULL,
  confidence TEXT NOT NULL,
  category_breakdown JSON NOT NULL,
  entry REAL NOT NULL,
  stop REAL NOT NULL,
  targets JSON NOT NULL,
  position_risk_assumptions JSON NOT NULL,
  spread_bps REAL,
  commission_bps REAL,
  slippage_bps REAL,
  news_state TEXT NOT NULL,
  market_regime TEXT,
  lifecycle_state TEXT NOT NULL,
  trigger_conditions JSON NOT NULL,
  invalidation TEXT NOT NULL,
  final_result TEXT,
  mfe REAL,
  mae REAL,
  exit_timestamp TEXT,
  exit_reason TEXT,
  was_actionable_when_published INTEGER NOT NULL,
  was_delayed_data INTEGER NOT NULL,
  data_hash TEXT,
  UNIQUE(snapshot_id)
);
```

### 4.2 Forward-Test Resolution Engine
**Files to change:**
- `scanner/v2_backtester.py` — Enhance resolution logic
- `scanner/forward_test_resolver.py` — NEW worker module

**Resolution logic:**
- Track entry trigger (bar close above threshold)
- Track stop vs target hit first
- Handle intrabar ambiguity conservatively
- Mark ambiguous results with documented assumption
- Calculate MFE and MAE

**Conservative ambiguity rule:**
> If stop and target both touched in same candle and ordering cannot be determined from lower resolution: mark as 0R loss.

### 4.3 Performance Center Page
**Files to change:**
- `src/pages/Performance.tsx` — NEW page (or enhance existing)
- `src/components/PerformanceFilters.tsx` — NEW
- `src/components/PerformanceCharts.tsx` — NEW

**Separate result sources:**
- BACKTESTED
- FORWARD_TESTED
- PAPER_TRADED
- USER_JOURNAL
- LIVE_BROKER

**Required statistics per source:**
- Sample size
- Win rate
- TP1/TP2/TP3 hit rates
- Stop-loss rate
- Break-even rate
- Expiration rate
- Average R, Median R
- Expectancy
- Profit factor
- Maximum drawdown
- Max consecutive losses
- MFE, MAE
- Average holding time
- Average time to TP1 / stop
- Signal frequency
- Direction-change frequency

**Filters:**
- Date range
- Asset class
- Symbol
- Direction
- Score band
- Confidence tier
- Coverage band
- Lifecycle state
- Market regime
- Timeframe
- Trading session
- News state
- Data-quality state
- Model version
- Setup type

### 4.4 Score Calibration Report
**Files to change:**
- `scanner/score_calibrator.py` — NEW module
- `scanner/api.py` — Add calibration endpoint
- `src/pages/Performance.tsx` — Add calibration display

**Calibration metrics:**
- Reliability curves by score band
- Calibration plots
- Brier scores
- Walk-forward validation results
- Regime-specific analysis

---

## Phase 5 — Alerts and Notifications

### 5.1 Alert System Architecture
**Files to change:**
- `scanner/alert_manager.py` — NEW module
- `scanner/persistence.py` — Add alerts table
- `scanner/api.py` — Alert CRUD endpoints
- `src/pages/Alerts.tsx` — NEW page (or section)
- `src/components/AlertConfig.tsx` — NEW component

**Alert conditions:**
- Setup becomes READY
- Setup becomes NEAR_TRIGGER
- Price enters entry zone
- Score crosses threshold
- Confidence tier changes
- Coverage improves
- Direction changes
- Setup invalidated
- Setup expires
- News blackout begins/ends
- Spread below threshold
- Net R:R exceeds threshold
- TP1/TP2/TP3 reached
- Stop reached

**Delivery channels (implement available, document missing):**
- In-app (database + polling)
- Browser notifications (service worker)
- Email (SMTP or provider)
- Telegram (bot webhook)
- SMS (Twilio or similar)
- Webhook (generic URL)

### 5.2 Alert Preferences
**Per-alert settings:**
- Quiet hours (start/end time)
- Timezone
- Frequency limits (max per hour/day)
- Duplicate suppression (don't re-alert same unchanged condition)
- Delivery logs
- Retry handling
- Unsubscribe controls

---

## Phase 6 — Provider Reliability

### 6.1 Provider Health Reporting
**Files to change:**
- `scanner/multi_source.py` — Add health tracking
- `scanner/data_provider.py` — Track Twelve Data health
- `scanner/binance_client.py` — Track Binance health
- `scanner/api.py` — Expose provider health
- `src/components/ProviderStatus.tsx` — NEW component
- `src/pages/Dashboard.tsx` — Show provider status

**Per-provider data:**
```json
{
  "provider": "twelve_data",
  "status": "degraded",
  "is_realtime": true,
  "last_successful_candle": "2026-07-29T12:59:00Z",
  "cache_age_seconds": 45,
  "available_timeframes": ["D1", "H4", "H1"],
  "missing_timeframes": ["M15"],
  "rate_limit_state": { "remaining": 3, "resets_at": "2026-07-29T13:01:00Z" },
  "last_error": "429 Too Many Requests",
  "fallback_provider": null
}
```

### 6.2 Request Queue Architecture
**Files to change:**
- `scanner/data_provider.py` — Central request queue
- `scanner/multi_source.py` — Request coalescing
- `scanner/cache_manager.py` — NEW shared caching

**Features:**
- Async requests
- Request coalescing (dedupe concurrent requests for same data)
- Stale-while-revalidate
- Circuit breakers per provider
- Provider budgets (per-timeframe request limits)
- Priority queues (interactive > background)
- Backoff and retry with jitter
- Metrics per provider

### 6.3 Circuit Breaker Implementation
```python
class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=60):
        self.failure_count = 0
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.state = 'closed'  # closed, open, half-open

    def record_failure(self):
        self.failure_count += 1
        if self.failure_count >= self.failure_threshold:
            self.state = 'open'

    def record_success(self):
        self.failure_count = 0
        self.state = 'closed'
```

---

## Phase 7 — Security and Observability

### 7.1 Authentication Implementation
**Files to change:**
- `scanner/api.py` — Add JWT authentication
- `scanner/auth.py` — NEW auth module
- `scanner/models.py` — Add User model
- `scanner/postgres_repo.py` — Add users table
- `server/index.js` — Add auth middleware
- `src/contexts/AuthContext.tsx` — Connect to real backend

**Implementation:**
- JWT tokens with HTTP-only cookies
- Password hashing with bcrypt
- Session revocation support
- MFA readiness (TOTP)
- Email verification flow
- Password reset security

### 7.2 Security Hardening
- CSRF protection
- Rate limiting middleware
- Input validation
- Output encoding
- SQL injection prevention (use parameterized queries)
- XSS prevention
- SameSite cookie configuration
- Content Security Policy headers
- Strict CORS configuration
- Audit logging

### 7.3 Observability
**Files to change:**
- `scanner/logging_config.py` — NEW structured logging
- `scanner/metrics.py` — NEW metrics collection
- `scanner/api.py` — Add observability middleware

**Metrics to collect:**
- Request IDs (propagate through system)
- User-safe error IDs (display to user, full trace in logs)
- Snapshot IDs, Setup IDs for correlation
- Provider latency per request
- Provider failure rate
- Scan duration
- Analysis duration
- Alert delivery success rate
- Database query performance
- Cache hit rate
- API rate limit metrics
- Worker health
- Queue depth
- WebSocket/SSE connection health

**Endpoints:**
- GET /health — Basic liveness
- GET /ready — Readiness (DB, cache, providers OK)
- GET /metrics — Prometheus-format metrics
- GET /admin/diagnostics — Admin-only system health

### 7.4 Error Handling
- Never expose stack traces to users
- Map to user-safe error IDs
- Structured error responses
- Error reporting integration hooks

---

## Phase 8 — Testing and Documentation

### 8.1 Comprehensive Test Suite

**Unit tests to add:**
- scoring_engine missing data behavior
- coverage calculation
- confidence tier determination
- lifecycle transitions
- trigger evaluation
- news blocking
- adr logic
- entry/stop/target calculation
- net rr calculation
- position sizing per asset class
- currency conversion
- portfolio exposure
- performance resolution

**Integration tests to add:**
- Provider response parsing
- Provider failure handling
- Rate limit handling
- Cache behavior with stale data fallback
- Dashboard snapshot endpoint
- Alert creation and delivery
- Journal creation
- Performance resolution
- Database migrations

**E2E tests:**
- Scanner creates analysis
- Analysis enters DEVELOPING
- Trigger completes
- Setup becomes READY
- User creates alert
- Entry reached
- Setup becomes ACTIVE
- TP1 or stop resolves
- Performance ledger updates
- Journal receives outcome

**Quantitative safety tests:**
- No look-ahead bias verification
- Candle boundary behavior
- Intrabar ambiguity handling
- Same-candle stop and target
- Timezone and DST handling
- Weekend/market closed periods
- Stale candle handling
- Duplicate signal prevention
- Missing timeframe graceful degradation
- Partial provider outage handling

### 8.2 Documentation
**Files to create:**
- `.env.example` — Template with all required variables, no real values
- `docs/ARCHITECTURE.md` — System architecture overview
- `docs/SCORING_METHODOLOGY.md` — How scoring works
- `docs/LIFECYCLE_STATES.md` — State definitions
- `docs/PERFORMANCE_METHODOLOGY.md` — How performance is measured
- `docs/FORWARD_TESTING.md` — Forward-testing explanation
- `docs/ALERT_SETUP.md` — How to configure alerts
- `docs/SECURITY.md` — Security practices

**Update existing:**
- `README.md` — Remove hardcoded credentials, update setup instructions
- `docs/DEPLOY.md` — Update with complete checklist

---

## Critical Files to Modify First

1. `src/pages/Dashboard.tsx` — Terminology, Opportunity Queue
2. `scanner/crypto_analysis.py` — Coverage, confidence, structured triggers
3. `scanner/api.py` — Dashboard snapshot endpoint, lifecycle states
4. `scanner/persistence.py` — Lifecycle events table, setup snapshots
5. `src/services/bwtsApi.ts` — Use dashboard snapshot, terminology
6. `scanner/risk_manager.py` — Asset-class-aware position sizing
7. `scanner/trade_planner.py` — Structured triggers output
8. `src/types/signals.ts` — New types for coverage, confidence, lifecycle, triggers

---

## Validation Checklist

- [ ] Forex/gold not described as crypto
- [ ] V2 terminology removed from primary UI
- [ ] Every score includes coverage and confidence
- [ ] Missing data distinguished from negative evidence
- [ ] Every WAIT state has exact reason
- [ ] Developing setups show measurable triggers
- [ ] Users can create alerts
- [ ] Dashboard shows score momentum
- [ ] Economic-event risk visible globally
- [ ] Eligible setups display full trade plans
- [ ] Position sizing is asset-class aware
- [ ] Net R:R includes transaction costs
- [ ] Portfolio exposure evaluated
- [ ] Lifecycle transitions stored
- [ ] Historical setup records immutable
- [ ] Forward-test and backtest results separated
- [ ] Performance metrics include sample size + date range
- [ ] No fake track record shown
- [ ] Dashboard uses atomic snapshot
- [ ] Data timestamps accurate
- [ ] Provider health visible
- [ ] No N+1 requests
- [ ] Security enforced server-side
- [ ] Production errors observable
- [ ] Tests cover core logic
- [ ] Mobile/desktop usable
- [ ] Documentation complete
- [ ] Existing features functional
- [ ] Deployment succeeds
- [ ] No secrets exposed

---

## Outstanding Dependencies

These require external setup before full functionality:

1. **Email provider** — SMTP or SendGrid/Mailgun for alerts
2. **Telegram bot** — BotFather setup + webhook endpoint
3. **SMS provider** — Twilio account + API keys
4. **Billing provider** — Stripe or similar for subscriptions
5. **Premium market data** — Twelve Data paid plan for more requests
6. **Error monitoring** — Sentry or similar
7. **Real-time updates** — WebSocket/SSE infrastructure

---

## Environment Variables to Add

```env
# New required
JWT_SECRET=                    # For authentication
ALERT_EMAIL_PROVIDER=         # smtp|sendgrid|mailgun
SMTP_HOST=                    # If using SMTP
SMTP_PORT=                    # If using SMTP
SMTP_USER=                    # If using SMTP
SMTP_PASS=                    # If using SMTP
TELEGRAM_BOT_TOKEN=           # For Telegram alerts
TWILIO_ACCOUNT_SID=           # For SMS
TWILIO_AUTH_TOKEN=            # For SMS
TWILIO_PHONE_NUMBER=          # For SMS
STRIPE_SECRET_KEY=            # For billing
SENTRY_DSN=                   # For error monitoring

# Already exists, verify
TWELVE_DATA_API_KEY=          # Twelve Data
DATABASE_URL=                 # PostgreSQL
```

---

## Rollback Instructions

1. **Code rollback:** `git revert <commit>`
2. **Database rollback:** Restore from backup or use down migrations
3. **Config rollback:** Revert environment variables in Render dashboard
4. **Feature flags:** Consider adding feature flags for gradual rollout

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing scanner | Test on branch first, keep V1/V2 parallel during transition |
| Database schema changes | Add migrations, never drop columns without migration |
| Authentication breaking existing users | Phased rollout, test with demo account first |
| Provider rate limits during migration | Add circuit breakers, cache aggressively |
| Frontend breaking on API changes | Version frontend API calls, maintain backward compatibility |
