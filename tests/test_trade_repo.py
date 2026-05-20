import os
import tempfile
import time
import unittest

from scanner.broker import Position
from scanner.data_types import Direction
from scanner.trade_repo import (
    SQLiteClosedTradeRepository,
    SQLitePositionRepository,
)


def _pos(id="p-1", pair="XAUUSD", direction=Direction.BUY, lots=0.10,
         entry=1900.0, sl=1880.0, tp1=1920.0, tp2=1960.0, tp3=2000.0,
         status="open"):
    return Position(
        id=id, pair=pair, direction=direction, lot_size=lots,
        entry=entry, stop_loss=sl, tp1=tp1, tp2=tp2, tp3=tp3,
        opened_at=time.time(), status=status,
    )


class TestPositionRepo(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.repo = SQLitePositionRepository(self.path)

    def tearDown(self):
        self.repo.close_db()
        os.unlink(self.path)

    def test_upsert_creates_row(self):
        self.repo.upsert(_pos())
        rows = self.repo.open_positions()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["pair"], "XAUUSD")
        self.assertEqual(rows[0]["direction"], "BUY")
        self.assertEqual(rows[0]["status"], "open")

    def test_upsert_updates_existing(self):
        pos = _pos()
        self.repo.upsert(pos)
        pos.stop_loss = 1900.0  # SL→BE
        pos.lot_size = 0.05     # halved at TP1
        pos.status = "partially_closed"
        self.repo.upsert(pos)
        rows = self.repo.open_positions()
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0]["stop_loss"], 1900.0)
        self.assertAlmostEqual(rows[0]["lot_size"], 0.05)
        self.assertEqual(rows[0]["status"], "partially_closed")

    def test_close_marks_status_and_excludes_from_open(self):
        self.repo.upsert(_pos())
        self.repo.close("p-1", closed_at=time.time())
        self.assertEqual(self.repo.open_positions(), [])
        # Still retrievable via get()
        row = self.repo.get("p-1")
        self.assertEqual(row["status"], "closed")
        self.assertIsNotNone(row["closed_at"])


class TestClosedTradeRepo(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.repo = SQLiteClosedTradeRepository(self.path)

    def tearDown(self):
        self.repo.close_db()
        os.unlink(self.path)

    def _trade(self, pair="XAUUSD", pnl=50.0, r=1.0, outcome="tp2"):
        return {
            "position_id": "p-1", "pair": pair, "direction": "BUY",
            "opened_at": 1, "closed_at": 2,
            "entry": 1900, "exit_price": 1960,
            "stop_loss": 1880, "tp1": 1920, "tp2": 1960,
            "lot_size": 0.1, "sl_pips": 200.0,
            "pnl_usd": pnl, "r_multiple": r, "outcome": outcome,
        }

    def test_save_and_recent(self):
        rid = self.repo.save(self._trade())
        self.assertGreater(rid, 0)
        rows = self.repo.recent()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["outcome"], "tp2")

    def test_recent_filtered_by_pair(self):
        self.repo.save(self._trade(pair="EURUSD"))
        self.repo.save(self._trade(pair="XAUUSD"))
        rows = self.repo.recent(pair="XAUUSD")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["pair"], "XAUUSD")

    def test_stats_no_trades(self):
        s = self.repo.stats()
        self.assertEqual(s["trades"], 0)
        self.assertEqual(s["win_rate"], 0.0)

    def test_stats_with_wins_and_losses(self):
        self.repo.save(self._trade(pnl=100, r=2, outcome="tp2"))
        self.repo.save(self._trade(pnl=100, r=2, outcome="tp2"))
        self.repo.save(self._trade(pnl=-50, r=-1, outcome="sl"))
        s = self.repo.stats()
        self.assertEqual(s["trades"], 3)
        self.assertEqual(s["wins"], 2)
        self.assertEqual(s["losses"], 1)
        self.assertAlmostEqual(s["win_rate"], 2 / 3)
        self.assertAlmostEqual(s["gross_profit"], 200)
        self.assertAlmostEqual(s["gross_loss"], 50)
        self.assertAlmostEqual(s["profit_factor"], 4.0)
        self.assertAlmostEqual(s["total_pnl"], 150)


if __name__ == "__main__":
    unittest.main()
