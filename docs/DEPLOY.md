# Bobby Wealth Trading System — Deployment Checklist

Follow this sequence the first time you deploy the Python stack on Render.

## 0. Rotate exposed secrets (CRITICAL — do this first)

The previous `render.yaml` committed two production secrets to repo history. They are visible publicly on GitHub and **must be rotated before merging this branch**:

- Postgres DSN password (the `traders_lounge_db` database) — rotate via Render → Database → Rotate Password
- Perplexity API key (`pplx-…`) — generate a new key in the Perplexity dashboard and revoke the old one

You should also rotate the Twelve Data key that was previously hardcoded in `server/services/marketData.js`.

## 1. Render environment network allow-list

Set in **Render → Environment → Network policy → Allowed hosts**:

| Host | Purpose | Required for |
|---|---|---|
| `api.twelvedata.com` | FX/gold OHLCV | scanner, execution |
| `api.binance.com` | Crypto OHLCV | scanner, execution |
| `nfs.faireconomy.media` | ForexFactory news feed | scanner |
| `api.tradelocker.com` | Live broker | execution (live mode only) |
| `pypi.org`, `files.pythonhosted.org` | `pip install` | all Python services |

## 2. Create the services from `render.yaml`

Connect the repo and let Render provision everything in one shot. The blueprint creates:

- `bwts-postgres` (managed Postgres)
- `traderslounge` (React dashboard)
- `traderslounge-api` (legacy Node API — keep running during cutover)
- `traderslounge-bwts-api` (Python read API)
- `bwts-scanner` (scanner background worker)
- `bwts-execution` (execution background worker, paper-mode default)

## 3. Set sync-false env vars in the dashboard

After provisioning, set these in the Render UI (they're intentionally not in git):

**Scanner + execution workers:**

- `TWELVE_DATA_API_KEY` — your Twelve Data key (use the rotated one)

**Execution worker (only when ready to flip to live):**

- `TRADELOCKER_API_KEY`
- `TRADELOCKER_API_SECRET`
- `TRADELOCKER_ACCOUNT_ID` (optional, only if multi-account)

**Dashboard (legacy, until Python read API replaces):**

- `VITE_DATABASE_URL`, `VITE_PERPLEXITY_API_KEY`, `VITE_FINNHUB_API_KEY`

**Legacy Node API:**

- `PERPLEXITY_API_KEY`, `FINNHUB_API_KEY`, `TWELVE_DATA_API_KEY`

## 4. Smoke tests

Run these in order. Stop and investigate if any step fails.

### 4a. Postgres schema

The first `bwts-scanner` cycle creates the `signals` table automatically. Confirm via Render's Postgres shell:

```sql
\dt
SELECT COUNT(*) FROM signals;
```

### 4b. Read API health

```
curl https://traderslounge-bwts-api.onrender.com/api/health
```

Expect `{"status":"ok","db_signals":N,"pairs":[...]}`.

### 4c. Scanner is producing signals

Tail the `bwts-scanner` logs. Within one scan interval (default 5 min) you should see lines like:

```
scanned XAUUSD → GOOD 52/80
scanned BTCUSD → NO_TRADE 22/80
```

After a full cycle:

```
curl 'https://traderslounge-bwts-api.onrender.com/api/signals?limit=10'
```

### 4d. Execution worker paper-trades

Tail `bwts-execution` logs. When a STRONG signal arrives:

```
signal XAUUSD/STRONG → ACCEPTED (Order placed)
paper open XAUUSD BUY 0.02 lots @ 1900 SL=1880 TP1=1925
```

If a position later hits TP1 in the price oracle:

```
manage: paper-1: TP1 hit @ 1925, closed 50%, SL→BE
```

### 4e. Kill switch

From the `bwts-execution` Render shell:

```
touch /var/run/bwts.kill
```

Next STRONG signal should be rejected with `Kill switch engaged`. Remove the file to resume.

## 5. Flipping to live trading

**Do not do this until 4a–4e have all passed and you've watched paper trades close cleanly for at least one full session.**

1. Verify the TradeLocker REST response shapes in `scanner/tradelocker_broker.py` match what your broker returns (`orderId`, `stopLoss`, `quantity`, etc.). Adjust field names if the broker uses different ones.
2. Set `EXECUTION_MODE=live` on `bwts-execution`.
3. Set `TRADELOCKER_API_KEY` / `_SECRET` (and `_ACCOUNT_ID` if needed).
4. Restart the service.
5. Watch the first live trade carefully. Have the kill switch ready.

## 6. Removing the legacy Node API

Once the Python read API has been serving the dashboard for a few days with no regressions:

1. Point `VITE_API_URL` permanently at `https://traderslounge-bwts-api.onrender.com` (already the default in `render.yaml`).
2. Delete the `traderslounge-api` service block from `render.yaml`.
3. Delete the `server/` directory in a follow-up PR.

## Rollback

The kill switch (`touch $KILL_SWITCH_PATH`) halts execution instantly but doesn't close existing positions. To halt and flatten:

1. Engage the kill switch.
2. Manually close open positions via the broker UI.
3. Investigate the issue before disengaging.

If a deploy itself is bad, use Render's per-service rollback to the previous deploy.
