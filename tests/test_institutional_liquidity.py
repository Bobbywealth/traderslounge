"""Tests for §3 Liquidity institutional module."""
import unittest

from scanner.modules.institutional import liquidity_institutional


def _analysis(price: float = 100.0,
              fvgs=None, obs=None, pools=None, profile=None) -> dict:
    return {
        "current_price": price,
        "zones": {
            "fair_value_gaps": fvgs or [],
            "order_blocks": obs or [],
            "liquidity_pools": pools or {},
            "volume_profile": profile or [],
        },
    }


class TestLiquidityInstitutional(unittest.TestCase):
    def test_empty_zones(self):
        out = liquidity_institutional.compute(_analysis())
        self.assertTrue(out["available"])
        self.assertEqual(out["fair_value_gaps"], [])
        self.assertEqual(out["order_blocks"], [])
        self.assertEqual(out["equal_highs"], [])

    def test_fvg_state_classification(self):
        fvgs = [
            {"type": "bullish", "low": 95.0, "high": 97.0, "time": 1},
            {"type": "bearish", "low": 110.0, "high": 112.0, "time": 2},
            {"type": "bullish", "low": 100.0, "high": 102.0, "time": 3},
        ]
        out = liquidity_institutional.compute(_analysis(price=101.0, fvgs=fvgs))
        self.assertEqual(len(out["fair_value_gaps"]), 3)
        # gap 1: price 101 > high 97 → exhausted (price has crossed through)
        self.assertEqual(out["fair_value_gaps"][0]["state"], "exhausted")
        # gap 2: price 101 < low 110 → fresh (price has not touched it)
        self.assertEqual(out["fair_value_gaps"][1]["state"], "fresh")
        # gap 3: 100 ≤ 101 ≤ 102 → inside (price is currently in the gap)
        self.assertEqual(out["fair_value_gaps"][2]["state"], "inside")

    def test_ob_state_classification(self):
        obs = [
            {"type": "bullish", "low": 95.0, "high": 97.0, "time": 1},
            {"type": "bearish", "low": 110.0, "high": 112.0, "time": 2},
        ]
        out = liquidity_institutional.compute(_analysis(price=100.0, obs=obs))
        # block 1: high=97 < price=100 → above_price
        self.assertEqual(out["order_blocks"][0]["state"], "above_price")
        # block 2: low=110 > price=100 → below_price
        self.assertEqual(out["order_blocks"][1]["state"], "below_price")

    def test_pools_surfaced(self):
        pools = {"equal_highs": [{"level": 110.0}], "equal_lows": [{"level": 90.0}]}
        out = liquidity_institutional.compute(_analysis(pools=pools))
        self.assertEqual(out["equal_highs"], [{"level": 110.0}])
        self.assertEqual(out["equal_lows"], [{"level": 90.0}])


if __name__ == "__main__":
    unittest.main()