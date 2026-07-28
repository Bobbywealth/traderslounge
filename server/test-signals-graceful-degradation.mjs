// Regression test for the signals graceful-degradation fix.
//
// Before the fix: /api/signals returned HTTP 500 with body
// { success: false, error: "" } when DATABASE_URL was not set, because the
// pg Pool fell back to localhost:5432 and every query threw
// ECONNREFUSED with an empty message.
//
// After the fix: /api/signals returns HTTP 503 with a descriptive error
// explaining the missing DATABASE_URL, and the other signals routes do
// the same.
//
// Run: node test-signals-graceful-degradation.mjs

import express from 'express';
import http from 'node:http';
import assert from 'node:assert/strict';

// Set the other env vars the module imports (services/strategy ->
// services/marketData) require, but leave DATABASE_URL unset to exercise
// the missing-DB path.
process.env.TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || 'test';
process.env.PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || 'test';

// Force the missing-DB path. The production code reads DATABASE_URL at
// module load, so we must import after deleting the env var.
delete process.env.DATABASE_URL;

const { signalsRouter } = await import('./routes/signals.js');

// Sanity: ensure the module actually exports what we expect.
assert.equal(typeof signalsRouter, 'function', 'signalsRouter should be an express router');

const app = express();
app.use(express.json());
app.use('/', signalsRouter);

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});

function request(method, path) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({
      method,
      host: '127.0.0.1',
      port,
      path,
    });
    req.on('error', reject);
    req.on('response', (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          parsed = body;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.end();
  });
}

const cases = [
  { method: 'GET', path: '/?limit=5', name: 'GET / (list signals)' },
  { method: 'GET', path: '/EURUSD', name: 'GET /:symbol (single signal)' },
  { method: 'POST', path: '/refresh', name: 'POST /refresh' },
];

let failed = 0;
for (const c of cases) {
  try {
    const res = await request(c.method, c.path);
    const ok =
      res.status === 503 &&
      res.body.success === false &&
      typeof res.body.error === 'string' &&
      res.body.error.length > 0 &&
      res.body.code === 'DB_NOT_CONFIGURED';
    if (ok) {
      console.log(`PASS  ${c.name} -> 503 ${JSON.stringify(res.body)}`);
    } else {
      failed += 1;
      console.log(
        `FAIL  ${c.name} -> ${res.status} ${JSON.stringify(res.body)} (expected 503 with DB_NOT_CONFIGURED code and non-empty error)`
      );
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${c.name} -> threw ${err.message}`);
  }
}

server.close();

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll tests passed');
process.exit(0);