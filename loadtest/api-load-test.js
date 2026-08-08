/**
 * API Load Test for ConfluenceX
 * 
 * Tests:
 * - Authentication endpoints
 * - Dashboard snapshot
 * - Signal endpoints
 * - Chart data endpoints
 * 
 * Usage:
 * k6 run loadtest/api-load-test.js
 * 
 * Requirements:
 * - k6 installed (https://k6.io/)
 * - Target environment running
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const requestDuration = new Trend('request_duration');
const requestCount = new Counter('request_count');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://traderslounge.onrender.com';
const TEST_EMAIL = __ENV.TEST_EMAIL || 'loadtest@confluencex.com';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'loadtest123';

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 50 },   // Ramp up to 50 users
    { duration: '1m', target: 100 },   // Stay at 100 users
    { duration: '30s', target: 200 },  // Ramp up to 200 users
    { duration: '2m', target: 200 },   // Stay at 200 users
    { duration: '30s', target: 500 },  // Ramp up to 500 users
    { duration: '2m', target: 500 },   // Stay at 500 users
    { duration: '30s', target: 1000 }, // Ramp up to 1000 users
    { duration: '3m', target: 1000 },  // Stay at 1000 users
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'], // 95% of requests under 5s
    errors: ['rate<0.1'],              // Error rate under 10%
  },
};

// Setup function - runs once before test
export function setup() {
  console.log(`Starting load test against: ${BASE_URL}`);
  
  // Register test user
  const registerRes = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    name: 'Load Test User',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  // Login and get token
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  const loginData = JSON.parse(loginRes.body);
  return {
    token: loginData.access_token,
    refreshToken: loginData.refresh_token,
  };
}

// Main test function - runs for each virtual user
export default function(data) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token}`,
  };
  
  // Test 1: Health check (no auth required)
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
    'health check response time < 1s': (r) => r.timings.duration < 1000,
  });
  errorRate.add(healthRes.status !== 200);
  requestDuration.add(healthRes.timings.duration);
  requestCount.add(1);
  
  sleep(0.1);
  
  // Test 2: Dashboard snapshot
  const dashboardRes = http.get(`${BASE_URL}/api/dashboard-snapshot`, { headers });
  check(dashboardRes, {
    'dashboard status is 200': (r) => r.status === 200,
    'dashboard response time < 3s': (r) => r.timings.duration < 3000,
  });
  errorRate.add(dashboardRes.status !== 200);
  requestDuration.add(dashboardRes.timings.duration);
  requestCount.add(1);
  
  sleep(0.2);
  
  // Test 3: Get signals
  const signalsRes = http.get(`${BASE_URL}/api/signals?limit=10`, { headers });
  check(signalsRes, {
    'signals status is 200': (r) => r.status === 200,
    'signals response time < 2s': (r) => r.timings.duration < 2000,
  });
  errorRate.add(signalsRes.status !== 200);
  requestDuration.add(signalsRes.timings.duration);
  requestCount.add(1);
  
  sleep(0.1);
  
  // Test 4: Get candle data
  const candlesRes = http.get(`${BASE_URL}/api/candles?symbol=BTCUSD&timeframe=1h&limit=100`, { headers });
  check(candlesRes, {
    'candles status is 200': (r) => r.status === 200,
    'candles response time < 2s': (r) => r.timings.duration < 2000,
  });
  errorRate.add(candlesRes.status !== 200);
  requestDuration.add(candlesRes.timings.duration);
  requestCount.add(1);
  
  sleep(0.3);
  
  // Test 5: Chart analysis (POST)
  const analysisRes = http.post(`${BASE_URL}/api/ai/chart-analyze`, JSON.stringify({
    symbol: 'BTCUSD',
    timeframe: '1h',
    currentPrice: 50000,
  }), { headers });
  check(analysisRes, {
    'analysis status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'analysis response time < 10s': (r) => r.timings.duration < 10000,
  });
  errorRate.add(analysisRes.status !== 200 && analysisRes.status !== 429);
  requestDuration.add(analysisRes.timings.duration);
  requestCount.add(1);
  
  sleep(0.5);
  
  // Test 6: Token refresh
  const refreshRes = http.post(`${BASE_URL}/api/auth/refresh`, JSON.stringify({
    refresh_token: data.refreshToken,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(refreshRes, {
    'refresh status is 200': (r) => r.status === 200,
    'refresh response time < 1s': (r) => r.timings.duration < 1000,
  });
  errorRate.add(refreshRes.status !== 200);
  requestDuration.add(refreshRes.timings.duration);
  requestCount.add(1);
  
  sleep(0.2);
  
  // Test 7: Kill switch status
  const killSwitchRes = http.get(`${BASE_URL}/api/kill-switch`, { headers });
  check(killSwitchRes, {
    'kill switch status is 200': (r) => r.status === 200,
    'kill switch response time < 1s': (r) => r.timings.duration < 1000,
  });
  errorRate.add(killSwitchRes.status !== 200);
  requestDuration.add(killSwitchRes.timings.duration);
  requestCount.add(1);
  
  sleep(1);
}

// Teardown function - runs once after test
export function teardown(data) {
  console.log('Load test completed');
  console.log(`Final token: ${data.token ? 'available' : 'not available'}`);
}
