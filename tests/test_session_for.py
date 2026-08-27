"""Tests for the trading-session window helper used across ConfluenceX."""
import datetime as _dt_module
import unittest

from scanner.signal import is_high_impact_session, session_for


def _epoch(hour_utc):
    """Return a UTC epoch seconds value at the given UTC hour today."""
    base = _dt_module.datetime(2026, 8, 27, 0, 0, 0, tzinfo=_dt_module.timezone.utc)
    return int((base + _dt_module.timedelta(hours=hour_utc)).timestamp())


class SessionForTest(unittest.TestCase):
    def test_asian_window(self):
        for h in (0, 3, 6, 6):
            self.assertEqual(session_for(_epoch(h)), "Asian")

    def test_london_window(self):
        for h in (7, 9, 11):
            self.assertEqual(session_for(_epoch(h)), "London")

    def test_london_ny_overlap_window(self):
        for h in (12, 14, 16):
            self.assertEqual(session_for(_epoch(h)), "London/NY")

    def test_new_york_window(self):
        for h in (17, 18, 20):
            self.assertEqual(session_for(_epoch(h)), "New York")

    def test_after_hours_window(self):
        for h in (21, 22, 23):
            self.assertEqual(session_for(_epoch(h)), "After Hours")

    def test_old_overlap_label_returns_london_ny(self):
        """Old code returned 'London/NY Overlap'; new code returns 'London/NY'.

        Test documents the tightening: any consumer of session_for needs
        to expect the shorter label now.
        """
        self.assertEqual(session_for(_epoch(13)), "London/NY")


class HighImpactSessionTest(unittest.TestCase):
    def test_overlap_is_high_impact(self):
        for h in (12, 14, 16, 16):
            self.assertTrue(is_high_impact_session(_epoch(h)))

    def test_london_pre_overlap_not_high_impact(self):
        for h in (7, 9, 11):
            self.assertFalse(is_high_impact_session(_epoch(h)))

    def test_ny_post_overlap_not_high_impact(self):
        for h in (17, 19, 22):
            self.assertFalse(is_high_impact_session(_epoch(h)))


if __name__ == "__main__":
    unittest.main()