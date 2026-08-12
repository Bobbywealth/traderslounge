"""Unit tests for build_memory_notes() in scanner/trading_memory.

Bobby 2026-08-11: Trading Memory should produce plain-language notes
like "XAUUSD has rejected the 4400-4410 zone 3 times" backed by real
data from journal_entries + news_event_interactions.
"""
import sqlite3
import unittest

from scanner.trading_memory import build_memory_notes


def _make_sqlite_conn(rows_journal=None, rows_news=None):
    """Build an in-memory sqlite with journal_entries + news tables."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = None
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE journal_entries (
            setup_id TEXT PRIMARY KEY,
            symbol TEXT,
            direction TEXT,
            timeframe TEXT,
            strategy_type TEXT,
            entry_low REAL,
            entry_high REAL,
            actual_entry REAL,
            actual_exit REAL,
            outcome TEXT,
            r_multiple REAL,
            market_regime TEXT,
            session TEXT,
            detected_at REAL
        )
        """
    )
    for row in (rows_journal or []):
        cur.execute(
            """INSERT INTO journal_entries (
                setup_id, symbol, direction, timeframe, strategy_type,
                entry_low, entry_high, actual_entry, actual_exit,
                outcome, r_multiple, market_regime, session, detected_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            row,
        )
    cur.execute(
        """
        CREATE TABLE news_event_interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT,
            event_name TEXT,
            impact TEXT,
            move_pct REAL,
            ts REAL
        )
        """
    )
    for row in (rows_news or []):
        cur.execute(
            """INSERT INTO news_event_interactions (
                symbol, event_name, impact, move_pct, ts
            ) VALUES (?,?,?,?,?)""",
            row,
        )
    conn.commit()
    return conn


class TestBuildMemoryNotes(unittest.TestCase):
    def test_empty_db_returns_empty_list(self):
        conn = _make_sqlite_conn()
        notes = build_memory_notes(
            pair="XAUUSD",
            conn_factory=lambda: _ConnCtx(conn),
        )
        self.assertEqual(notes, [])

    def test_no_db_returns_empty_list(self):
        notes = build_memory_notes(pair="XAUUSD", conn_factory=None)
        self.assertEqual(notes, [])

    def test_zone_rejection_above_threshold(self):
        # 3 BUY setups at the 4400-4410 zone, all losses — should produce
        # one zone_rejection note with evidence_n=3 and confidence 'med'.
        rows = [
            (f"s{i}", "XAUUSD", "BUY", "H1", "confluence",
             4400.0, 4410.0, 4405.0, 4380.0, "loss", -1.0, "trend", "london", 1.0 + i)
            for i in range(3)
        ]
        conn = _make_sqlite_conn(rows_journal=rows)
        notes = build_memory_notes(
            pair="XAUUSD", conn_factory=lambda: _ConnCtx(conn)
        )
        zone_notes = [n for n in notes if n["category"] == "zone_rejection"]
        self.assertGreaterEqual(len(zone_notes), 1)
        n = zone_notes[0]
        self.assertIn("4400", n["note"])
        self.assertIn("4410", n["note"])
        self.assertIn("3 times", n["note"])
        self.assertEqual(n["evidence_n"], 3)
        self.assertEqual(n["confidence"], "med")
        self.assertIn("supply", n["note"])

    def test_news_impact_averaging(self):
        # 4 CPI events each with >1.2% move — should produce a note.
        rows_news = [
            ("XAUUSD", "CPI", "high", 1.5, 1.0),
            ("XAUUSD", "CPI", "high", 1.7, 2.0),
            ("XAUUSD", "CPI", "high", 1.3, 3.0),
            ("XAUUSD", "CPI", "high", 1.4, 4.0),
        ]
        conn = _make_sqlite_conn(rows_news=rows_news)
        notes = build_memory_notes(
            pair="XAUUSD", conn_factory=lambda: _ConnCtx(conn)
        )
        news_notes = [n for n in notes if n["category"] == "news_impact"]
        self.assertEqual(len(news_notes), 1)
        self.assertIn("CPI", news_notes[0]["note"])
        self.assertIn("4", news_notes[0]["note"])
        self.assertEqual(news_notes[0]["evidence_n"], 4)

    def test_session_underperformance_detection(self):
        # 6 BUY confluence setups in london session, low_volatility regime.
        # 1 win, 5 losses → win_rate 16.6% → should flag.
        base = 1.0
        rows = []
        outcomes = ["win", "loss", "loss", "loss", "loss", "loss"]
        for i, outcome in enumerate(outcomes):
            rows.append(
                (f"s{i}", "EURUSD", "BUY", "H1", "confluence",
                 1.10, 1.11, 1.105, 1.09, outcome, -1.0,
                 "low_volatility", "london", base + i)
            )
        conn = _make_sqlite_conn(rows_journal=rows)
        notes = build_memory_notes(
            pair="EURUSD", conn_factory=lambda: _ConnCtx(conn)
        )
        session_notes = [n for n in notes if n["category"] == "session_pattern"]
        self.assertGreaterEqual(len(session_notes), 1)
        self.assertIn("confluence", session_notes[0]["note"])
        self.assertIn("london", session_notes[0]["note"])
        self.assertIn("low_volatility", session_notes[0]["note"])

    def test_high_confidence_for_many_rejections(self):
        # 6 rejections at same zone → confidence 'high'
        rows = [
            (f"s{i}", "XAUUSD", "BUY", "H1", "confluence",
             4400.0, 4410.0, 4405.0, 4380.0, "loss", -1.0,
             "trend", "london", 1.0 + i)
            for i in range(6)
        ]
        conn = _make_sqlite_conn(rows_journal=rows)
        notes = build_memory_notes(
            pair="XAUUSD", conn_factory=lambda: _ConnCtx(conn)
        )
        zone_notes = [n for n in notes if n["category"] == "zone_rejection"]
        self.assertEqual(zone_notes[0]["confidence"], "high")
        self.assertEqual(zone_notes[0]["evidence_n"], 6)


class _ConnCtx:
    """Tiny context-manager wrapper so build_memory_notes can .__enter__ it."""
    def __init__(self, conn):
        self.conn = conn
    def __enter__(self):
        return self.conn.cursor()
    def __exit__(self, *exc):
        return False


if __name__ == "__main__":
    unittest.main()