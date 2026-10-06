"""Regression tests for walk-forward alignment in the backtester.

The original implementation truncated higher-timeframe windows by index
ratio (``h1[: i // 4 + 1]``). At M15 bar ``i`` the H1 bar at index
``i // 4`` has not closed yet, so the scoring engine's HTF-bias module --
worth 20 of the 80 available points -- read ``closes[-1]`` off a bar that
was still forming. These tests pin the corrected timestamp-aligned
behaviour so the bias cannot silently return.
"""
from __future__ import annotations

import unittest

from scanner.backtester import _AlignedWindows, run_backtest
from scanner.data_types import Candle

M15 = 900
H1 = 3_600
H4 = 14_400
D1 = 86_400

T0 = 1_700_000_000  # arbitrary aligned epoch base


def _series(count: int, step: int, start: int = T0, base: float = 1.0) -> list[Candle]:
    """A simple deterministic candle series, one bar every ``step`` seconds."""
    out = []
    for i in range(count):
        t = start + i * step
        drift = base * (1.0 + i * 0.0001)
        out.append(
            Candle(time=t, open=drift, high=drift * 1.001,
                   low=drift * 0.999, close=drift, volume=1000.0)
        )
    return out


class TestAlignedWindows(unittest.TestCase):
    def test_excludes_still_forming_bar(self):
        # Three H1 bars opening at T0, T0+3600, T0+7200.
        h1 = _series(3, H1)
        win = _AlignedWindows(h1, "1h")

        # At M15 bar opening T0+900 (closes T0+1800) the first H1 bar has
        # NOT closed (it closes at T0+3600). With a minimum of 1 we still
        # return one bar so the modules have something to work with.
        as_of_early = T0 + 900 + M15
        got = win.window(as_of_early, minimum=1)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0].time, T0)

        # Once the first H1 bar has closed, exactly one bar is visible.
        as_of_1 = T0 + 3600
        self.assertEqual(len(win.window(as_of_1)), 1)

        # Once the second has closed, two are visible.
        as_of_2 = T0 + 7200
        self.assertEqual(len(win.window(as_of_2)), 2)

    def test_window_never_includes_future_bar(self):
        """Strict invariant: no window may contain an unclosed bar."""
        h1 = _series(20, H1)
        win = _AlignedWindows(h1, "1h")
        for i in range(20):
            as_of = T0 + i * H1
            for c in win.window(as_of, minimum=0):
                self.assertLessEqual(
                    c.time + H1, as_of,
                    "window leaked a bar that had not closed yet",
                )

    def test_minimum_floor_only_applies_before_first_close(self):
        """The minimum=1 floor is a warmup safety net, not a leak.

        It can only ever hand back the *earliest* bar, and only while no
        bar has closed yet. Once any bar has closed, the floor is
        irrelevant because the truncated set is already non-empty.
        """
        h1 = _series(5, H1)
        win = _AlignedWindows(h1, "1h")

        # Before the very first H1 close: floor yields exactly the first
        # bar, and never a later one.
        early = win.window(T0 + M15, minimum=1)
        self.assertEqual(len(early), 1)
        self.assertEqual(early[0].time, T0)

        # From the first close onward the floor never overrides.
        for i in range(1, 5):
            as_of = T0 + i * H1
            self.assertEqual(len(win.window(as_of, minimum=1)), i)

    def test_weekend_gap_does_not_break_alignment(self):
        # A series with a 3-day hole (weekend) in the middle.
        m15 = _series(5, M15, start=T0) + _series(5, M15, start=T0 + 3 * D1)
        win = _AlignedWindows(m15, "15m")
        self.assertEqual(len(win.window(T0 + M15, minimum=0)), 1)


class TestBacktestAlignmentIntegration(unittest.TestCase):
    def test_backtest_runs_and_reports(self):
        """A full run must still execute end-to-end after the change."""
        m15 = _series(600, M15)
        h1 = _series(300, H1, start=T0 - 200 * H1)
        h4 = _series(120, H4, start=T0 - 200 * H4)
        d1 = _series(60, D1, start=T0 - 60 * D1)

        res = run_backtest("TEST", d1, h4, h1, m15, min_warmup_bars=220, stride=4)

        self.assertGreater(res.bars_processed, 0)
        self.assertEqual(res.ending_balance, res.starting_balance + sum(
            t.pnl_usd for t in res.trades))
        for t in res.trades:
            self.assertGreaterEqual(t.exit_index, t.entry_index)


if __name__ == "__main__":
    unittest.main()
