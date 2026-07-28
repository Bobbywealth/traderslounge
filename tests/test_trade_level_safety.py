from scanner.data_types import Candle, Direction, MarketSnapshot, ModuleResult
from scanner.scoring_engine import _build_trade_levels


def result(name, details):
    return ModuleResult(name=name, points=0, max_points=0, details=details)


def snapshot(entry=100.0):
    candle = Candle(time=1, open=entry, high=entry + 1, low=entry - 1, close=entry, volume=1)
    return MarketSnapshot(pair="BTCUSD", m15=[candle])


def test_sell_targets_are_always_below_entry():
    levels = _build_trade_levels(
        snapshot(), Direction.SELL,
        result("fib", {"swing_low": 101, "swing_high": 105, "levels": {"1.272": 104, "1.618": 103}}),
        result("adr", {"adr_low": 102}),
        result("liquidity", {"swept_high": 105}),
    )
    entry, stop, tp1, tp2, tp3 = levels
    assert stop > entry > tp1 > tp2 > tp3


def test_buy_targets_are_always_above_entry():
    levels = _build_trade_levels(
        snapshot(), Direction.BUY,
        result("fib", {"swing_low": 95, "swing_high": 99, "levels": {"1.272": 96, "1.618": 97}}),
        result("adr", {"adr_high": 98}),
        result("liquidity", {"swept_low": 95}),
    )
    entry, stop, tp1, tp2, tp3 = levels
    assert stop < entry < tp1 < tp2 < tp3
