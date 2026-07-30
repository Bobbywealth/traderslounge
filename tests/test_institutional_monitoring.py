"""Tests for the monitoring consolidation module."""
import unittest

from scanner.data_types import Candle, MarketSnapshot
from scanner.modules.institutional import monitoring as mon_mod


def _make_candles(n: int) -> list:
    out = []
    price = 100.0
    for i in range(n):
        out.append(Candle(
            1_700_000_000 + i * 900,
            price, price + 0.5, price - 0.5, price + 0.2,
            volume=100 + i,
        ))
        price += 0.2
    return out


def _buy_analysis() -> dict:
    return {
        "direction": "BUY",
        "current_price": 110.0,
        "trade_plan": {"entry": 100.0, "stop": 95.0, "tp1": 110.0, "tp2": 115.0},
    }


class TestMonitoring(unittest.TestCase):
    def test_invalidation_alert_present(self):
        result = mon_mod.compute(
            _buy_analysis(),
            MarketSnapshot(pair="X", m15=_make_candles(30)),
            sections={},
            calendar_state="CLEAR",
        )
        self.assertTrue(result["available"])
        names = [a["name"] for a in result["alerts"]]
        self.assertIn("trade_invalidation", names)
        self.assertIn("volume_confirmation", names)

    def test_calendar_alert_present_when_blocked(self):
        result = mon_mod.compute(
            _buy_analysis(),
            MarketSnapshot(pair="X", m15=_make_candles(30)),
            sections={},
            calendar_state="BLOCKED",
        )
        names = [a["name"] for a in result["alerts"]]
        self.assertIn("calendar_state", names)
        cal = next(a for a in result["alerts"] if a["name"] == "calendar_state")
        self.assertEqual(cal["state"], "BLOCKED")
        self.assertTrue(cal["completed"])

    def test_htf_conflict_alert_present(self):
        sections = {
            "market_structure_mtf": {
                "available": True,
                "composite": {"trend": "conflict", "conflicting_tfs": ["D1", "H1"]},
            },
        }
        result = mon_mod.compute(
            _buy_analysis(),
            MarketSnapshot(pair="X", m15=_make_candles(30)),
            sections=sections,
            calendar_state="CLEAR",
        )
        names = [a["name"] for a in result["alerts"]]
        self.assertIn("htf_conflict", names)

    def test_risk_rating_alert_when_elevated(self):
        sections = {
            "risk_rating": {"available": True, "rating": 9, "label": "high"},
        }
        result = mon_mod.compute(
            _buy_analysis(),
            MarketSnapshot(pair="X", m15=_make_candles(30)),
            sections=sections,
            calendar_state="CLEAR",
        )
        names = [a["name"] for a in result["alerts"]]
        self.assertIn("risk_rating_elevated", names)


if __name__ == "__main__":
    unittest.main()