import datetime as dt
import unittest
from unittest.mock import MagicMock

from scanner.config import Config
from scanner.data_provider import DataProviderError
from scanner.news_filter import NewsEvent, NewsFilter
from scanner.scheduler import Scanner
from scanner.signal import Signal, Tier
from scanner.data_types import Direction, MarketSnapshot
from tests.test_scoring_engine import _gold_buy_snapshot, _no_trade_snapshot


class FakeClock:
    def __init__(self, now: dt.datetime):
        self._now = now

    def now(self) -> dt.datetime:
        return self._now

    def sleep(self, _seconds: float) -> None:
        pass


def _make_scanner(pairs, snapshots_by_pair, news=None):
    cfg = Config(pairs=pairs, scan_interval_seconds=1)
    client = MagicMock()
    client.fetch_snapshot.side_effect = lambda pair, timeframes=None: snapshots_by_pair[pair]
    sink = MagicMock()
    return Scanner(
        config=cfg,
        client=client,
        news=news or NewsFilter(),
        sink=sink,
        clock=FakeClock(dt.datetime(2026, 5, 20, 13, 30, tzinfo=dt.timezone.utc)),
    ), sink, client


class TestScheduler(unittest.TestCase):
    def test_scan_once_visits_every_pair(self):
        snaps = {p: _no_trade_snapshot() for p in ("XAUUSD", "EURUSD")}
        # All pairs need pair attr set; _no_trade_snapshot returns XAUUSD
        for p, s in snaps.items():
            s.pair = p
        scanner, sink, client = _make_scanner(["XAUUSD", "EURUSD"], snaps)
        results = scanner.scan_once()
        self.assertEqual(len(results), 2)
        self.assertEqual(client.fetch_snapshot.call_count, 2)
        sink.assert_not_called()  # no_trade → below emit threshold

    def test_emits_to_sink_when_above_threshold(self):
        buy_snap = _gold_buy_snapshot()
        buy_snap.pair = "XAUUSD"
        scanner, sink, _ = _make_scanner(["XAUUSD"], {"XAUUSD": buy_snap})
        scanner.scan_once()
        sink.assert_called_once()
        sig: Signal = sink.call_args[0][0]
        self.assertEqual(sig.pair, "XAUUSD")
        self.assertEqual(sig.direction, Direction.BUY)
        self.assertIn(sig.tier, (Tier.GOOD, Tier.STRONG))

    def test_data_error_records_in_result_and_skips_sink(self):
        cfg = Config(pairs=["XAUUSD"], scan_interval_seconds=1)
        client = MagicMock()
        client.fetch_snapshot.side_effect = DataProviderError("boom")
        sink = MagicMock()
        scanner = Scanner(config=cfg, client=client, news=NewsFilter(), sink=sink,
                          clock=FakeClock(dt.datetime.now(dt.timezone.utc)))
        results = scanner.scan_once()
        self.assertEqual(results[0].error, "boom")
        sink.assert_not_called()

    def test_news_blackout_skips_pair(self):
        snap = _gold_buy_snapshot()
        snap.pair = "XAUUSD"
        clock_now = dt.datetime(2026, 5, 20, 13, 30, tzinfo=dt.timezone.utc)
        nf = NewsFilter(blackout_minutes=15)
        nf.add(NewsEvent(pair="XAUUSD", when=clock_now, title="CPI"))
        cfg = Config(pairs=["XAUUSD"], scan_interval_seconds=1)
        client = MagicMock()
        client.fetch_snapshot.return_value = snap
        sink = MagicMock()
        scanner = Scanner(config=cfg, client=client, news=nf, sink=sink,
                          clock=FakeClock(clock_now))
        results = scanner.scan_once()
        self.assertEqual(results[0].blackout, "CPI")
        client.fetch_snapshot.assert_not_called()
        sink.assert_not_called()


if __name__ == "__main__":
    unittest.main()
