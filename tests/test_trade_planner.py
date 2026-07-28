from scanner.data_types import Candle, MarketSnapshot
from scanner.trade_planner import build_trade_plan


def series(count, start=100.0, step=0.5, seconds=900):
    rows = []
    price = start
    for index in range(count):
        open_price = price
        price += step
        rows.append(Candle(time=1_700_000_000 + index * seconds, open=open_price, high=price + 0.4, low=open_price - 0.4, close=price, volume=1000))
    return rows


def analysis(direction="BUY", score=65):
    return {
        "direction": direction,
        "total_score": score,
        "data_quality": {"status": "good"},
        "zones": {
            "support": [112.0], "resistance": [140.0, 150.0],
            "order_blocks": [], "fair_value_gaps": [],
            "volume_profile_summary": {"poc": 130.0},
        },
    }


def test_trade_plan_builds_directional_targets():
    snapshot = MarketSnapshot(pair="BTCUSD", d1=series(40, 90, 2, 86400), m15=series(50, 100, 0.5))
    plan = build_trade_plan(snapshot, analysis(), {"status": "CLEAR"})
    assert plan["stop"] < plan["entry"]
    assert all(target["price"] > plan["entry"] for target in plan["targets"])
    assert plan["available_rr"] >= 0
    assert plan["calendar_status"] == "CLEAR"


def test_trade_plan_blocks_on_calendar():
    snapshot = MarketSnapshot(pair="BTCUSD", d1=series(40, 90, 2, 86400), m15=series(50, 100, 0.5))
    plan = build_trade_plan(snapshot, analysis(), {"status": "BLOCKED"})
    assert plan["eligible"] is False
    assert plan["status"] == "BLOCKED"
    assert plan["account_risk_percent"] == 0
