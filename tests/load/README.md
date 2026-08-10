# Load tests

k6 load tests for the Confluence X API.

## Prerequisites

Install k6: <https://k6.io/docs/getting-started/installation/>

## analysis_load.js

Hits `/api/analysis?pair=BTCUSD&timeframe=1h` 100 times with 10 concurrent
virtual users and reports p50/p95/p99 latencies plus pass/fail thresholds.

```bash
# Local API
k6 run tests/load/analysis_load.js

# Staging or production API
k6 run --env BASE_URL=https://traderslounge-bwts-api.onrender.com tests/load/analysis_load.js

# Override VUs / iterations
k6 run --env BASE_URL=https://traderslounge-bwts-api.onrender.com \
       --vus 20 --iterations 200 \
       tests/load/analysis_load.js
```

The script aborts if p95 exceeds 5s or any requests fail (rate ≥ 1%).
