from scanner.crypto_analysis import CAPS, analyze_crypto
from scanner.data_types import Candle, MarketSnapshot


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


def test_crypto_analysis_degrades_without_data():
    result = analyze_crypto(MarketSnapshot(pair="ETHUSD"))
    assert result["direction"] == "NEUTRAL"
    assert result["total_score"] == 0
    assert result["data_quality"]["status"] == "insufficient"
    assert "no usable OHLC candles" in result["data_quality"]["issues"]
