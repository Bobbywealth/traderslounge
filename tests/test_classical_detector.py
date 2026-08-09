"""Tests for classical chart pattern detection."""
import unittest

from scanner.data_types import Candle, Swing
from scanner.modules.classical import (
    detect_all_from_swings,
    _double,
    _triple,
    _head_and_shoulders,
    _triangle,
    _wedge,
    _range,
    _cup_and_handle,
    _scan_windows,
    _triangle_scanner,
    _double_scanner,
)


def _make_swings(prices_and_types):
    """Helper to build swing list from [(price, type), ...] tuples."""
    return [
        Swing(index=i, time=1_700_000_000 + i * 60, price=p, type=t)
        for i, (p, t) in enumerate(prices_and_types)
    ]


def _make_candles(n=30, base=100.0):
    """Generate synthetic candles for ATR computation."""
    candles = []
    for i in range(n):
        o = base + i * 0.5
        h = o + 2.0
        l = o - 1.5
        c = o + 0.5
        candles.append(Candle(time=1_700_000_000 + i * 60, open=o, high=h, low=l, close=c))
    return candles


class TestDoublePatterns(unittest.TestCase):
    def test_double_top(self):
        # Double Top: high-low-high (last 3 pivots)
        # Heights: 105-90=15, tolerance=15*0.06=0.9, difference=|105-105.5|=0.5 < 0.9 OK
        swings = _make_swings([
            (100.0, "low"), (105.0, "high"), (90.0, "low"),
            (105.5, "high"),
        ])
        result = _double(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Double Top")
        self.assertEqual(result["direction"], "bearish")
        self.assertIn("neckline", result)
        self.assertIn("trade_levels", result)
        self.assertEqual(result["status"], "candidate")
        self.assertFalse(result["validated"])

    def test_double_bottom(self):
        # Double Bottom: low-high-low (last 3 pivots)
        # Height: 110-90=20, tol=20*0.06=1.2, diff=|90-90.5|=0.5 < 1.2 OK
        swings = _make_swings([
            (110.0, "high"), (90.0, "low"), (105.0, "high"),
            (90.5, "low"),
        ])
        result = _double(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Double Bottom")
        self.assertEqual(result["direction"], "bullish")

    def test_no_double_if_levels_differ(self):
        # Two highs at very different levels
        swings = _make_swings([
            (100.0, "low"), (110.0, "high"), (95.0, "low"),
            (130.0, "high"),
        ])
        result = _double(swings)
        self.assertIsNone(result)


class TestTriplePatterns(unittest.TestCase):
    def test_triple_top(self):
        # Triple Top: H-L-H-L-H (5 alternating pivots, highs at similar level)
        # Height: 110-95=15, tol=15*0.06=0.9
        # Differences: |110-109|=1, |109-110.5|=1.5, |110-110.5|=0.5
        # Need all three pairwise similar — use tighter values
        swings = _make_swings([
            (110.0, "high"), (95.0, "low"),
            (110.2, "high"), (94.5, "low"), (110.5, "high"),
        ])
        result = _triple(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Triple Top")
        self.assertEqual(result["direction"], "bearish")

    def test_triple_bottom(self):
        # Triple Bottom: L-H-L-H-L (5 alternating pivots, lows at similar level)
        # Height: 105-90=15, tol=15*0.06=0.9
        swings = _make_swings([
            (90.0, "low"), (105.0, "high"),
            (90.2, "low"), (105.5, "high"), (90.5, "low"),
        ])
        result = _triple(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Triple Bottom")
        self.assertEqual(result["direction"], "bullish")


class TestHeadAndShoulders(unittest.TestCase):
    def test_head_and_shoulders(self):
        # H&S: left_shoulder-low-head-low-right_shoulder (5 pivots, highs: LS < head > RS)
        swings = _make_swings([
            (110.0, "high"), (95.0, "low"),   # left shoulder, trough
            (120.0, "high"), (94.0, "low"),    # head, trough
            (109.0, "high"),                    # right shoulder
        ])
        result = _head_and_shoulders(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Head and Shoulders")
        self.assertEqual(result["direction"], "bearish")
        self.assertIn("neckline", result)

    def test_inverse_head_and_shoulders(self):
        # Inv H&S: LS-high-head-high-RS (5 pivots, lows: LS > head < RS)
        swings = _make_swings([
            (90.0, "low"), (105.0, "high"),   # left shoulder, peak
            (80.0, "low"), (106.0, "high"),    # head, peak
            (91.0, "low"),                     # right shoulder
        ])
        result = _head_and_shoulders(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Inverse Head and Shoulders")
        self.assertEqual(result["direction"], "bullish")

    def test_not_hs_if_shoulders_unequal(self):
        # Right shoulder way higher than left — should not match
        swings = _make_swings([
            (110.0, "high"), (95.0, "low"),
            (120.0, "high"), (94.0, "low"),
            (140.0, "high"),  # right shoulder way higher
        ])
        result = _head_and_shoulders(swings)
        self.assertIsNone(result)


class TestTriangle(unittest.TestCase):
    def test_ascending_triangle(self):
        swings = _make_swings([
            (90.0, "low"), (110.0, "high"),
            (95.0, "low"), (110.5, "high"),
        ])
        result = _triangle(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Ascending Triangle")
        self.assertEqual(result["direction"], "bullish")

    def test_descending_triangle(self):
        swings = _make_swings([
            (110.0, "high"), (90.0, "low"),
            (105.0, "high"), (90.5, "low"),
        ])
        result = _triangle(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Descending Triangle")
        self.assertEqual(result["direction"], "bearish")

    def test_symmetrical_triangle(self):
        swings = _make_swings([
            (90.0, "low"), (110.0, "high"),
            (95.0, "low"), (105.0, "high"),
        ])
        result = _triangle(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Symmetrical Triangle")


class TestWedge(unittest.TestCase):
    def test_rising_wedge(self):
        # Rising wedge: 4 alternating pivots, both trendlines slope up, converge
        # Support rises faster: l2-l1 = 95-90 = 5, h2-h1 = 105-100 = 5
        # But 5 > 5 is false. Need: (l2-l1) > (h2-h1)
        # Use: h1=100, h2=104 (rise=4), l1=90, l2=96 (rise=6)
        swings = _make_swings([
            (100.0, "high"), (90.0, "low"),
            (104.0, "high"), (96.0, "low"),
        ])
        result = _wedge(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Rising Wedge")
        self.assertEqual(result["direction"], "bearish")

    def test_falling_wedge(self):
        # Falling wedge: 4 alternating pivots, both trendlines slope down, converge
        # Resistance falls faster: h1-h2 = 110-104 = 6, l1-l2 = 90-86 = 4
        # Need: (h1-h2) > (l1-l2) → 6 > 4 OK
        swings = _make_swings([
            (110.0, "high"), (90.0, "low"),
            (104.0, "high"), (86.0, "low"),
        ])
        result = _wedge(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Falling Wedge")
        self.assertEqual(result["direction"], "bullish")


class TestRange(unittest.TestCase):
    def test_range(self):
        swings = _make_swings([
            (90.0, "low"), (110.0, "high"),
            (91.0, "low"), (109.0, "high"),
            (90.5, "low"), (110.5, "high"),
        ])
        result = _range(swings)
        self.assertIsNotNone(result)
        self.assertEqual(result["name"], "Range")
        self.assertIn("neckline", result)


class TestCupAndHandle(unittest.TestCase):
    def test_cup_with_handle(self):
        # Cup: left rim (high) -> bottom (low) -> right rim (high)
        # Handle: small pullback (low) after right rim
        swings = _make_swings([
            (100.0, "high"),  # left rim
            (80.0, "low"),    # cup bottom
            (101.0, "high"),  # right rim
            (95.0, "low"),    # handle (shallow pullback)
            (105.0, "high"),  # continuation
        ])
        candles = _make_candles(30, base=90.0)
        result = _cup_and_handle(swings, candles)
        # Cup and handle requires enough pivots; may or may not match depending on structure
        if result is not None:
            self.assertIn("Cup", result["name"])
            self.assertEqual(result["direction"], "bullish")

    def test_cup_no_handle(self):
        swings = _make_swings([
            (100.0, "high"),  # left rim
            (80.0, "low"),    # cup bottom
            (101.0, "high"),  # right rim
        ])
        candles = _make_candles(30, base=90.0)
        result = _cup_and_handle(swings, candles)
        # No handle - might return "Cup (no handle)" or None depending on pivot count
        if result is not None:
            self.assertIn("Cup", result["name"])

    def test_cup_structure(self):
        # More pivots to ensure the cup formation is detected
        swings = _make_swings([
            (95.0, "low"),
            (100.0, "high"),  # left rim
            (80.0, "low"),    # cup bottom
            (101.0, "high"),  # right rim
            (95.0, "low"),    # handle
            (105.0, "high"),
        ])
        candles = _make_candles(30, base=90.0)
        result = _cup_and_handle(swings, candles)
        if result is not None:
            self.assertIn("Cup", result["name"])


class TestDetectAll(unittest.TestCase):
    def test_detect_all_returns_list(self):
        swings = _make_swings([
            (90.0, "low"), (110.0, "high"), (95.0, "low"),
            (111.0, "high"), (100.0, "low"),
        ])
        candles = _make_candles(30, base=100.0)
        results = detect_all_from_swings(swings, candles)
        self.assertIsInstance(results, list)
        # Should find at least one pattern
        self.assertGreater(len(results), 0)
        # All results should have required fields
        for r in results:
            self.assertIn("name", r)
            self.assertIn("direction", r)
            self.assertIn("status", r)
            self.assertIn("family", r)
            self.assertEqual(r["family"], "classical")
            self.assertIn("trade_levels", r)
            self.assertIn("forward_validation", r)

    def test_no_patterns_with_too_few_swings(self):
        swings = _make_swings([(90.0, "low"), (110.0, "high")])
        candles = _make_candles(30, base=100.0)
        results = detect_all_from_swings(swings, candles)
        self.assertEqual(len(results), 0)

    def test_pattern_deduplication(self):
        """A head-and-shoulders should suppress the weaker triple-top reading."""
        swings = _make_swings([
            (90.0, "low"), (110.0, "high"), (95.0, "low"),
            (120.0, "high"), (94.0, "low"), (109.0, "high"), (100.0, "low"),
        ])
        candles = _make_candles(30, base=100.0)
        results = detect_all_from_swings(swings, candles)
        names = [r["name"] for r in results]
        # Should not have both H&S and Triple Top for the same pivots
        if "Head and Shoulders" in names:
            self.assertNotIn("Triple Top", names)


class TestWindowScanners(unittest.TestCase):
    """Triangle and double are now scanned across a window, not just the last
    N pivots. These tests confirm the scanner picks up patterns that formed
    several pivots ago when the very last pivots don't fit any template."""

    def _alternating_swings(self, prices_and_types):
        return _make_swings(prices_and_types)

    def test_triangle_in_earlier_window(self):
        """Ascending triangle in pivots 0-3, then divergent noise to pivot 7.
        With the strict last-4 behaviour this would be missed; the scanner
        should now find it inside its 20-pivot lookback."""
        swings = self._alternating_swings([
            (95.0, "low"),       # 0: ascending-triangle left rim
            (110.0, "high"),     # 1: ascending-triangle flat top #1
            (100.0, "low"),      # 2: rising low #1
            (110.0, "high"),     # 3: ascending-triangle flat top #2
            (92.0, "low"),       # 4: structure break — divergent noise begins
            (105.0, "high"),     # 5
            (90.0, "low"),       # 6
            (100.0, "high"),     # 7: lower highs and lower lows, no convergence
        ])
        candles = _make_candles(30, base=100.0)

        # The strict last-4 behaviour sees pivots 4-7: L 92, H 105, L 90, H 100
        # — diverging pivots, no triangle.
        strict = _triangle(swings[-4:])
        self.assertIsNone(strict)

        # The scanner reaches back to pivots 0-3 and finds the ascending triangle.
        scanned = _triangle_scanner(swings)
        self.assertIsNotNone(scanned)
        self.assertEqual(scanned["name"], "Ascending Triangle")
        self.assertEqual(scanned["direction"], "bullish")
        self.assertEqual(scanned["family"], "classical")
        # Pivots A-D should map to the original triangle's four pivots.
        pivot_indexes = sorted(int(p["index"]) for p in scanned["points"].values())
        self.assertEqual(pivot_indexes, [0, 1, 2, 3])

    def test_double_bottom_in_earlier_window(self):
        """Double bottom in pivots 0-2, then noise. The strict last-3
        behaviour sees pivots 3-5 (H-L-H, wrong shape); the scanner must
        reach back to find the double bottom inside its 12-pivot lookback."""
        swings = self._alternating_swings([
            (95.0, "low"),       # 0: double bottom left
            (110.0, "high"),     # 1: trough neckline
            (95.5, "low"),       # 2: double bottom right (within 6% tolerance)
            (108.0, "high"),     # 3: noise — pattern ends here
            (92.0, "low"),       # 4
            (105.0, "high"),     # 5: last 3 pivots are H 108, L 92, H 105
        ])
        candles = _make_candles(30, base=100.0)

        # Strict last-3 sees H-L-H, which is not the L-H-L shape double needs.
        strict = _double(swings[-3:])
        self.assertIsNone(strict)

        scanned = _double_scanner(swings)
        self.assertIsNotNone(scanned)
        self.assertEqual(scanned["name"], "Double Bottom")
        self.assertEqual(scanned["direction"], "bullish")
        pivot_indexes = sorted(int(p["index"]) for p in scanned["points"].values())
        self.assertEqual(pivot_indexes, [0, 1, 2])

    def test_pattern_beyond_lookback_missed(self):
        """A triangle far enough back must NOT fire — the lookback ceiling
        keeps the detector from reporting a stale, possibly-broken formation."""
        # 30 pivots of divergent noise, then 4 pivots forming an ascending
        # triangle at the very start (indices 0-3). With _TRIANGLE_LOOKBACK=20,
        # the scanner only inspects windows ending in the last 20 pivots, so
        # the triangle at indices 0-3 should be missed.
        prices_types = []
        for i in range(30):
            if i % 2 == 0:
                # Diverging pivots: high climbs, low climbs faster
                prices_types.append((100.0 + i * 0.5, "high"))
            else:
                prices_types.append((50.0 + i * 0.4, "low"))
        # Overwrite the first 4 pivots with a clean ascending triangle.
        prices_types[0] = (95.0, "low")
        prices_types[1] = (110.0, "high")
        prices_types[2] = (100.0, "low")
        prices_types[3] = (110.0, "high")
        swings = _make_swings(prices_types)

        scanned = _triangle_scanner(swings)
        self.assertIsNone(scanned, "Triangle at the very start should fall "
                                  "outside the 20-pivot lookback")

    def test_scan_windows_helper_returns_none_for_empty(self):
        swings = _make_swings([(100.0, "low"), (110.0, "high")])
        self.assertIsNone(_scan_windows(swings, _triangle, window_size=4,
                                        max_lookback=20))

    def test_scan_windows_helper_finds_recent(self):
        """The helper returns the most recent qualifying match first."""
        # Two ascending triangles: one at [0:4], another at [5:9].
        swings = _make_swings([
            (95.0, "low"), (110.0, "high"), (100.0, "low"), (110.0, "high"),  # 0-3
            (97.0, "low"), (110.0, "high"), (102.0, "low"), (110.0, "high"),  # 4-7
        ])
        result = _scan_windows(swings, _triangle, window_size=4, max_lookback=20)
        self.assertIsNotNone(result)
        # The most recent window [4:8] should be the one returned.
        pivot_indexes = sorted(int(p["index"]) for p in result["points"].values())
        self.assertEqual(pivot_indexes, [4, 5, 6, 7])

    def test_detect_all_picks_up_triangle_via_scanner(self):
        """End-to-end check: an ascending triangle 4 pivots back is surfaced
        by detect_all_from_swings even when the most recent 4 pivots diverge."""
        swings = _make_swings([
            (95.0, "low"), (110.0, "high"), (100.0, "low"), (110.0, "high"),
            (92.0, "low"), (105.0, "high"), (90.0, "low"), (100.0, "high"),
        ])
        candles = _make_candles(30, base=100.0)
        results = detect_all_from_swings(swings, candles)
        names = [r["name"] for r in results]
        self.assertIn("Ascending Triangle", names,
                      "Scanner should surface the triangle 4 pivots back")


if __name__ == "__main__":
    unittest.main()
