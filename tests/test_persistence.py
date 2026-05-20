import os
import tempfile
import unittest

from scanner.data_types import Direction, Tier
from scanner.persistence import SQLiteRepository
from scanner.signal import Signal


def _signal(pair="XAUUSD", score=72, tier=Tier.STRONG, direction=Direction.BUY):
    return Signal(
        pair=pair, direction=direction, entry=1900.0, stop_loss=1880.0,
        tp1=1925.0, tp2=1940.0, tp3=1965.0,
        confidence_score=score, tier=tier,
        reasons=["HTF aligned", "Fib retest"],
        risk_level="Low", session="London", adr_status="45% used",
        htf_bias="BUY", pattern="Fib retest, CHOCH-bullish",
    )


class TestSQLiteRepository(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.repo = SQLiteRepository(self.path)

    def tearDown(self):
        self.repo.close()
        os.unlink(self.path)

    def test_save_and_recent_roundtrip(self):
        rid = self.repo.save(_signal())
        self.assertGreater(rid, 0)
        rows = self.repo.recent()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["pair"], "XAUUSD")
        self.assertEqual(row["direction"], "BUY")
        self.assertEqual(row["tier"], "STRONG")
        self.assertEqual(row["confidence_score"], 72)
        self.assertEqual(row["reasons"], ["HTF aligned", "Fib retest"])

    def test_recent_orders_newest_first(self):
        self.repo.save(_signal(pair="EURUSD", score=55, tier=Tier.GOOD))
        self.repo.save(_signal(pair="XAUUSD", score=72))
        rows = self.repo.recent()
        self.assertEqual(rows[0]["pair"], "XAUUSD")
        self.assertEqual(rows[1]["pair"], "EURUSD")

    def test_recent_limit(self):
        for i in range(5):
            self.repo.save(_signal(pair=f"P{i}"))
        self.assertEqual(len(self.repo.recent(limit=3)), 3)

    def test_by_pair_filters(self):
        self.repo.save(_signal(pair="EURUSD"))
        self.repo.save(_signal(pair="XAUUSD"))
        self.repo.save(_signal(pair="XAUUSD"))
        rows = self.repo.by_pair("XAUUSD")
        self.assertEqual(len(rows), 2)
        for r in rows:
            self.assertEqual(r["pair"], "XAUUSD")

    def test_count(self):
        self.repo.save(_signal())
        self.repo.save(_signal())
        self.assertEqual(self.repo.count(), 2)

    def test_persists_across_reconnect(self):
        self.repo.save(_signal())
        self.repo.close()
        repo2 = SQLiteRepository(self.path)
        self.assertEqual(repo2.count(), 1)
        repo2.close()


if __name__ == "__main__":
    unittest.main()
