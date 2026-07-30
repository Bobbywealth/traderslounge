"""Tests for §4 additional-indicators institutional module."""
import unittest

from scanner.modules.institutional import additional_indicators


def _analysis(direction: str = "BUY",
              stoch: float = 50.0, cci: float = 0.0,
              st_aligned: bool = True, st_level: float = 100.0,
              ich_aligned: bool = True, ich_a: float = 105.0,
              ich_b: float = 100.0) -> dict:
    return {
        "direction": direction,
        "indicators": {
            "stoch_rsi": stoch,
            "cci": cci,
            "supertrend": {"aligned": st_aligned, "level": st_level},
            "ichimoku": {"aligned": ich_aligned,
                         "span_a": ich_a, "span_b": ich_b,
                         "tenkan": 100.0, "kijun": 100.0},
        },
    }


class TestAdditionalIndicators(unittest.TestCase):
    def test_module_shape(self):
        out = additional_indicators.compute(_analysis())
        self.assertTrue(out["available"])
        for k in ("stoch_rsi", "cci", "supertrend", "ichimoku", "consensus"):
            self.assertIn(k, out)

    def test_stoch_oversold(self):
        out = additional_indicators.compute(_analysis(stoch=15.0))
        self.assertEqual(out["stoch_rsi"]["signal"], "oversold")

    def test_stoch_overbought(self):
        out = additional_indicators.compute(_analysis(stoch=85.0))
        self.assertEqual(out["stoch_rsi"]["signal"], "overbought")

    def test_cci_strong_bullish(self):
        out = additional_indicators.compute(_analysis(cci=150.0))
        self.assertEqual(out["cci"]["signal"], "strong_bullish")

    def test_consensus_when_all_aligned_bullish(self):
        out = additional_indicators.compute(_analysis(
            direction="BUY",
            stoch=15.0, cci=150.0,
            st_aligned=True, ich_aligned=True, ich_a=110.0, ich_b=100.0,
        ))
        self.assertGreaterEqual(out["consensus_bullish_count"], 3)
        self.assertEqual(out["consensus"], "bullish")

    def test_consensus_bearish(self):
        out = additional_indicators.compute(_analysis(
            direction="SELL",
            stoch=85.0, cci=-150.0,
            st_aligned=True, ich_aligned=True, ich_a=100.0, ich_b=110.0,
        ))
        self.assertGreaterEqual(out["consensus_bearish_count"], 3)
        self.assertEqual(out["consensus"], "bearish")


if __name__ == "__main__":
    unittest.main()