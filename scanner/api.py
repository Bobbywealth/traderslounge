"""HTTP API — stdlib `http.server`, no external deps.

Exposes JSON endpoints over the SignalRepository:

  GET  /api/health              → { status: "ok", db_signals: N, pairs: [...] }
  GET  /api/signals?limit=50&pair=XAUUSD&tier=STRONG
                                → { signals: [ ... ] }
  GET  /api/signals/<id>        → { signal: { ... } }
  GET  /api/pairs               → { pairs: [...] }
  GET  /api/config              → public-safe config (thresholds, pair list)

Designed so the React dashboard can hit it directly. CORS is permissive
for now; tighten in Step 5+ once we add auth.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import parse_qs, urlsplit

from .config import Config
from .crypto_analysis import analyze_crypto
from .kill_switch import KillSwitch
from .minimax_client import analyze as minimax_analyze, configured as minimax_configured
from .news_filter import NewsFilter
from .persistence import SignalRepository
from .trade_planner import build_trade_plan
from .v2_backtester import run_v2_backtest
from .trade_repo import ClosedTradeRepository, PositionRepository

log = logging.getLogger(__name__)


@dataclass
class ApiState:
    """Container so the handler class can find runtime deps."""
    repository: SignalRepository
    config: Config
    position_repo: Optional[PositionRepository] = None
    closed_trade_repo: Optional[ClosedTradeRepository] = None
    kill_switch: Optional[KillSwitch] = None
    scan_request_path: Optional[str] = None  # path to scan trigger file
    market_client: Optional[Any] = None  # fetch_candles(pair, timeframe)
    news_filter: Optional[NewsFilter] = None


# Module-level state pointer — http.server's handler API doesn't make
# passing state in clean. Set via make_server() before the server runs.
_STATE: Optional[ApiState] = None


def set_state(state: ApiState) -> None:
    global _STATE
    _STATE = state


class _ApiHandler(BaseHTTPRequestHandler):
    server_version = "bwts-api/0.1"

    # --- helpers --------------------------------------------------------

    def _json(self, status: int, body: dict | list) -> None:
        payload = json.dumps(body, default=_json_default).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, status: int, message: str) -> None:
        self._json(status, {"error": message})

    def log_message(self, fmt, *args):  # noqa: N802
        log.info("%s - %s", self.address_string(), fmt % args)

    # --- HTTP verbs -----------------------------------------------------

    def do_OPTIONS(self):  # noqa: N802 — required name
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_POST(self):  # noqa: N802
        if _STATE is None:
            return self._error(503, "API state not initialized")
        url = urlsplit(self.path)
        path = url.path.rstrip("/") or "/"
        body = self._read_body()
        try:
            return self._route_post(path, body)
        except Exception as exc:
            log.exception("api error (POST)")
            return self._error(500, str(exc))

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        try:
            raw = self.rfile.read(length).decode("utf-8")
            return json.loads(raw) if raw else {}
        except (ValueError, json.JSONDecodeError):
            return {}

    def do_GET(self):  # noqa: N802
        if _STATE is None:
            return self._error(503, "API state not initialized")
        url = urlsplit(self.path)
        path = url.path.rstrip("/") or "/"
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            return self._route(path, query)
        except Exception as exc:  # last-resort
            log.exception("api error")
            return self._error(500, str(exc))

    # --- routing --------------------------------------------------------

    def _route(self, path: str, query: dict) -> None:
        if path == "/api/health":
            return self._health()
        if path == "/api/pairs":
            return self._json(200, {"pairs": list(_STATE.config.pairs)})
        if path == "/api/config":
            return self._public_config()
        if path == "/api/calendar/events":
            return self._calendar_events(query)
        if path == "/api/calendar/status":
            return self._calendar_status(query)
        if path == "/api/ai/status":
            return self._json(200, {"configured": minimax_configured()})
        if path == "/api/analysis":
            return self._analysis(query)
        if path == "/api/backtest/v2":
            return self._backtest_v2(query)
        if path == "/api/candles":
            return self._candles(query)
        if path == "/api/harmonics":
            return self._harmonics(query)
        if path == "/api/adr":
            return self._adr(query)
        if path == "/api/signals":
            return self._list_signals(query)
        if path.startswith("/api/signals/"):
            try:
                sig_id = int(path.rsplit("/", 1)[1])
            except ValueError:
                return self._error(400, "invalid signal id")
            return self._get_signal(sig_id)
        if path == "/api/positions":
            return self._list_positions()
        if path == "/api/journal":
            return self._list_journal(query)
        if path == "/api/journal/stats":
            return self._journal_stats()
        if path == "/api/kill-switch":
            return self._kill_status()
        return self._error(404, f"unknown route: {path}")

    def _route_post(self, path: str, body: dict) -> None:
        if path == "/api/kill-switch":
            return self._kill_set(body)
        if path == "/api/scans/refresh":
            return self._request_scan(body)
        if path == "/api/ai/analyze":
            return self._ai_analyze(body)
        return self._error(404, f"unknown route: {path}")

    # --- handlers -------------------------------------------------------

    def _health(self) -> None:
        try:
            n = _count(_STATE.repository)
        except Exception as exc:  # pragma: no cover
            return self._json(500, {"status": "degraded", "error": str(exc)})
        self._json(200, {
            "status": "ok",
            "db_signals": n,
            "pairs": list(_STATE.config.pairs),
        })

    def _calendar_events(self, query: dict) -> None:
        news = _STATE.news_filter
        if news is None:
            return self._error(503, "economic calendar is not configured")
        pair = str(query.get("pair") or "").upper()
        events = news.relevant_events(pair) if pair else sorted(news.events, key=lambda event: event.when)
        self._json(200, {
            "source": "forexfactory", "source_health": news.source_health,
            "source_fetched_at": news.source_fetched_at,
            "events": [dict(event.public(), pair=event.pair) for event in events],
            "count": len(events),
        })

    def _calendar_status(self, query: dict) -> None:
        news = _STATE.news_filter
        if news is None:
            return self._error(503, "economic calendar is not configured")
        pair = str(query.get("pair") or query.get("symbol") or "").upper()
        if not pair:
            return self._error(400, "pair is required")
        self._json(200, news.evaluate(pair))

    def _ai_analyze(self, body: dict) -> None:
        pair = str(body.get("pair") or body.get("symbol") or "").upper()[:20]
        if not pair:
            return self._error(400, "pair is required")
        news = _STATE.news_filter
        calendar = news.evaluate(pair) if news else {"status": "UNAVAILABLE", "reason_code": "SOURCE_UNAVAILABLE"}
        raw_signal = body.get("signal") if isinstance(body.get("signal"), dict) else {}
        allowed = ("direction", "tier", "confidence_score", "entry", "stop_loss", "tp1", "tp2", "tp3", "risk_level", "session", "adr_status", "htf_bias", "pattern", "reasons")
        signal = {key: raw_signal.get(key) for key in allowed if key in raw_signal}
        raw_analysis = body.get("analysis") if isinstance(body.get("analysis"), dict) else None
        context = {"pair": pair, "signal": signal, "economic_calendar": calendar}
        if raw_analysis:
            indicators = raw_analysis.get("indicators") if isinstance(raw_analysis.get("indicators"), dict) else {}
            zones = raw_analysis.get("zones") if isinstance(raw_analysis.get("zones"), dict) else {}
            indicator_keys = ("rsi", "macd", "macd_signal", "adx", "stoch_rsi", "cci", "relative_volume", "vwap", "ema_stack_aligned", "sma_stack_aligned", "golden_cross", "death_cross", "patterns", "harmonic", "atr", "compression", "relative_return", "benchmark_correlation")
            context["crypto_analysis"] = {
                "version": raw_analysis.get("version"),
                "direction": raw_analysis.get("direction"),
                "total_score": raw_analysis.get("total_score"),
                "category_breakdown": raw_analysis.get("category_breakdown"),
                "data_quality": raw_analysis.get("data_quality"),
                "indicators": {key: indicators.get(key) for key in indicator_keys if key in indicators},
                "zones": {key: zones.get(key) for key in ("support", "resistance", "fair_value_gaps", "order_blocks", "fibonacci", "volume_profile_summary") if key in zones},
                "scenarios": raw_analysis.get("scenarios"),
                "risk": raw_analysis.get("risk"),
                "monitoring": raw_analysis.get("monitoring"),
                "trade_plan": raw_analysis.get("trade_plan"),
            }
        if not minimax_configured():
            status = calendar.get("status", "UNAVAILABLE")
            summary = f"{pair} calendar status is {status}. MiniMax is not configured; deterministic scanner rules remain active."
            return self._json(200, {"configured": False, "analysis": {
                "summary": summary, "setup_quality": signal.get("tier", "UNRATED"),
                "confirmations": signal.get("reasons", []), "conflicts": [],
                "calendar_risk": status, "invalidation": signal.get("stop_loss"),
                "wait_for": "Economic-calendar clearance" if status in ("BLOCKED", "POST_NEWS") else "Scanner confirmation",
                "educational_note": "AI is advisory. Calendar gates and risk rules are deterministic."
            }, "calendar": calendar})
        try:
            result = minimax_analyze(context)
        except RuntimeError as exc:
            return self._error(502, str(exc))
        result["calendar"] = calendar
        self._json(200, result)

    def _analysis(self, query: dict) -> None:
        client = _STATE.market_client
        if client is None:
            return self._error(503, "market data client not configured")
        pair = str(query.get("pair") or query.get("symbol") or "").upper()
        if not pair:
            return self._error(400, "pair is required")
        tf_raw = str(query.get("timeframe") or "").lower()
        selected_timeframe = _timeframe_alias(tf_raw) if tf_raw else None
        if tf_raw and selected_timeframe is None:
            return self._error(400, f"unsupported timeframe: {tf_raw}")
        try:
            snapshot = client.fetch_snapshot(pair)
            selected_candles = client.fetch_candles(pair, selected_timeframe, limit=250) if selected_timeframe else None
            benchmark = None
            if pair != "BTCUSD":
                try:
                    benchmark = client.fetch_candles("BTCUSD", selected_timeframe, limit=250) if selected_timeframe else client.fetch_snapshot("BTCUSD")
                except Exception:
                    benchmark = None
            analysis = analyze_crypto(snapshot, benchmark, selected_candles, tf_raw or None)
            calendar = _STATE.news_filter.evaluate(pair) if _STATE.news_filter is not None else {"status": "UNAVAILABLE"}
            analysis["economic_calendar"] = calendar
            timing = analysis.get("trade_timing") or {}
            if calendar.get("status") in ("BLOCKED", "POST_NEWS"):
                timing["status"] = "AVOID"
                timing.setdefault("wait_for", []).append(f"calendar {calendar.get('status')}")
            elif calendar.get("status") != "CLEAR":
                timing["status"] = "WAIT"
                timing.setdefault("wait_for", []).append(f"calendar {calendar.get('status', 'UNAVAILABLE')}")
            analysis["trade_timing"] = timing
            analysis["trade_plan"] = build_trade_plan(snapshot, analysis, calendar)
        except Exception as exc:
            return self._error(502, f"analysis unavailable: {exc}")
        self._json(200, analysis)

    def _backtest_v2(self, query: dict) -> None:
        client = _STATE.market_client
        if client is None:
            return self._error(503, "market data client not configured")
        pair = str(query.get("pair") or "BTCUSD").upper()
        tf_raw = str(query.get("timeframe") or "15m").lower()
        replay_timeframes = {"15m": ("M15", 4, 96), "1h": ("H1", 1, 48), "4h": ("H4", 1, 30)}
        if tf_raw not in replay_timeframes:
            return self._error(400, "V2 backtest timeframe must be 15m, 1h, or 4h")
        selected_tf, stride, holding = replay_timeframes[tf_raw]
        limit = _clamp_int(query.get("limit"), default=3000, lo=400, hi=5000)
        try:
            report = run_v2_backtest(
                pair,
                client.fetch_candles(pair, "D1", limit=min(limit, 1000)),
                client.fetch_candles(pair, "H4", limit=min(limit, 1000)),
                client.fetch_candles(pair, "H1", limit=min(limit, 1000)),
                client.fetch_candles(pair, selected_tf, limit=limit),
                stride=stride, maximum_holding_bars=holding, timeframe=tf_raw,
            )
        except Exception as exc:
            return self._error(502, f"V2 backtest unavailable: {exc}")
        self._json(200, report)

    def _candles(self, query: dict) -> None:
        client = _STATE.market_client
        if client is None:
            return self._error(503, "market data client not configured")
        pair = str(query.get("pair") or query.get("symbol") or "").upper()
        if not pair:
            return self._error(400, "pair is required")
        tf_raw = str(query.get("timeframe") or "1h").lower()
        timeframe = _timeframe_alias(tf_raw)
        if timeframe is None:
            return self._error(400, f"unsupported timeframe: {tf_raw}")
        limit = _clamp_int(query.get("limit"), default=250, lo=1, hi=1000)
        try:
            candles = client.fetch_candles(pair, timeframe, limit=limit)
        except Exception as exc:
            return self._error(502, f"market data unavailable: {exc}")
        rows = [
            {
                "time": c.time, "open": c.open, "high": c.high,
                "low": c.low, "close": c.close, "volume": c.volume,
            }
            for c in candles
        ]
        self._json(200, {
            "pair": pair, "timeframe": timeframe,
            "candles": rows, "count": len(rows),
        })

    def _harmonics(self, query: dict) -> None:
        client = _STATE.market_client
        if client is None:
            return self._error(503, "market data client not configured")
        pair = str(query.get("pair") or query.get("symbol") or "").upper()
        if not pair:
            return self._error(400, "pair is required")
        tf_raw = str(query.get("timeframe") or "1h").lower()
        timeframe = _timeframe_alias(tf_raw)
        if timeframe is None:
            return self._error(400, f"unsupported timeframe: {tf_raw}")
        try:
            candles = client.fetch_candles(pair, timeframe)
            from .modules.harmonic import detect
            match = detect(candles)
        except Exception as exc:
            return self._error(502, f"harmonic data unavailable: {exc}")
        if match is None:
            return self._json(200, {
                "pair": pair, "timeframe": timeframe,
                "status": "none", "pattern": None,
            })
        points = {
            label: {"time": swing.time, "price": swing.price}
            for label, swing in match["points"].items()
        }
        prz = float(match["prz"])
        width = max(abs(prz) * 0.0015, 1e-8)
        self._json(200, {
            "pair": pair, "timeframe": timeframe, "status": "completed",
            "pattern": {
                "name": match["name"], "direction": match["direction"],
                "prz": {"price": prz, "low": prz - width, "high": prz + width},
                "points": points, "ratios": match["ratios"],
            },
        })

    def _adr(self, query: dict) -> None:
        client = _STATE.market_client
        if client is None:
            return self._error(503, "market data client not configured")
        pair = str(query.get("pair") or query.get("symbol") or "").upper()
        if not pair:
            return self._error(400, "pair is required")
        try:
            candles = client.fetch_candles(pair, "D1")
            from .modules.adr_calculator import snapshot
            adr = snapshot(candles)
        except Exception as exc:
            return self._error(502, f"ADR data unavailable: {exc}")
        if adr is None:
            return self._error(422, "insufficient daily candles for ADR")
        body = adr.__dict__.copy()
        body.update({"pair": pair, "period": 14, "day_time": candles[-1].time})
        self._json(200, body)

    def _list_signals(self, query: dict) -> None:
        limit = _clamp_int(query.get("limit"), default=50, lo=1, hi=500)
        tier = query.get("tier")
        pair = query.get("pair")
        if pair:
            rows = _by_pair(_STATE.repository, pair.upper(), limit)
        else:
            rows = _STATE.repository.recent(limit=limit)
        if tier:
            tier_u = tier.upper()
            rows = [r for r in rows if r.get("tier") == tier_u]
        self._json(200, {"signals": rows, "count": len(rows)})

    def _get_signal(self, sig_id: int) -> None:
        # The recent() listing is the cheapest lookup we have without
        # adding a new interface method; fine at our row counts.
        for r in _STATE.repository.recent(limit=500):
            if int(r.get("id", -1)) == sig_id:
                return self._json(200, {"signal": r})
        self._error(404, f"signal {sig_id} not found")

    def _list_positions(self) -> None:
        repo = _STATE.position_repo
        if repo is None:
            return self._json(200, {"positions": [], "count": 0,
                                    "note": "position_repo not configured"})
        rows = repo.open_positions()
        self._json(200, {"positions": rows, "count": len(rows)})

    def _list_journal(self, query: dict) -> None:
        repo = _STATE.closed_trade_repo
        if repo is None:
            return self._json(200, {"trades": [], "count": 0,
                                    "note": "closed_trade_repo not configured"})
        limit = _clamp_int(query.get("limit"), default=100, lo=1, hi=1000)
        pair = query.get("pair")
        rows = repo.recent(limit=limit, pair=pair.upper() if pair else None)
        self._json(200, {"trades": rows, "count": len(rows)})

    def _journal_stats(self) -> None:
        repo = _STATE.closed_trade_repo
        if repo is None:
            return self._json(200, {"trades": 0})
        self._json(200, repo.stats())

    def _kill_status(self) -> None:
        ks = _STATE.kill_switch
        if ks is None:
            return self._json(200, {"engaged": False,
                                    "note": "kill_switch not configured"})
        self._json(200, {
            "engaged": ks.is_engaged(),
            "reason": ks.reason(),
            "path": str(ks.path),
        })

    def _kill_set(self, body: dict) -> None:
        ks = _STATE.kill_switch
        if ks is None:
            return self._error(503, "kill_switch not configured")
        engaged = bool(body.get("engaged"))
        if engaged:
            reason = str(body.get("reason") or "engaged via API")
            ks.engage(reason)
        else:
            ks.disengage()
        self._json(200, {
            "engaged": ks.is_engaged(),
            "reason": ks.reason(),
        })

    def _request_scan(self, body: dict) -> None:
        path = _STATE.scan_request_path
        if path is None:
            return self._error(503, "scan_request_path not configured")
        # Touch the trigger file; the scanner worker picks it up on its
        # next idle check and runs an immediate cycle.
        try:
            from pathlib import Path as _P
            p = _P(path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.touch()
        except OSError as exc:
            return self._error(500, f"could not create trigger file: {exc}")
        self._json(202, {"queued": True, "path": str(path)})

    def _public_config(self) -> None:
        cfg = _STATE.config
        self._json(200, {
            "pairs": list(cfg.pairs),
            "thresholds": {
                "strong": cfg.strong_threshold,
                "good": cfg.good_threshold,
                "watchlist": cfg.watchlist_threshold,
            },
            "scan_interval_seconds": cfg.scan_interval_seconds,
            "news_blackout_minutes": cfg.news_blackout_minutes,
        })


def _timeframe_alias(value: str) -> Optional[str]:
    return {
        "1m": "M1", "m1": "M1",
        "5m": "M5", "m5": "M5",
        "15m": "M15", "m15": "M15",
        "30m": "M30", "m30": "M30",
        "1h": "H1", "h1": "H1",
        "4h": "H4", "h4": "H4",
        "1d": "D1", "d1": "D1",
        "1w": "W1", "w1": "W1",
    }.get(value.lower())


def _json_default(o):
    if hasattr(o, "isoformat"):
        return o.isoformat()
    return str(o)


def _clamp_int(value, default: int, lo: int, hi: int) -> int:
    try:
        n = int(value) if value is not None else default
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


def _count(repo: SignalRepository) -> int:
    if hasattr(repo, "count"):
        return repo.count()  # type: ignore[attr-defined]
    return len(repo.recent(limit=1))


def _by_pair(repo: SignalRepository, pair: str, limit: int):
    if hasattr(repo, "by_pair"):
        return repo.by_pair(pair, limit)  # type: ignore[attr-defined]
    return [r for r in repo.recent(limit=500) if r.get("pair") == pair][:limit]


def make_server(state: ApiState, host: str = "0.0.0.0", port: int = 8000) -> ThreadingHTTPServer:
    set_state(state)
    return ThreadingHTTPServer((host, port), _ApiHandler)
