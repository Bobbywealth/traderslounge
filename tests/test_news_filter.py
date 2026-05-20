import datetime as dt
import unittest

from scanner.news_filter import NewsEvent, NewsFilter


class TestNewsFilter(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 5, 20, 13, 30, tzinfo=dt.timezone.utc)
        self.filter = NewsFilter(blackout_minutes=15)

    def test_no_events_no_blackout(self):
        self.assertIsNone(self.filter.is_blacked_out("XAUUSD", self.now))

    def test_pair_specific_event_within_window(self):
        self.filter.add(NewsEvent(
            pair="XAUUSD", when=self.now + dt.timedelta(minutes=5), title="CPI"))
        ev = self.filter.is_blacked_out("XAUUSD", self.now)
        self.assertIsNotNone(ev)

    def test_pair_specific_event_outside_window(self):
        self.filter.add(NewsEvent(
            pair="XAUUSD", when=self.now + dt.timedelta(minutes=30)))
        self.assertIsNone(self.filter.is_blacked_out("XAUUSD", self.now))

    def test_global_event_blocks_all_pairs(self):
        self.filter.add(NewsEvent(
            pair="*", when=self.now, title="FOMC"))
        self.assertIsNotNone(self.filter.is_blacked_out("EURUSD", self.now))
        self.assertIsNotNone(self.filter.is_blacked_out("XAUUSD", self.now))

    def test_other_pair_unaffected(self):
        self.filter.add(NewsEvent(pair="EURUSD", when=self.now))
        self.assertIsNone(self.filter.is_blacked_out("XAUUSD", self.now))


if __name__ == "__main__":
    unittest.main()
