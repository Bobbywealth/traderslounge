"""Integration test: analyze_with_institutional end-to-end."""
import unittest

from scanner.data_types import Candle, MarketSnapshot
from scanner.modules.institutional import analyze_with_institutional


def _make_tf(legs, start: float, step_seconds: int) -> list:
    out = []
    price = start
    t = 1_700_000_000
    last = len(legs) - 1
    for li, (length, step) in enumerate(legs):
        for j in range(length):
            o, c = price, price + step
            hi = max(o, c) + 0.3
            lo = min(o, c) - 0.3
            if j == length - 1 and li < last:
                if step > 0:
                    hi += abs(step) * 2
                else:
                    lo -= abs(step) * 2
            out.append(Candle(t, o, hi, lo, c))
            price = c
            t += step_seconds
    return out


def _bullish_snapshot() -> MarketSnapshot:
    legs = [(20, +1.0), (8, -0.5), (25, +1.0), (8, -0.5), (25, +1.0),
            (8, -0.5), (20, +1.0)]
    return MarketSnapshot(
        pair="BTCUSDT",
        d1=_make_tf(legs, 100.0, 86400),
        h4=_make_tf(legs, 100.0, 14400),
        h1=_make_tf(legs, 100.0, 3600),
        m15=_make_tf([(15, +1.0), (5, -0.5), (20, +1.0), (5, -0.5), (15, +1.0)],
                     100.0, 900),
    )


class TestAnalyzeWithInstitutional(unittest.TestCase):
    def test_wrapper_preserves_canonical_fields(self):
        result = analyze_with_institutional(_bullish_snapshot(),
                                            calendar_state="CLEAR")
        # The canonical analyzer's top-level fields must still be present.
        for key in ("direction", "total_score", "data_quality", "indicators"):
            self.assertIn(key, result)
        # The institutional block must be attached.
        self.assertIn("institutional", result)
        self.assertIn("market_structure_mtf", result["institutional"])

    def test_wrapper_no_mutation(self):
        snap = _bullish_snapshot()
        first = analyze_with_institutional(snap, calendar_state="CLEAR")
        # Calling again must produce an equivalent result (no shared state).
        second = analyze_with_institutional(snap, calendar_state="CLEAR")
        self.assertEqual(first["direction"], second["direction"])
        self.assertEqual(first["total_score"], second["total_score"])

    def test_institutional_disclaimer_is_at_top_level(self):
        result = analyze_with_institutional(_bullish_snapshot(),
                                            calendar_state="CLEAR")
        inst = result["institutional"]
        self.assertIn("schema_disclaimer", inst)
        self.assertIn("version", inst)


if __name__ == "__main__":
    unittest.main()