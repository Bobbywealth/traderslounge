// k6 load test for Confluence X analysis endpoint.
//
// Run with:
//   k6 run --env BASE_URL=https://traderslounge-bwts-api.onrender.com tests/load/analysis_load.js
//
// Hits /api/analysis?pair=BTCUSD&timeframe=1h 100 times in parallel
// and reports p50/p95/p99 latencies, plus a threshold check at 5s.

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const ENDPOINT = `${BASE_URL}/api/analysis?pair=BTCUSD&timeframe=1h`;

export const options = {
  scenarios: {
    analysis_load: {
      executor: 'shared-iterations',
      vus: 10,           // 10 virtual users
      iterations: 100,   // 100 total requests
      maxDuration: '2m',
    },
  },
  thresholds: {
    'http_req_duration': ['p(50)<2000', 'p(95)<5000', 'p(99)<8000'],
    'http_req_failed':   ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(ENDPOINT, {
    headers: { 'Accept': 'application/json' },
    timeout: '30s',
  });
  check(res, {
    'status is 200':   (r) => r.status === 200,
    'has total_score':  (r) => {
      try { return JSON.parse(r.body).total_score !== undefined; }
      catch (e) { return false; }
    },
  });
}
