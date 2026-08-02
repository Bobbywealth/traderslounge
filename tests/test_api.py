"""Integration tests for the HTTP API.

Starts the ThreadingHTTPServer on an ephemeral port, hits it with
urllib, and asserts the JSON contract.
"""
import json
import os
import tempfile
import threading
import unittest
import urllib.request
from urllib.error import HTTPError

# Set a deterministic JWT secret BEFORE importing scanner.auth so the
# server uses the same secret as the test token we mint below.
os.environ.setdefault("JWT_SECRET", "test-secret-do-not-use-in-prod")

from scanner.api import ApiState, make_server  # noqa: E402
from scanner.auth import User, create_access_token  # noqa: E402
from scanner.config import Config  # noqa: E402
from scanner.data_types import Direction, Tier  # noqa: E402
from scanner.persistence import SQLiteRepository  # noqa: E402
from scanner.signal import Signal  # noqa: E402


def _signal(pair="XAUUSD", score=72, tier=Tier.STRONG, direction=Direction.BUY):
    return Signal(
        pair=pair, direction=direction, entry=1900.0, stop_loss=1880.0,
        tp1=1925.0, tp2=1940.0, tp3=1965.0,
        confidence_score=score, tier=tier,
        reasons=["HTF aligned"],
        risk_level="Low", session="London", adr_status="45% used",
        htf_bias="BUY", pattern="Fib retest",
    )


class TestApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fd, cls.db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        cls.repo = SQLiteRepository(cls.db_path)
        # Seed a few signals
        cls.ids = []
        cls.ids.append(cls.repo.save(_signal(pair="XAUUSD", score=72, tier=Tier.STRONG)))
        cls.ids.append(cls.repo.save(_signal(pair="EURUSD", score=55, tier=Tier.GOOD,
                                             direction=Direction.SELL)))
        cls.ids.append(cls.repo.save(_signal(pair="XAUUSD", score=40, tier=Tier.WATCHLIST)))
        cfg = Config(pairs=["XAUUSD", "EURUSD", "GBPUSD"])
        state = ApiState(repository=cls.repo, config=cfg)
        cls.server = make_server(state, host="127.0.0.1", port=0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

        # Build a JWT for a demo user so the protected endpoints
        # (/api/signals, /api/positions, /api/journal, /api/alerts,
        # /api/kill-switch, /api/scans/refresh) accept our requests.
        # Public endpoints (/api/health, /api/pairs, /api/config) ignore it.
        cls.user = User(
            id=1, email="demo@trader.com", name="Demo",
            role="user", plan="pro", created_at="",
        )
        cls.auth_header = {"Authorization": f"Bearer {create_access_token(cls.user)}"}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.repo.close()
        os.unlink(cls.db_path)

    def _get(self, path: str) -> tuple[int, dict]:
        url = f"http://127.0.0.1:{self.port}{path}"
        req = urllib.request.Request(url, headers=self.auth_header)
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read())
        except HTTPError as e:
            return e.code, json.loads(e.read())

    def test_health(self):
        status, body = self._get("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertIn("timestamp", body)

    def test_pairs(self):
        status, body = self._get("/api/pairs")
        self.assertEqual(status, 200)
        self.assertEqual(body["pairs"], ["XAUUSD", "EURUSD", "GBPUSD"])

    def test_config_public(self):
        status, body = self._get("/api/config")
        self.assertEqual(status, 200)
        self.assertEqual(body["thresholds"]["strong"], 65)
        self.assertEqual(body["thresholds"]["good"], 50)
        self.assertIn("XAUUSD", body["pairs"])

    def test_signals_list(self):
        status, body = self._get("/api/signals")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 3)
        # Newest first
        self.assertEqual(body["signals"][0]["pair"], "XAUUSD")
        self.assertEqual(body["signals"][0]["tier"], "WATCHLIST")

    def test_signals_filter_by_pair(self):
        status, body = self._get("/api/signals?pair=XAUUSD")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 2)
        for s in body["signals"]:
            self.assertEqual(s["pair"], "XAUUSD")

    def test_signals_filter_by_tier(self):
        status, body = self._get("/api/signals?tier=STRONG")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["signals"][0]["tier"], "STRONG")

    def test_signals_limit_clamped(self):
        status, body = self._get("/api/signals?limit=2")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 2)

    def test_signal_by_id(self):
        status, body = self._get(f"/api/signals/{self.ids[0]}")
        self.assertEqual(status, 200)
        self.assertEqual(body["signal"]["id"], self.ids[0])
        self.assertEqual(body["signal"]["pair"], "XAUUSD")

    def test_signal_by_id_not_found(self):
        status, body = self._get("/api/signals/999999")
        self.assertEqual(status, 404)
        self.assertIn("not found", body["error"])

    def test_signal_by_id_invalid(self):
        status, body = self._get("/api/signals/notanint")
        self.assertEqual(status, 400)

    def test_unknown_route(self):
        status, _ = self._get("/api/nope")
        self.assertEqual(status, 404)

    def test_reasons_parsed_to_list(self):
        _, body = self._get(f"/api/signals/{self.ids[0]}")
        self.assertIsInstance(body["signal"]["reasons"], list)
        self.assertEqual(body["signal"]["reasons"], ["HTF aligned"])


if __name__ == "__main__":
    unittest.main()
