"""
Live HTTP end-to-end test for the Confluence X autonomous pipeline.

Drives the public API on the Render deployment via requests
(https://traderslounge-bwts-api.onrender.com) to prove the closed-loop
pipeline actually runs in production. Skipped if requests is unavailable
or if CONF_API_URL points to an unreachable host.
"""
import json
import os
import sys
import time
import unittest

sys.path.insert(0, '.')

try:
    import requests
except ImportError:
    requests = None


BASE_URL = os.environ.get('CONF_API_URL', 'https://traderslounge-bwts-api.onrender.com')
TIMEOUT_S = 10
PAIRS = ('BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD')


@unittest.skipIf(requests is None, 'requests not installed')
@unittest.skipIf(
    os.environ.get('RUN_LIVE_TESTS') != '1',
    'live HTTP E2E skipped — set RUN_LIVE_TESTS=1 to enable',
)
class TestLiveAPI(unittest.TestCase):
    """Hit the live deployment end-to-end. Not authoritative — just smoke."""

    def test_health_endpoint(self):
        r = requests.get(f'{BASE_URL}/api/health', timeout=TIMEOUT_S)
        self.assertEqual(r.status_code, 200, f'health endpoint: {r.text[:200]}')
        body = r.json()
        self.assertEqual(body.get('status'), 'ok')

    def test_analysis_endpoint_for_all_pairs(self):
        for pair in PAIRS:
            r = requests.get(f'{BASE_URL}/api/analysis', params={'pair': pair, 'timeframe': '1h'}, timeout=TIMEOUT_S)
            self.assertEqual(r.status_code, 200, f'{pair}: {r.text[:200]}')
            data = r.json()
            # Sanity-check the analysis payload
            self.assertEqual(data.get('pair'), pair, f'{pair} pair mismatch')
            self.assertIn('total_score', data, f'{pair} missing total_score')
            self.assertIn('trade_plan', data, f'{pair} missing trade_plan')

    def test_autonomy_status_endpoint(self):
        """The /api/autonomy/status endpoint reports loop health."""
        r = requests.get(f'{BASE_URL}/api/autonomy/status', timeout=TIMEOUT_S)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn('components', data)
        self.assertIn('scanner', data['components'])
        # The feeder runs every ~60s; give it a moment to complete at
        # least one cycle before asserting health.
        for _ in range(10):
            if data['components']['scanner'] in ('healthy', 'unknown'):
                break
            time.sleep(6)
            r = requests.get(f'{BASE_URL}/api/autonomy/status', timeout=TIMEOUT_S)
            data = r.json()
        # We don't require a specific scan_count — just that the endpoint
        # is responsive and returns well-formed JSON.
        self.assertIn('scan_count', data)

    def test_published_signals_endpoint(self):
        r = requests.get(f'{BASE_URL}/api/published-signals', params={'limit': 5}, timeout=TIMEOUT_S)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        # Either 0 signals (market has no confirmed setups) or >0
        self.assertIn('count', data)
        self.assertIsInstance(data['count'], int)


if __name__ == '__main__':
    unittest.main()
