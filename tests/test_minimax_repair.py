"""Validates the truncated-JSON repair in scanner.minimax_client._extract_json.

Simulates the live failure mode (MiniMax vision hits the token limit and cuts
off mid risk_factors with no closing arrays/root) and confirms the repair
recovers the complete structured data instead of raising RuntimeError.
"""
import sys
sys.path.insert(0, '/Users/bobbyc/.aside/u/0/sessions/2026-07-30_Vw1NReYaNrgbsS8f/tmp/tl')

from scanner.minimax_client import _extract_json, _repair_truncated_json


def test_truncated_fenced():
    payload = (
        '```json\n'
        '{\n'
        '  "summary": "BTCUSD 1h pressing R1 pivot at resistance. NEUTRAL, score 54.",\n'
        '  "visual_bias": "neutral",\n'
        '  "confidence": 0.45,\n'
        '  "visible_patterns": ["Bearish Gartley PRZ", "HH/HL microstructure"],\n'
        '  "key_levels": [\n'
        '    {"label": "R1 Pivot", "price": 65066.35, "reason": "Immediate resistance"},\n'
        '    {"label": "ADR High", "price": 64824.07, "reason": "Range ceiling"},\n'
        '    {"label": "Gartley PRZ", "price": 64411.76, "reason": "Harmonic zone"}\n'
        '  ],\n'
        '  "confirmations": ["1h bullish HL/HH", "VWAP reclaim"],\n'
        '  "conflicts": ["V2 neutral despite bullish", "ADR exhausted"],\n'
        '  "risk_factors": ["ADR exhausted", "HTF conflict", "Score below 60", "Entry extended, spread sl'
    )
    r = _extract_json(payload)
    assert r["visual_bias"] == "neutral"
    assert len(r["key_levels"]) == 3
    assert r["key_levels"][2]["price"] == 64411.76
    assert r["confirmations"] == ["1h bullish HL/HH", "VWAP reclaim"]
    assert r["conflicts"] == ["V2 neutral despite bullish", "ADR exhausted"]
    # The first three complete risk_factors survive; the truncated 4th is dropped.
    assert r["risk_factors"][:3] == ["ADR exhausted", "HTF conflict", "Score below 60"]
    print("test_truncated_fenced PASS")


def test_complete_with_trailing_prose():
    payload = '{"summary":"ok","confidence":0.5}  MiniMax is confident.'
    r = _extract_json(payload)
    assert r["summary"] == "ok" and r["confidence"] == 0.5
    print("test_complete_with_trailing_prose PASS")


def test_think_tags():
    payload = '<think>reasoning</think>{"summary":"after think","visual_bias":"bullish"}'
    r = _extract_json(payload)
    assert r["summary"] == "after think" and r["visual_bias"] == "bullish"
    print("test_think_tags PASS")


def test_well_formed_json():
    payload = '{"summary":"clean","visual_bias":"bearish","confidence":0.8,"key_levels":[]}'
    r = _extract_json(payload)
    assert r["visual_bias"] == "bearish"
    print("test_well_formed_json PASS")


if __name__ == "__main__":
    test_truncated_fenced()
    test_complete_with_trailing_prose()
    test_think_tags()
    test_well_formed_json()
    print("\nALL PASS — truncated-JSON repair is working.")