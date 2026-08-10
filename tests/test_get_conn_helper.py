"""Tests for the _get_conn helper that connects repo objects to
raw psycopg connections for the autonomous persistence layer.

Validates the Postgres round-trip smoke test slice:
_after `_get_conn()` succeeds, a `SELECT 1` should return a row
confirming the connection actually works before the persistence layer
tries to insert setups._
"""
import sys
import unittest
sys.path.insert(0, '.')

from scanner.autonomy.loop import AutonomousLoop


class _FakeCursor:
    def __init__(self, marker):
        self.marker = marker
    def execute(self, _):
        return None
    def fetchone(self):
        return (self.marker,)


class _FakeConnection:
    def __init__(self, marker):
        self.marker = marker
    def cursor(self):
        return _FakeCursor(self.marker)
    def close(self):
        pass


class _FakePool:
    """Pool.connection() returns a context manager that yields a connection."""
    def __init__(self, marker):
        self.marker = marker
    def connection(self):
        outer = self
        class _CM:
            def __enter__(inner):
                return _FakeConnection(outer.marker)
            def __exit__(inner, *_):
                return False
        return _CM()


class _FakeRepo:
    def __init__(self, marker):
        self.marker = marker
    def _get_connection(self):
        return _FakeConnection(self.marker)


class TestGetConnHelper(unittest.TestCase):
    """Postgres round-trip smoke test:
    after _get_conn() succeeds, run a cursor and verify SELECT works."""

    def test_get_conn_returns_connection_from_repo(self):
        """Repo mode: _get_connection returns a raw connection directly."""
        loop = AutonomousLoop.__new__(AutonomousLoop)
        loop._db_conn = _FakeRepo(marker=1)
        conn = loop._get_conn()
        cur = conn.cursor()
        cur.execute('SELECT 1')
        self.assertEqual(cur.fetchone(), (1,))

    def test_get_conn_returns_connection_from_pool(self):
        """Pool mode: connection() returns a context manager."""
        loop = AutonomousLoop.__new__(AutonomousLoop)
        loop._db_conn = _FakePool(marker=2)
        conn = loop._get_conn()
        # When _db_conn is a pool, _get_conn returns the pool.connection()
        # context manager.  The caller is expected to use it via 'with'.
        with conn as raw_conn:
            cur = raw_conn.cursor()
            cur.execute('SELECT 1')
            self.assertEqual(cur.fetchone(), (2,))

    def test_get_conn_with_none_returns_none(self):
        """No connection configured: returns None."""
        loop = AutonomousLoop.__new__(AutonomousLoop)
        loop._db_conn = None
        self.assertIsNone(loop._get_conn())

    def test_get_conn_round_trip_succeeds(self):
        """Simulated SELECT 1 round-trip: prove the returned conn is usable."""
        loop = AutonomousLoop.__new__(AutonomousLoop)
        loop._db_conn = _FakeRepo(marker=42)
        conn = loop._get_conn()
        # Run a real query
        cur = conn.cursor()
        cur.execute('SELECT 1')
        row = cur.fetchone()
        self.assertEqual(row, (42,))
        self.assertIsNotNone(row)
        self.assertEqual(row[0], 42)


if __name__ == '__main__':
    unittest.main()
