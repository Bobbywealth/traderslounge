# Traders Lounge

Traders Lounge is a decision-first trading analysis and validation platform. It combines multi-timeframe technical analysis, guarded trade plans, risk context, forecast tracking, and outcome calibration in a React/TypeScript dashboard backed by a Python analysis API.

> Traders Lounge is decision-support software, not financial advice. Pattern classifications and scenario weights are estimates. Scenario weights are not calibrated probabilities and must not be used for position sizing until sufficient forward outcomes have been collected and validated.

## Current capabilities

- Multi-timeframe market structure, BOS/CHOCH, support and resistance
- Momentum, moving averages, volatility, volume and Fibonacci analysis
- Elliott Wave, harmonic and AB=CD candidates with explicit limitations
- Decision-quality reporting with bias confidence, setup quality and execution readiness
- Entry, stop, target, invalidation and reward-to-risk planning
- Economic-calendar and data-quality gates
- Forecast persistence, grouped calibration and walk-forward validation reports
- Authentication, protected operational routes, request limits and rate limiting
- Read-only demo access for product evaluation

## Architecture

### Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Lightweight Charts and Recharts
- React Router
- Vitest and Testing Library

### Analysis API

The Python scanner/API provides market analysis, trade planning, protected operational controls, signal publication, forecast persistence and validation reporting.

Important API routes include:

- `GET /api/analysis`
- `GET /api/dashboard-snapshot`
- `GET /api/validation/report`
- `POST /api/ai/analyze`
- `POST /api/ai/chart-analyze`
- `POST /api/scans/refresh`
- `POST /api/kill-switch`

Sensitive or expensive routes require a valid bearer token and are rate-limited.

## Local development

### Requirements

- Node.js 18 or newer
- npm
- Python environment required by the scanner/API

### Frontend

```bash
npm ci
npm run dev
```

The Vite development server normally runs at `http://localhost:5173`.

### Frontend verification

```bash
npm run check
```

This runs ESLint, the Vitest suite and a production build.

### Backend verification

Run the Python test suite from the repository root using the command supported by the configured environment, typically:

```bash
python -m unittest discover -s tests
```

## Authentication

Authentication is handled by the backend. The frontend no longer accepts arbitrary credentials or creates browser-only users.

A read-only demo account may be enabled for evaluation:

```text
demo@trader.com
demo123
```

The demo role must remain blocked from operational mutations such as the kill switch and manual scan controls. Do not add administrator credentials to source code or documentation.

## Configuration

Production deployments should provide secrets and environment-specific configuration through the hosting environment rather than committing them to the repository.

Relevant configuration includes:

- `JWT_SECRET`
- `ALLOWED_ORIGINS`
- Database connection settings
- Market-data provider credentials
- News and economic-calendar provider credentials
- AI-provider credentials

The API defaults its browser origin allowlist to the production Traders Lounge frontend. Override `ALLOWED_ORIGINS` with a comma-separated list for additional approved environments.

## Validation policy

Forecasts must be recorded before their outcomes are known. Outcome resolution should consistently handle:

- Entry touched versus expired
- Stop or target reached first
- Same-candle stop/target ambiguity
- Fees, spread and slippage
- Signal version and engine version
- Market session and volatility regime

Calibration status should remain `INSUFFICIENT_DATA` until a defensible resolved sample exists. Segment results should display their sample sizes and must not be treated as reliable when observations are sparse.

## Deployment checklist

Before promoting a release:

1. Run frontend lint, tests and production build.
2. Run backend unit, API, auth, security and validation tests.
3. Confirm required GitHub checks pass.
4. Verify production secrets and allowed origins.
5. Verify demo sessions are read-only.
6. Confirm the validation report does not present scenario weights as calibrated probabilities without adequate data.
7. Smoke-test login, token refresh, dashboard loading, analysis, validation and logout.

## Repository safety

- Never commit API keys, broker credentials, JWT secrets or database passwords.
- Never publish real administrator passwords in documentation.
- Treat broker execution and operational controls as privileged actions.
- Keep forecast records immutable enough to reproduce historical validation by engine version.

## License

See the repository license file for applicable terms.
# Force-rebuild Wed Aug 12 22:30:39 EDT 2026
