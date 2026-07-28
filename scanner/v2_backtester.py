"""Walk-forward replay for the guarded V2 crypto analysis and trade planner."""
from __future__ import annotations

from bisect import bisect_left
from collections import defaultdict
from typing import Any

from .crypto_analysis import analyze_crypto
from .data_types import Candle, MarketSnapshot
from .direction_stability import stabilize_direction
from .trade_planner import build_trade_plan


def _before(candles, timestamp, limit):
    return [c for c in candles if c.time <= timestamp][-limit:]


def _higher_without_lookahead(higher, higher_times, intraday, intraday_times, current_index, bucket_seconds):
    current = intraday[current_index]
    bucket_start = current.time-(current.time % bucket_seconds)
    higher_end = bisect_left(higher_times, bucket_start)
    completed = higher[max(0, higher_end-299):higher_end]
    partial_start = bisect_left(intraday_times, bucket_start, 0, current_index+1)
    partial = intraday[partial_start:current_index+1]
    if partial:
        completed.append(Candle(time=bucket_start, open=partial[0].open, high=max(c.high for c in partial), low=min(c.low for c in partial), close=partial[-1].close, volume=sum(c.volume for c in partial)))
    return completed


def _metrics(trades):
    if not trades:
        return {"trades": 0, "wins": 0, "losses": 0, "win_rate": 0.0, "avg_r": 0.0, "expectancy_r": 0.0, "profit_factor": 0.0}
    wins = [t for t in trades if t["r_multiple"] > 0]
    losses = [t for t in trades if t["r_multiple"] < 0]
    gross_win = sum(t["r_multiple"] for t in wins)
    gross_loss = abs(sum(t["r_multiple"] for t in losses))
    average = sum(t["r_multiple"] for t in trades)/len(trades)
    return {"trades": len(trades), "wins": len(wins), "losses": len(losses), "win_rate": len(wins)/len(trades),
            "avg_r": average, "expectancy_r": average, "profit_factor": gross_win/gross_loss if gross_loss else 0.0}


def _group(trades, key):
    groups = defaultdict(list)
    for trade in trades:
        groups[str(trade.get(key) or "unknown")].append(trade)
    return {name: _metrics(rows) for name, rows in sorted(groups.items())}


def run_v2_backtest(pair, d1, h4, h1, m15, stride=4, maximum_holding_bars=96, minimum_history=250, timeframe="15m", round_trip_cost_bps=24.0) -> dict[str, Any]:
    """Replay V2 without look-ahead and enter only READY, eligible 2R plans."""
    trades, candidates, blocked = [], 0, defaultdict(int)
    direction_states = {}
    d1_times, h4_times, h1_times, selected_times = ([c.time for c in rows] for rows in (d1, h4, h1, m15))
    index = minimum_history
    while index < len(m15)-2:
        current = m15[index]
        snap = MarketSnapshot(pair=pair, d1=_higher_without_lookahead(d1, d1_times, m15, selected_times, index, 86400), h4=_higher_without_lookahead(h4, h4_times, m15, selected_times, index, 14400),
                              h1=_higher_without_lookahead(h1, h1_times, m15, selected_times, index, 3600), m15=m15[max(0, index-300):index+1])
        analysis = analyze_crypto(snap, None, snap.m15, timeframe)
        stability = stabilize_direction(analysis, direction_states, f"{pair}:{timeframe}")
        raw_direction = analysis.get("direction", "NEUTRAL")
        analysis["raw_direction"] = raw_direction
        analysis["direction_stability"] = stability
        analysis["direction"] = stability["confirmed_direction"]
        timing = analysis.get("trade_timing") or {}
        signal_stable = stability["confirmed_direction"] != "NEUTRAL" and stability["confirmed_direction"] == raw_direction and stability["lifecycle"] == "CONFIRMED"
        timing.setdefault("checks", {})["signal_stability"] = signal_stable
        if not signal_stable:
            timing["status"] = "WAIT"
            timing.setdefault("wait_for", []).append("signal stability")
        analysis["trade_timing"] = timing
        plan = build_trade_plan(snap, analysis, {"status": "CLEAR"}, primary_candles=snap.m15)
        if not plan["eligible"]:
            for reason in plan.get("reasons", [])[:1]: blocked[reason] += 1
            index += stride
            continue
        candidates += 1
        next_bar = m15[index+1]
        entry = float(next_bar.open)
        original_entry = float(plan["entry"])
        direction = plan["direction"]
        stop = float(plan["stop"])
        target = float(plan["targets"][1]["price"])
        risk = abs(entry-stop)
        reward = abs(target-entry)
        invalidated_at_open = entry <= stop if direction == "BUY" else entry >= stop
        fill_cost_r = (entry*(round_trip_cost_bps/10000.0))/risk if risk > 0 else float("inf")
        if risk <= 0 or invalidated_at_open or reward/risk-fill_cost_r < 2.0:
            blocked["next-open fill invalidated structure or reduced net reward below 2R"] += 1
            index += stride
            continue
        exit_index = min(len(m15)-1, index+maximum_holding_bars)
        cost_r = fill_cost_r
        outcome, exit_price, r_multiple = "timeout", float(m15[exit_index].close), 0.0
        for cursor in range(index+1, exit_index+1):
            bar = m15[cursor]
            stop_hit = bar.low <= stop if direction == "BUY" else bar.high >= stop
            target_hit = bar.high >= target if direction == "BUY" else bar.low <= target
            if stop_hit:  # conservative when both occur in one candle
                outcome, exit_price, r_multiple, exit_index = "loss", stop, -1.0-cost_r, cursor
                break
            if target_hit:
                outcome, exit_price, r_multiple, exit_index = "win", target, reward/risk-cost_r, cursor
                break
        if outcome == "timeout":
            r_multiple = ((exit_price-entry) if direction == "BUY" else (entry-exit_price))/risk-cost_r
        timing = analysis.get("trade_timing") or {}
        locations = timing.get("location_signals") or ["unknown"]
        confirmations = timing.get("confirmation_signals") or ["unknown"]
        score = int(analysis.get("total_score") or 0)
        trades.append({"entry_time": next_bar.time, "exit_time": m15[exit_index].time, "direction": direction, "entry": entry,
                       "stop": stop, "target_2r": target, "exit": exit_price, "outcome": outcome, "r_multiple": r_multiple,
                       "score": score, "cost_r": cost_r, "score_band": f"{score//10*10}-{score//10*10+9}", "timeframe": timeframe,
                       "session": (timing.get("session") or {}).get("name"), "setup": "+".join(sorted(locations)),
                       "confirmation": "+".join(sorted(confirmations)), "macro_bias": (analysis.get("market_context") or {}).get("macro_bias")})
        index = exit_index+1

    split = int(len(trades)*.7)
    in_sample, out_sample = trades[:split], trades[split:]
    out_sample_metrics = _metrics(out_sample)
    slice_size = max(1, len(trades)//4)
    time_slices = [_metrics(trades[start:start+slice_size]) for start in range(0, len(trades), slice_size)][:4]
    positive_slices = sum(1 for item in time_slices if item["trades"] and item["expectancy_r"] > 0)
    validation = {"status": "INSUFFICIENT_DATA" if len(out_sample) < 30 else "PROMISING" if out_sample_metrics["expectancy_r"] > 0 and out_sample_metrics["profit_factor"] > 1 and positive_slices >= 3 else "REJECT",
                  "minimum_out_of_sample_trades": 30, "observed_out_of_sample_trades": len(out_sample),
                  "positive_time_slices": positive_slices, "required_positive_time_slices": 3,
                  "warning": "Do not optimize or deploy thresholds from a small sample."}
    history_seconds = (m15[-1].time-m15[0].time) if len(m15) > 1 else 0
    return {"version": "2.0.0", "pair": pair, "timeframe": timeframe, "bars": len(m15), "history": {"start": m15[0].time if m15 else None, "end": m15[-1].time if m15 else None, "years": history_seconds/(365.25*86400)}, "candidates": candidates,
            "rules": {"minimum_score": 60, "minimum_rr": 2.0, "entry": "next candle open", "target": "absolute structural TP2", "same_bar_policy": "stop first", "maximum_holding_bars": maximum_holding_bars, "round_trip_cost_bps": round_trip_cost_bps, "scan_stride_bars": stride},
            "overall": _metrics(trades), "in_sample_70pct": _metrics(in_sample), "out_of_sample_30pct": out_sample_metrics, "time_slices": time_slices, "validation": validation,
            "by_setup": _group(trades, "setup"), "by_confirmation": _group(trades, "confirmation"),
            "by_score_band": _group(trades, "score_band"), "by_session": _group(trades, "session"),
            "blocked_reasons": dict(sorted(blocked.items(), key=lambda item: item[1], reverse=True)[:10]), "trades": trades[-100:]}
