"""Walk-forward replay for the guarded V2 crypto analysis and trade planner."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from .crypto_analysis import analyze_crypto
from .data_types import MarketSnapshot
from .trade_planner import build_trade_plan


def _before(candles, timestamp, limit):
    return [c for c in candles if c.time <= timestamp][-limit:]


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


def run_v2_backtest(pair, d1, h4, h1, m15, stride=4, maximum_holding_bars=96, minimum_history=250, timeframe="15m") -> dict[str, Any]:
    """Replay V2 without look-ahead and enter only READY, eligible 2R plans."""
    trades, candidates, blocked = [], 0, defaultdict(int)
    index = minimum_history
    while index < len(m15)-2:
        current = m15[index]
        snap = MarketSnapshot(pair=pair, d1=_before(d1, current.time, 300), h4=_before(h4, current.time, 300),
                              h1=_before(h1, current.time, 300), m15=m15[max(0, index-300):index+1])
        analysis = analyze_crypto(snap, None, snap.m15, timeframe)
        plan = build_trade_plan(snap, analysis, {"status": "CLEAR"})
        if not plan["eligible"]:
            for reason in plan.get("reasons", [])[:1]: blocked[reason] += 1
            index += stride
            continue
        candidates += 1
        next_bar = m15[index+1]
        entry = float(next_bar.open)
        original_entry = float(plan["entry"])
        risk = abs(original_entry-float(plan["stop"]))
        if risk <= 0:
            index += stride
            continue
        direction = plan["direction"]
        stop = entry-risk if direction == "BUY" else entry+risk
        target = entry+2*risk if direction == "BUY" else entry-2*risk
        exit_index = min(len(m15)-1, index+maximum_holding_bars)
        outcome, exit_price, r_multiple = "timeout", float(m15[exit_index].close), 0.0
        for cursor in range(index+1, exit_index+1):
            bar = m15[cursor]
            stop_hit = bar.low <= stop if direction == "BUY" else bar.high >= stop
            target_hit = bar.high >= target if direction == "BUY" else bar.low <= target
            if stop_hit:  # conservative when both occur in one candle
                outcome, exit_price, r_multiple, exit_index = "loss", stop, -1.0, cursor
                break
            if target_hit:
                outcome, exit_price, r_multiple, exit_index = "win", target, 2.0, cursor
                break
        if outcome == "timeout":
            r_multiple = ((exit_price-entry) if direction == "BUY" else (entry-exit_price))/risk
        timing = analysis.get("trade_timing") or {}
        locations = timing.get("location_signals") or ["unknown"]
        confirmations = timing.get("confirmation_signals") or ["unknown"]
        score = int(analysis.get("total_score") or 0)
        trades.append({"entry_time": next_bar.time, "exit_time": m15[exit_index].time, "direction": direction, "entry": entry,
                       "stop": stop, "target_2r": target, "exit": exit_price, "outcome": outcome, "r_multiple": r_multiple,
                       "score": score, "score_band": f"{score//10*10}-{score//10*10+9}", "timeframe": timeframe,
                       "session": (timing.get("session") or {}).get("name"), "setup": "+".join(sorted(locations)),
                       "confirmation": "+".join(sorted(confirmations)), "macro_bias": (analysis.get("market_context") or {}).get("macro_bias")})
        index = exit_index+1

    split = int(len(trades)*.7)
    in_sample, out_sample = trades[:split], trades[split:]
    out_sample_metrics = _metrics(out_sample)
    validation = {"status": "INSUFFICIENT_DATA" if len(out_sample) < 30 else "PROMISING" if out_sample_metrics["expectancy_r"] > 0 and out_sample_metrics["profit_factor"] > 1 else "REJECT",
                  "minimum_out_of_sample_trades": 30, "observed_out_of_sample_trades": len(out_sample),
                  "warning": "Do not optimize or deploy thresholds from a small sample."}
    return {"version": "2.0.0", "pair": pair, "timeframe": timeframe, "bars": len(m15), "candidates": candidates,
            "rules": {"minimum_score": 60, "minimum_rr": 2.0, "entry": "next candle open", "target": "TP2 at 2R", "same_bar_policy": "stop first", "maximum_holding_bars": maximum_holding_bars},
            "overall": _metrics(trades), "in_sample_70pct": _metrics(in_sample), "out_of_sample_30pct": out_sample_metrics, "validation": validation,
            "by_setup": _group(trades, "setup"), "by_confirmation": _group(trades, "confirmation"),
            "by_score_band": _group(trades, "score_band"), "by_session": _group(trades, "session"),
            "blocked_reasons": dict(sorted(blocked.items(), key=lambda item: item[1], reverse=True)[:10]), "trades": trades[-100:]}
