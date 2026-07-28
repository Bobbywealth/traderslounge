"""Stateful confirmation and hysteresis for V2 market direction."""
from __future__ import annotations


def stabilize_direction(analysis, state_store, key, required_closes=2, cooldown_bars=3, reversal_margin=12):
    raw_direction = str(analysis.get("direction") or "NEUTRAL")
    score = int(analysis.get("total_score") or 0)
    strength = float((analysis.get("indicators") or {}).get("directional_strength") or 0)
    bar_time = (analysis.get("data_quality") or {}).get("closed_bar_time")
    selected_trend = (((analysis.get("market_context") or {}).get("timeframes") or {}).get("selected") or {}).get("trend", "neutral")
    expected_trend = "bullish" if raw_direction == "BUY" else "bearish" if raw_direction == "SELL" else "neutral"
    structural_reversal = raw_direction != "NEUTRAL" and selected_trend == expected_trend and int((analysis.get("category_breakdown") or {}).get("structure") or 0) >= 16

    state = state_store.setdefault(key, {
        "confirmed_direction": "NEUTRAL", "confirmed_score": 0, "candidate_direction": "NEUTRAL",
        "candidate_closes": 0, "bars_since_change": cooldown_bars, "last_bar_time": None,
        "lifecycle": "FORMING", "last_change_time": None,
    })
    if bar_time == state.get("last_bar_time"):
        return _result(state, raw_direction, score, strength, required_closes, cooldown_bars, reversal_margin, structural_reversal, "same completed candle; state unchanged")

    state["last_bar_time"] = bar_time
    state["bars_since_change"] = int(state.get("bars_since_change") or 0)+1
    confirmed = state["confirmed_direction"]
    reason = ""

    if raw_direction == "NEUTRAL":
        state["candidate_direction"] = "NEUTRAL"; state["candidate_closes"] = 0
        state["lifecycle"] = "WEAKENING" if confirmed != "NEUTRAL" else "FORMING"
        reason = "closed candle has no directional confirmation"
    elif confirmed == "NEUTRAL":
        if state["candidate_direction"] == raw_direction: state["candidate_closes"] += 1
        else: state["candidate_direction"], state["candidate_closes"] = raw_direction, 1
        if state["candidate_closes"] >= required_closes and score >= 60:
            _confirm(state, raw_direction, score, bar_time); reason = f"{required_closes} completed candles confirmed initial direction"
        else:
            state["lifecycle"] = "FORMING"; reason = f"forming {raw_direction}: {state['candidate_closes']}/{required_closes} completed closes"
    elif raw_direction == confirmed:
        state["confirmed_score"] = score
        state["candidate_direction"], state["candidate_closes"] = "NEUTRAL", 0
        state["lifecycle"] = "CONFIRMED"; reason = "completed candle supports confirmed direction"
    else:
        state["confirmed_score"] = max(40, int(state.get("confirmed_score") or 0)-5)
        if state["candidate_direction"] == raw_direction: state["candidate_closes"] += 1
        else: state["candidate_direction"], state["candidate_closes"] = raw_direction, 1
        margin_met = score >= max(60, int(state["confirmed_score"])+reversal_margin)
        cooldown_met = state["bars_since_change"] >= cooldown_bars
        if state["candidate_closes"] >= required_closes and margin_met and (cooldown_met or structural_reversal):
            _confirm(state, raw_direction, score, bar_time); reason = "opposing closes, reversal margin, and structure confirmed"
        else:
            state["lifecycle"] = "INVALIDATED" if structural_reversal else "WEAKENING"
            missing = []
            if state["candidate_closes"] < required_closes: missing.append(f"{required_closes-state['candidate_closes']} confirming close")
            if not margin_met: missing.append(f"{reversal_margin}-point hysteresis margin")
            if not cooldown_met and not structural_reversal: missing.append(f"{cooldown_bars-state['bars_since_change']} cooldown bar")
            reason = "opposing direction detected; waiting for " + ", ".join(missing or ["confirmation"])
    return _result(state, raw_direction, score, strength, required_closes, cooldown_bars, reversal_margin, structural_reversal, reason)


def _confirm(state, direction, score, bar_time):
    state.update({"confirmed_direction": direction, "confirmed_score": score, "candidate_direction": "NEUTRAL", "candidate_closes": 0,
                  "bars_since_change": 0, "last_change_time": bar_time, "lifecycle": "CONFIRMED"})


def _result(state, raw_direction, score, strength, required_closes, cooldown_bars, reversal_margin, structural_reversal, reason):
    return {"raw_direction": raw_direction, "confirmed_direction": state["confirmed_direction"], "lifecycle": state["lifecycle"],
            "candidate_direction": state["candidate_direction"], "candidate_closes": state["candidate_closes"],
            "required_closes": required_closes, "cooldown_bars": cooldown_bars, "bars_since_change": state["bars_since_change"],
            "reversal_margin": reversal_margin, "raw_score": score, "confirmed_score": state["confirmed_score"],
            "directional_strength": strength, "structural_reversal": structural_reversal,
            "last_closed_bar_time": state["last_bar_time"], "last_change_time": state["last_change_time"], "reason": reason}
