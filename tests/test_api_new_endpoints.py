"""Integration tests for the new API endpoints added in this PR:

    GET  /api/positions
    GET  /api/journal
    GET  /api/journal/stats
    GET  /api/kill-switch
    POST /api/kill-switch
    POST /api/scans/refresh
"""
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path
from urllib.error import HTTPError

# Deterministic auth for tests: journal/positions/kill-switch routes are
# bearer-protected, mirroring test_api_hardening.
os.environ.setdefault("JWT_SECRET", "test-secret-do-not-use-in-prod")
from scanner.auth import User, create_access_token

_AUTH_HEADERS = {
    "Authorization": "Bearer " + create_access_token(
        User(id=1, email="test@example.com", name="Test", role="user",
             plan="pro", created_at="2026-01-01T00:00:00Z")
    )
}

from scanner.api import ApiState, make_server
from scanner.broker import Position
from scanner.config import Config
from scanner.data_types import Direction
from scanner.kill_switch import KillSwitch
from scanner.persistence import SQLiteRepository
from scanner.trade_repo import (
    SQLiteClosedTradeRepository,
    SQLitePositionRepository,
)


def _pos(id, pair="XAUUSD", direction=Direction.BUY, status="open"):
    return Position(
        id=id, pair=pair, direction=direction, lot_size=0.10,
        entry=1900.0, stop_loss=1880.0, tp1=1920.0, tp2=1960.0, tp3=2000.0,
        opened_at=time.time(), status=status,
    )


def _trade(pair="XAUUSD", pnl=50.0, outcome="tp2"):
    return {
        "position_id": "p-1", "pair": pair, "direction": "BUY",
        "opened_at": 1, "closed_at": 2,
        "entry": 1900, "exit_price": 1960,
        "stop_loss": 1880, "tp1": 1920, "tp2": 1960,
        "lot_size": 0.1, "sl_pips": 200.0,
        "pnl_usd": pnl, "r_multiple": pnl / 50.0, "outcome": outcome,
    }


class TestNewEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fd, cls.db = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        cls.tmp = tempfile.mkdtemp()
        cls.kill_path = Path(cls.tmp) / "kill"
        cls.scan_trigger = Path(cls.tmp) / "scan_request"
        cls.repo = SQLiteRepository(cls.db)
        cls.pos_repo = SQLitePositionRepository(cls.db)
        cls.closed_repo = SQLiteClosedTradeRepository(cls.db)
        # Seed
        cls.pos_repo.upsert(_pos("p-1"))
        cls.pos_repo.upsert(_pos("p-2", pair="EURUSD", direction=Direction.SELL))
        cls.closed_repo.save(_trade(pnl=100, outcome="tp2"))
        cls.closed_repo.save(_trade(pair="EURUSD", pnl=-50, outcome="sl"))

        cfg = Config(pairs=["XAUUSD", "EURUSD"])
        ks = KillSwitch(cls.kill_path)
        state = ApiState(
            repository=cls.repo, config=cfg,
            position_repo=cls.pos_repo,
            closed_trade_repo=cls.closed_repo,
            kill_switch=ks,
            scan_request_path=str(cls.scan_trigger),
        )
        cls.server = make_server(state, host="127.0.0.1", port=0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.repo.close()
        cls.pos_repo.close_db()
        cls.closed_repo.close_db()
        os.unlink(cls.db)
        if cls.kill_path.exists():
            cls.kill_path.unlink()
        if cls.scan_trigger.exists():
            cls.scan_trigger.unlink()
        os.rmdir(cls.tmp)

    def _get(self, path: str) -> tuple[int, dict]:
        url = f"http://127.0.0.1:{self.port}{path}"
        req = urllib.request.Request(url, headers=_AUTH_HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read())
        except HTTPError as e:
            return e.code, json.loads(e.read())

    def _post(self, path: str, body: dict | None = None) -> tuple[int, dict]:
        data = json.dumps(body or {}).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}", data=data, method="POST",
            headers={"Content-Type": "application/json", **_AUTH_HEADERS},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read() or b"{}")
        except HTTPError as e:
            return e.code, json.loads(e.read())

    # ---- positions -----------------------------------------------------

    def test_positions_list(self):
        status, body = self._get("/api/positions")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 2)
        pairs = {p["pair"] for p in body["positions"]}
        self.assertEqual(pairs, {"XAUUSD", "EURUSD"})

    # ---- journal -------------------------------------------------------

    def test_journal_list(self):
        status, body = self._get("/api/journal")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 2)

    def test_journal_filter_by_pair(self):
        status, body = self._get("/api/journal?pair=XAUUSD")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["trades"][0]["pair"], "XAUUSD")

    def test_journal_stats(self):
        status, body = self._get("/api/journal/stats")
        self.assertEqual(status, 200)
        self.assertEqual(body["trades"], 2)
        self.assertEqual(body["wins"], 1)
        self.assertEqual(body["losses"], 1)
        self.assertAlmostEqual(body["win_rate"], 0.5)

    # ---- kill switch ---------------------------------------------------

    def test_kill_switch_default_disengaged(self):
        status, body = self._get("/api/kill-switch")
        self.assertEqual(status, 200)
        self.assertFalse(body["engaged"])

    def test_kill_switch_engage_then_disengage(self):
        s1, b1 = self._post("/api/kill-switch", {"engaged": True, "reason": "manual"})
        self.assertEqual(s1, 200)
        self.assertTrue(b1["engaged"])
        self.assertEqual(b1["reason"], "manual")

        s2, b2 = self._get("/api/kill-switch")
        self.assertTrue(b2["engaged"])

        s3, b3 = self._post("/api/kill-switch", {"engaged": False})
        self.assertEqual(s3, 200)
        self.assertFalse(b3["engaged"])

    # ---- scan refresh --------------------------------------------------

    def test_scan_refresh_creates_trigger_file(self):
        if self.scan_trigger.exists():
            self.scan_trigger.unlink()
        status, body = self._post("/api/scans/refresh", {})
        self.assertEqual(status, 202)
        self.assertTrue(body["queued"])
        self.assertTrue(self.scan_trigger.exists())


if __name__ == "__main__":
    unittest.main()
