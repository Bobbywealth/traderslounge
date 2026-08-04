from scanner.crypto_analysis import CAPS, analyze_crypto, _build_setup_zones
from scanner.data_types import Candle, MarketSnapshot
from tests.fixtures import zigzag


def candles(count: int, start: float = 100.0, drift: float = 0.4):
    rows = []
    price = start
    for index in range(count):
        open_price = price
        price += drift + (0.6 if index % 6 < 3 else -0.2)
        rows.append(Candle(
            time=1_700_000_000 + index * 900,
            open=open_price,
            high=max(open_price, price) + 0.5,
            low=min(open_price, price) - 0.5,
            close=price,
            volume=1000 + index * 3,
        ))
    return rows


def test_crypto_analysis_is_capped_and_structured():
    snap = MarketSnapshot(
        pair="BTCUSD", d1=candles(250), h4=candles(250),
        h1=candles(250), m15=candles(250),
    )
    result = analyze_crypto(snap)
    assert result["asset_class"] == "crypto"
    assert result["pair"] == "BTCUSD"
    assert set(result["category_breakdown"]) == set(CAPS)
    assert all(0 <= result["category_breakdown"][key] <= cap for key, cap in CAPS.items())
    assert result["total_score"] == sum(result["category_breakdown"].values())
    assert 0 <= result["total_score"] <= 100
    assert result["data_quality"]["status"] == "good"
    institutional = result["institutional_analysis"]
    assert institutional["methodology"] == "deterministic_ohlcv_phase_1"
    assert set(institutional["market_structure"]["timeframes"]) == {"mn1", "w1", "d1", "h4", "h1", "selected"}
    assert institutional["elliott_wave"]["confidence"] in {"low", "medium"}
    assert "detected" in institutional["abcd_pattern"]
    assert institutional["volatility_detail"]["historical_volatility_annualized_pct"] is not None


def test_crypto_analysis_degrades_without_data():
    result = analyze_crypto(MarketSnapshot(pair="ETHUSD"))
    assert result["direction"] == "NEUTRAL"
    assert result["total_score"] == 0
    assert result["data_quality"]["status"] == "insufficient"
    assert "no usable OHLC candles" in result["data_quality"]["issues"]
    assert result["institutional_analysis"]["elliott_wave"]["confidence"] == "low"


def test_fibonacci_uses_latest_reference_price_but_completed_swing_structure():
    primary = candles(250, start=100.0, drift=0.4)
    last = primary[-1]
    live_close = last.close + 20
    primary.append(Candle(
        time=last.time + 900,
        open=last.close,
        high=live_close + 1,
        low=last.close - 1,
        close=live_close,
        volume=last.volume,
    ))
    snap = MarketSnapshot(pair="BTCUSD", d1=candles(250), h4=candles(250), h1=primary, m15=primary)

    result = analyze_crypto(snap, primary_candles=primary, primary_timeframe="15m")

    assert result["data_quality"]["reference_price"] == live_close
    assert result["data_quality"]["reference_price_time"] == last.time + 900
    assert result["data_quality"]["closed_bar_time"] == last.time


def test_fibonacci_levels_include_true_golden_pocket_and_actionable_ratios():
    bars = zigzag([(80, 1.0), (80, -1.2), (80, 0.8)], 100.0, step_seconds=900)
    snap = MarketSnapshot(pair="BTCUSD", d1=bars, h4=bars, h1=bars, m15=bars)
    result = analyze_crypto(snap)
    fib = result["zones"]["fibonacci"]
    levels = fib["levels"]

    for ratio in ("0", "0.236", "0.382", "0.5", "0.618", "0.65", "0.705", "0.786", "0.886", "1"):
        assert ratio in levels
    assert fib["golden_pocket"]["low"] == min(levels["0.618"], levels["0.65"])
    assert fib["golden_pocket"]["high"] == max(levels["0.618"], levels["0.65"])
    assert fib["swing_start_price"] is not None
    assert fib["swing_end_price"] is not None
    assert "selection_reason" in fib
    assert isinstance(fib.get("higher_timeframes"), list)
    assert isinstance(fib.get("clusters"), list)
    assert "context" in fib


def test_setup_zone_score_is_visible_even_when_not_actionable():
    zones = _build_setup_zones(
        price=100,
        atr_value=10,
        zones={"fibonacci": {"levels": {"0.236": 101}}, "fair_value_gaps": [{"type": "bearish", "low": 99, "high": 102}]},
        indicators={},
        direction="SELL",
        market_context={"macro_bias": "bearish"},
        trade_timing={"status": "WAIT", "checks": {"score_60": False}},
    )

    sell_zone = next(zone for zone in zones if zone["direction"] == "SELL")
    assert sell_zone["score"] is not None
    assert sell_zone["score"] >= 50
    assert sell_zone["actionable"] is False
