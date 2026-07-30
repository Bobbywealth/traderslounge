"""Tests for §2 Volume institutional module."""
import unittest

from scanner.modules.institutional import volume


def _analysis(direction: str = "BUY", rvol: float = 1.2, vwap: float = 100.0,
              obv: float = 5000.0) -> dict:
    return {
        "direction": direction,
        "indicators": {"relative_volume": rvol, "vwap": vwap, "obv": obv},
        "current_price": 105.0,
    }


class TestVolume(unittest.TestCase):
    def test_module_shape(self):
        out = volume.compute(_analysis())
        self.assertTrue(out["available"])
        self.assertEqual(out["kind"], "measured")
        for k in ("relative_volume", "vwap", "obv", "regime", "consensus",
                  "current_price_above_vwap"):
            self.assertIn(k, out)

    def test_regime_high(self):
        out = volume.compute(_analysis(rvol=2.0))
        self.assertEqual(out["regime"], "high")

    def test_regime_low(self):
        out = volume.compute(_analysis(rvol=0.4))
        self.assertEqual(out["regime"], "low")

    def test_consensus_confirms_when_high_volume(self):
        out = volume.compute(_analysis(direction="BUY", rvol=1.8))
        self.assertEqual(out["consensus"], "confirms")

    def test_consensus_unavailable_when_no_rvol(self):
        out = volume.compute({"direction": "BUY",
                              "indicators": {},
                              "current_price": 100.0})
        self.assertEqual(out["consensus"], "unavailable")


if __name__ == "__main__":
    unittest.main()