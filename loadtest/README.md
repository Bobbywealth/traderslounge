# Load Testing for ConfluenceX

This directory contains load testing scripts for the ConfluenceX platform.

## Prerequisites

1. Install k6:
   ```bash
   # macOS
   brew install k6
   
   # Linux
   sudo snap install k6
   
   # Windows
   choco install k6
   ```

2. Ensure the target environment is running

## Test Scenarios

### API Load Test (`api-load-test.js`)

Tests the following endpoints with up to 1000 concurrent users:

- **Health Check** - `GET /health`
- **Dashboard Snapshot** - `GET /api/dashboard-snapshot`
- **Signals** - `GET /api/signals`
- **Candle Data** - `GET /api/candles`
- **Chart Analysis** - `POST /api/ai/chart-analyze`
- **Token Refresh** - `POST /api/auth/refresh`
- **Kill Switch** - `GET /api/kill-switch`

### Load Profile

```
Ramp up to 50 users (30s)
↓
Stay at 100 users (1m)
↓
Ramp up to 200 users (30s)
↓
Stay at 200 users (2m)
↓
Ramp up to 500 users (30s)
↓
Stay at 500 users (2m)
↓
Ramp up to 1000 users (30s)
↓
Stay at 1000 users (3m)
↓
Ramp down (1m)
```

**Total duration:** ~13 minutes

## Running Tests

### Basic Usage

```bash
# Run against default environment
k6 run loadtest/api-load-test.js

# Run against custom environment
k6 run loadtest/api-load-test.js --env BASE_URL=https://your-environment.onrender.com

# Run with custom test credentials
k6 run loadtest/api-load-test.js \
  --env BASE_URL=https://your-env.onrender.com \
  --env TEST_EMAIL=test@example.com \
  --env TEST_PASSWORD=password123
```

### Output Formats

```bash
# JSON output
k6 run --out json=results.json loadtest/api-load-test.js

# CSV output
k6 run --out csv=results.csv loadtest/api-load-test.js

# InfluxDB output (for Grafana dashboards)
k6 run --out influxdb=http://localhost:8086/k6 loadtest/api-load-test.js
```

## Thresholds

The test will fail if:

- 95% of requests take longer than 5 seconds
- Error rate exceeds 10%

## Metrics Collected

- `http_req_duration` - Request duration
- `errors` - Error rate
- `request_duration` - Custom request duration metric
- `request_count` - Total request count

## Viewing Results

### Console Output

k6 provides real-time metrics in the console during test execution.

### Grafana Dashboard

For visual monitoring, set up InfluxDB and Grafana:

1. Start InfluxDB:
   ```bash
   docker run -d -p 8086:8086 influxdb:latest
   ```

2. Configure k6 output:
   ```bash
   k6 run --out influxdb=http://localhost:8086/k6 loadtest/api-load-test.js
   ```

3. Import k6 Grafana dashboard (ID: 2587)

## Performance Budgets

| Metric | Target | Description |
|--------|--------|-------------|
| p50 latency | < 1s | 50% of requests under 1 second |
| p95 latency | < 3s | 95% of requests under 3 seconds |
| p99 latency | < 5s | 99% of requests under 5 seconds |
| Error rate | < 1% | Less than 1% of requests fail |
| Throughput | > 100 RPS | At least 100 requests per second |

## Troubleshooting

### High Error Rates

1. Check if the target environment is healthy
2. Verify authentication credentials
3. Check rate limiting configuration
4. Review server logs for errors

### High Latency

1. Check database connection pooling
2. Verify cache hit rates
3. Review API response times
4. Check network latency to target

### Connection Errors

1. Verify network connectivity
2. Check firewall rules
3. Increase connection timeout in k6 options

## CI/CD Integration

Add load testing to your CI/CD pipeline:

```yaml
# .github/workflows/load-test.yml
name: Load Test
on:
  schedule:
    - cron: '0 2 * * *'  # Run daily at 2 AM
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run k6 load test
        uses: grafana/k6-action@v0.3.1
        with:
          filename: loadtest/api-load-test.js
        env:
          K6_OUT: influxdb=http://influxdb:8086/k6
```

## Best Practices

1. **Run against staging first** - Always test against a staging environment before production
2. **Monitor during tests** - Watch server metrics during load tests
3. **Test during low-traffic periods** - Avoid impacting real users
4. **Clean up test data** - Remove test users created during load tests
5. **Review results thoroughly** - Don't just pass/fail; analyze patterns
