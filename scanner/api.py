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
import math
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

from .config import Config
from .crypto_analysis import analyze_crypto
from .lifecycle_manager import stabilize_direction, map_legacy_state
from .kill_switch import KillSwitch
from .metrics import metrics
from .minimax_client import analyze as minimax_analyze, configured as minimax_configured
from .news_filter import NewsFilter
from .persistence import SignalRepository
from .trade_planner import build_trade_plan
from .v2_backtester import run_v2_backtest
from .trade_repo import ClosedTradeRepository, PositionRepository
from .auth import (
    hash_password, verify_password, create_access_token,
    create_refresh_token, decode_token, get_current_user, User
)

log = logging.getLogger(__name__)


@dataclass
class ApiState:
    """Container so the handler class can find runtime deps."""
    repository: SignalRepository
    config: Config
    position_repo: Optional[PositionRepository] = None
    closed_trade_repo: Optional[ClosedTradeRepository] = None
    kill_switch: Optional[KillSwitch] = None
    scan_request_path: Optional[str] = None
    market_client: Optional[Any] = None
    news_filter: Optional[NewsFilter] = None
    response_cache: dict = field(default_factory=dict)
    direction_states: dict = field(default_factory=dict)
    cache_lock: Any = field(default_factory=threading.RLock)
    started_at: float = field(default_factory=time.time)
    user_repo: Optional[Any] = None


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
        origin = self.headers.get("Origin", "*")
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, status: int, message: str) -> None:
        self._json(status, {"error": message})

    def _cache_get(self, key: str, allow_stale: bool = False):
        with _STATE.cache_lock:
            item = _STATE.response_cache.get(key)
        if not item:
            return None
        expires, stale_until, value = item
        now = time.monotonic()
        if now <= expires or (allow_stale and now <= stale_until):
            return value
        return None

    def _cache_set(self, key: str, value, ttl: float = 20.0, stale_ttl: float = 300.0) -> None:
        now = time.monotonic()
        with _STATE.cache_lock:
            _STATE.response_cache[key] = (now+ttl, now+stale_ttl, value)
            if len(_STATE.response_cache) > 200:
                expired = [cache_key for cache_key, item in _STATE.response_cache.items() if item[1] < now]
                for cache_key in expired:
                    _STATE.response_cache.pop(cache_key, None)

    def log_message(self, fmt, *args):  # noqa: N802
        log.info("%s - %s", self.address_string(), fmt % args)

    def _authenticate(self, request_headers: dict) -> Optional[User]:
        auth_header = request_headers.get("Authorization", "")
        return get_current_user(auth_header)

    def _require_auth(self, request_headers: dict) -> Tuple[None, int, str] | User:
        user = self._authenticate(request_headers)
        if not user:
            return None, 401, "Unauthorized"
        return user

    # --- HTTP verbs -----------------------------------------------------

    def do_OPTIONS(self):  # noqa: N802 — required name
        self.send_response(204)
        origin = self.headers.get("Origin", "*")
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
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
        start_time = time.time()
        
        # Observability endpoints (no timing)
        if path == "/health":
            return self._health()
        if path == "/ready":
            return self._ready()
        if path == "/metrics":
            return self._metrics()
        
        try:
            # Auth endpoints
            if path == "/api/auth/me":
                return self._auth_me(self.headers)
            
            # Protected paths check
            protected_paths = ['/api/signals', '/api/positions', '/api/journal', '/api/alerts']
            if path in protected_paths or path.startswith("/api/signals/"):
                result = self._require_auth(self.headers)
                if isinstance(result, tuple):
                    return self._error(result[1], result[2])
            
            # API routes
            if path == "/api/health":
                return self._health()
            if path == "/api/pairs":
                return self._json(200, {"pairs": list(_STATE.config.pairs)})
            if path == "/api/config":
                return self._public_config()
            if path == "/api/dashboard-snapshot":
                return self._dashboard_snapshot()
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
        finally:
            duration_ms = (time.time() - start_time) * 1000
            metrics.timing('api.request.duration_ms', duration_ms, {
                'path': path,
                'method': 'GET'
            })
            metrics.increment('api.requests', labels={'path': path})

    def _route_post(self, path: str, body: dict) -> None:
        if path == "/api/auth/register":
            return self._auth_register(body)
        if path == "/api/auth/login":
            return self._auth_login(body)
        if path == "/api/auth/refresh":
            return self._auth_refresh(body)
        if path == "/api/auth/logout":
            return self._auth_logout(body)
        if path == "/api/kill-switch":
            return self._kill_set(body)
        if path == "/api/scans/refresh":
            return self._request_scan(body)
        if path == "/api/ai/analyze":
            return self._ai_analyze(body)
        return self._error(404, f"unknown route: {path}")

    # --- handlers -------------------------------------------------------

    def _health(self) -> None:
        return self._json(200, {
            'status': 'ok',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    def _ready(self) -> None:
        checks = {
            'database': self._check_db(),
            'cache': len(_STATE.response_cache) >= 0,
            'market_data': _STATE.market_client is not None,
        }
        all_ok = all(checks.values())
        return self._json(200 if all_ok else 503, {
            'status': 'ok' if all_ok else 'degraded',
            'checks': checks,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    def _metrics(self) -> None:
        metrics_data = metrics.get_prometheus_metrics()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Access-Control-Allow-Origin", "*")
        payload = metrics_data.encode("utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _check_db(self) -> bool:
        try:
            _count(_STATE.repository)
            return True
        except Exception:
            return False

    def _legacy_health(self) -> None:
        try:
            n = _count(_STATE.repository)
        except Exception as exc:  # pragma: no cover
            return self._json(500, {"status": "degraded", "error": str(exc)})
        calendar_health = getattr(_STATE.news_filter, "source_health", "unconfigured") if _STATE.news_filter else "unconfigured"
        ready = _STATE.market_client is not None and calendar_health not in ("unavailable", "unconfigured")
        self._json(200, {
            "status": "ok" if ready else "degraded",
            "ready": ready,
            "db_signals": n,
            "pairs": list(_STATE.config.pairs),
            "uptime_seconds": int(time.time()-_STATE.started_at),
            "dependencies": {"market_data": "configured" if _STATE.market_client else "unconfigured", "calendar": calendar_health, "minimax": "configured" if minimax_configured() else "unconfigured"},
            "cache": {"entries": len(_STATE.response_cache), "analysis_ttl_seconds": 20},
            "engine": {"minimum_score": 60, "minimum_rr": 2.0, "actionable_status": "READY"},
        })

    def _auth_register(self, body: dict) -> None:
        email = str(body.get("email") or "").strip().lower()
        password = str(body.get("password") or "")
        name = str(body.get("name") or "").strip()
        if not email or not password:
            return self._error(400, "email and password are required")
        if len(password) < 8:
            return self._error(400, "password must be at least 8 characters")
        user_repo = getattr(_STATE, "user_repo", None)
        if user_repo is None:
            return self._error(503, "user_repo not configured")
        existing = user_repo.get_by_email(email) if hasattr(user_repo, "get_by_email") else None
        if existing:
            return self._error(409, "email already registered")
        password_hash = hash_password(password)
        user = user_repo.create(email=email, password_hash=password_hash, name=name)
        access_token = create_access_token(user)
        refresh_token = create_refresh_token(user)
        self._json(201, {
            "user": {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "plan": user.plan},
            "access_token": access_token,
            "refresh_token": refresh_token,
        })

    def _auth_login(self, body: dict) -> None:
        email = str(body.get("email") or "").strip().lower()
        password = str(body.get("password") or "")
        if not email or not password:
            return self._error(400, "email and password are required")
        user_repo = getattr(_STATE, "user_repo", None)
        if user_repo is None:
            return self._error(503, "user_repo not configured")
        user_data = user_repo.get_by_email(email) if hasattr(user_repo, "get_by_email") else None
        if not user_data:
            return self._error(401, "invalid credentials")
        stored_hash = user_data.get("password_hash") if isinstance(user_data, dict) else getattr(user_data, "password_hash", "")
        if not verify_password(password, stored_hash):
            return self._error(401, "invalid credentials")
        user = User(
            id=user_data.get("id") if isinstance(user_data, dict) else getattr(user_data, "id", 0),
            email=user_data.get("email") if isinstance(user_data, dict) else getattr(user_data, "email", ""),
            name=user_data.get("name") if isinstance(user_data, dict) else getattr(user_data, "name", ""),
            role=user_data.get("role") if isinstance(user_data, dict) else getattr(user_data, "role", "user"),
            plan=user_data.get("plan") if isinstance(user_data, dict) else getattr(user_data, "plan", "free"),
            created_at=user_data.get("created_at") if isinstance(user_data, dict) else getattr(user_data, "created_at", ""),
        )
        access_token = create_access_token(user)
        refresh_token = create_refresh_token(user)
        if hasattr(user_repo, "update_last_login"):
            user_repo.update_last_login(user.id)
        self._json(200, {
            "user": {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "plan": user.plan},
            "access_token": access_token,
            "refresh_token": refresh_token,
        })

    def _auth_refresh(self, body: dict) -> None:
        refresh_token = str(body.get("refresh_token") or "")
        if not refresh_token:
            return self._error(400, "refresh_token is required")
        payload = decode_token(refresh_token)
        if not payload or payload.get("type") != "refresh":
            return self._error(401, "invalid refresh token")
        user_repo = getattr(_STATE, "user_repo", None)
        if user_repo is None:
            return self._error(503, "user_repo not configured")
        user_id = int(payload["sub"])
        user_data = user_repo.get_by_id(user_id) if hasattr(user_repo, "get_by_id") else None
        if not user_data:
            return self._error(401, "user not found")
        user = User(
            id=user_data.get("id") if isinstance(user_data, dict) else getattr(user_data, "id", 0),
            email=user_data.get("email") if isinstance(user_data, dict) else getattr(user_data, "email", ""),
            name=user_data.get("name") if isinstance(user_data, dict) else getattr(user_data, "name", ""),
            role=user_data.get("role") if isinstance(user_data, dict) else getattr(user_data, "role", "user"),
            plan=user_data.get("plan") if isinstance(user_data, dict) else getattr(user_data, "plan", "free"),
            created_at=user_data.get("created_at") if isinstance(user_data, dict) else getattr(user_data, "created_at", ""),
        )
        access_token = create_access_token(user)
        new_refresh_token = create_refresh_token(user)
        self._json(200, {
            "access_token": access_token,
            "refresh_token": new_refresh_token,
        })

    def _auth_logout(self, body: dict) -> None:
        self._json(200, {"message": "logged out"})

    def _auth_me(self, headers: dict) -> None:
        result = self._require_auth(headers)
        if result[0] is None:
            return self._error(result[1], result[2])
        user = result
        self._json(200, {
            "user": {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "plan": user.plan},
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
        if pair:
            self._json(200, news.evaluate(pair))
        else:
            self._json(200, news.evaluate_global())

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
        cache_key = f"analysis:{pair}:{tf_raw or 'default'}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return self._json(200, cached)
        selected_timeframe = _timeframe_alias(tf_raw) if tf_raw else None
        if tf_raw and selected_timeframe is None:
            return self._error(400, f"unsupported timeframe: {tf_raw}")
        try:
            snapshot_key = f"snapshot:{pair}"
            snapshot = self._cache_get(snapshot_key)
            if snapshot is None:
                snapshot = client.fetch_snapshot(pair)
                self._cache_set(snapshot_key, snapshot, ttl=15, stale_ttl=60)
            selected_candles = client.fetch_candles(pair, selected_timeframe, limit=250) if selected_timeframe else None
            benchmark = None
            if pair != "BTCUSD":
                try:
                    if selected_timeframe:
                        benchmark = client.fetch_candles("BTCUSD", selected_timeframe, limit=250)
                    else:
                        benchmark = self._cache_get("snapshot:BTCUSD")
                        if benchmark is None:
                            benchmark = client.fetch_snapshot("BTCUSD")
                            self._cache_set("snapshot:BTCUSD", benchmark, ttl=15, stale_ttl=60)
                except Exception:
                    benchmark = None
            analysis = analyze_crypto(snapshot, benchmark, selected_candles, tf_raw or None)
            state_key = f"{pair}:{tf_raw or analysis.get('data_quality', {}).get('primary_timeframe', 'default')}"
            with _STATE.cache_lock:
                stability = stabilize_direction(analysis, _STATE.direction_states, state_key)
            raw_direction = analysis.get("direction", "NEUTRAL")
            analysis["raw_direction"] = raw_direction
            analysis["direction_stability"] = stability
            analysis["direction"] = stability["confirmed_direction"]
            lifecycle_state = stability.get("lifecycle_state", map_legacy_state(stability.get("lifecycle", "FORMING")))
            previous_lifecycle = _STATE.direction_states.get(state_key, {}).get("_last_lifecycle_state")
            if previous_lifecycle and previous_lifecycle != lifecycle_state:
                import uuid
                repo = _STATE.repository
                if hasattr(repo, "save_lifecycle_event"):
                    event = {
                        "id": str(uuid.uuid4()),
                        "setup_id": state_key,
                        "from_state": previous_lifecycle,
                        "to_state": lifecycle_state,
                        "reason_code": "STATE_CHANGE",
                        "human_readable": f"Lifecycle transition: {previous_lifecycle} -> {lifecycle_state}",
                        "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
                    }
                    repo.save_lifecycle_event(event)
                if hasattr(repo, "lifecycle_events_for"):
                    recent = repo.lifecycle_events_for(state_key, limit=10)
                    analysis["recent_transitions"] = recent
            if previous_lifecycle != lifecycle_state:
                if state_key in _STATE.direction_states:
                    _STATE.direction_states[state_key]["_last_lifecycle_state"] = lifecycle_state
            if analysis["direction"] == "NEUTRAL":
                analysis["scenarios"]["primary"] = "forming directional confirmation"
            elif analysis["direction"] != raw_direction:
                analysis["scenarios"]["primary"] = f"confirmed {analysis['direction'].lower()} bias is {stability['lifecycle'].lower()}"
            timing = analysis.get("trade_timing") or {}
            signal_stable = stability["confirmed_direction"] != "NEUTRAL" and stability["confirmed_direction"] == raw_direction and stability["lifecycle"] == "CONFIRMED"
            timing.setdefault("checks", {})["signal_stability"] = signal_stable
            if not signal_stable:
                timing["status"] = "WAIT"
                timing.setdefault("wait_for", []).append("signal stability")
            analysis["trade_timing"] = timing
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
            if timing.get("status") == "READY" and signal_stable:
                analysis["direction_stability"]["lifecycle"] = "READY"
                lifecycle_state = "ready"
            analysis["lifecycle_state"] = lifecycle_state
            analysis["trade_plan"] = build_trade_plan(snapshot, analysis, calendar, primary_candles=selected_candles)
        except Exception as exc:
            stale = self._cache_get(cache_key, allow_stale=True)
            if stale is not None:
                stale = dict(stale)
                stale["cache"] = {"stale": True, "reason": str(exc)}
                return self._json(200, stale)
            return self._error(502, f"analysis unavailable: {exc}")
        analysis["cache"] = {"stale": False, "ttl_seconds": 20}
        self._cache_set(cache_key, analysis)
        self._json(200, analysis)

    def _backtest_v2(self, query: dict) -> None:
        client = _STATE.market_client
        if client is None:
            return self._error(503, "market data client not configured")
        pair = str(query.get("pair") or "BTCUSD").upper()
        tf_raw = str(query.get("timeframe") or "15m").lower()
        replay_timeframes = {"15m": ("M15", 4, 96, .25), "1h": ("H1", 1, 48, 1.0), "4h": ("H4", 1, 30, 4.0)}
        if tf_raw not in replay_timeframes:
            return self._error(400, "V2 backtest timeframe must be 15m, 1h, or 4h")
        selected_tf, stride, holding, hours_per_bar = replay_timeframes[tf_raw]
        limit = _clamp_int(query.get("limit"), default=10000, lo=400, hi=20000)
        cache_key = f"backtest:{pair}:{tf_raw}:{limit}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return self._json(200, cached)
        try:
            selected_history = client.fetch_candles(pair, selected_tf, limit=limit)
            d1_limit = min(4000, math.ceil(limit*hours_per_bar/24)+300)
            h4_limit = min(20000, math.ceil(limit*hours_per_bar/4)+300)
            h1_limit = min(20000, math.ceil(limit*hours_per_bar)+300)
            d1_history = client.fetch_candles(pair, "D1", limit=d1_limit)
            h4_history = selected_history if selected_tf == "H4" else client.fetch_candles(pair, "H4", limit=h4_limit)
            h1_history = selected_history if selected_tf == "H1" else client.fetch_candles(pair, "H1", limit=h1_limit)
            effective_stride = max(stride, 4 if limit > 10000 else 2 if limit > 5000 else stride)
            report = run_v2_backtest(pair, d1_history, h4_history, h1_history, selected_history,
                stride=effective_stride, maximum_holding_bars=holding, timeframe=tf_raw,
            )
        except Exception as exc:
            stale = self._cache_get(cache_key, allow_stale=True)
            if stale is not None:
                return self._json(200, stale)
            return self._error(502, f"V2 backtest unavailable: {exc}")
        self._cache_set(cache_key, report, ttl=900, stale_ttl=3600)
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

    def _dashboard_snapshot(self) -> None:
        snapshot_id = str(uuid.uuid4())
        generated_at = datetime.now(timezone.utc).isoformat()

        health = self._get_health_data()
        config = self._get_config_data()
        signals = _STATE.repository.recent(limit=50)

        client = _STATE.market_client
        market_data_timestamp = None
        if client is not None and hasattr(client, '_last_fetch'):
            market_data_timestamp = client._last_fetch
        elif client is not None:
            try:
                client.fetch_candles(list(_STATE.config.pairs)[0] if _STATE.config.pairs else "BTCUSD", "H1", limit=1)
                market_data_timestamp = datetime.now(timezone.utc).isoformat()
            except Exception:
                market_data_timestamp = generated_at
        else:
            market_data_timestamp = generated_at

        snapshots = []
        for sig in signals:
            pair = sig.get("pair", "")
            if not pair:
                continue
            analysis = self._compute_analysis(pair)
            snapshots.append({
                "signal": sig,
                "analysis": analysis,
                "market_info": self._get_market_info(pair),
                "lifecycle_state": self._get_lifecycle_state(sig.get("id")),
                "recent_transitions": self._get_recent_transitions(sig.get("id")),
                "score_history": self._get_score_history(pair),
            })

        self._json(200, {
            "snapshot_id": snapshot_id,
            "generated_at": generated_at,
            "market_data_timestamp": market_data_timestamp,
            "scanner_health": health,
            "config": config,
            "provider_health": self._get_provider_health(),
            "economic_event_risk": self._get_economic_risk(),
            "markets": snapshots,
            "performance_summary": self._get_performance_summary(),
            "model_version": "v2.1.0",
        })

    def _get_health_data(self) -> dict:
        try:
            n = _count(_STATE.repository)
        except Exception:
            n = 0
        calendar_health = getattr(_STATE.news_filter, "source_health", "unconfigured") if _STATE.news_filter else "unconfigured"
        ready = _STATE.market_client is not None and calendar_health not in ("unavailable", "unconfigured")
        return {
            "status": "ok" if ready else "degraded",
            "ready": ready,
            "db_signals": n,
            "pairs": list(_STATE.config.pairs),
            "uptime_seconds": int(time.time() - _STATE.started_at),
            "dependencies": {
                "market_data": "configured" if _STATE.market_client else "unconfigured",
                "calendar": calendar_health,
                "minimax": "configured" if minimax_configured() else "unconfigured",
            },
            "cache": {"entries": len(_STATE.response_cache), "analysis_ttl_seconds": 20},
            "engine": {"minimum_score": 60, "minimum_rr": 2.0, "actionable_status": "READY"},
        }

    def _get_config_data(self) -> dict:
        cfg = _STATE.config
        return {
            "pairs": list(cfg.pairs),
            "thresholds": {
                "strong": cfg.strong_threshold,
                "good": cfg.good_threshold,
                "watchlist": cfg.watchlist_threshold,
            },
            "scan_interval_seconds": cfg.scan_interval_seconds,
            "news_blackout_minutes": cfg.news_blackout_minutes,
        }

    def _compute_analysis(self, pair: str) -> dict:
        client = _STATE.market_client
        if client is None:
            return {"error": "market data client not configured"}
        try:
            snapshot_key = f"snapshot:{pair}"
            snapshot = self._cache_get(snapshot_key)
            if snapshot is None:
                snapshot = client.fetch_snapshot(pair)
                self._cache_set(snapshot_key, snapshot, ttl=15, stale_ttl=60)
            selected_candles = client.fetch_candles(pair, "H1", limit=250)
            benchmark = None
            if pair != "BTCUSD":
                try:
                    benchmark = self._cache_get("snapshot:BTCUSD")
                    if benchmark is None:
                        benchmark = client.fetch_snapshot("BTCUSD")
                        self._cache_set("snapshot:BTCUSD", benchmark, ttl=15, stale_ttl=60)
                except Exception:
                    benchmark = None
            analysis = analyze_crypto(snapshot, benchmark, selected_candles, "1h")
            state_key = f"{pair}:{analysis.get('data_quality', {}).get('primary_timeframe', 'H1')}"
            with _STATE.cache_lock:
                stability = stabilize_direction(analysis, _STATE.direction_states, state_key)
            raw_direction = analysis.get("direction", "NEUTRAL")
            analysis["raw_direction"] = raw_direction
            analysis["direction_stability"] = stability
            analysis["direction"] = stability["confirmed_direction"]
            if analysis["direction"] == "NEUTRAL":
                analysis["scenarios"]["primary"] = "forming directional confirmation"
            elif analysis["direction"] != raw_direction:
                analysis["scenarios"]["primary"] = f"confirmed {analysis['direction'].lower()} bias is {stability['lifecycle'].lower()}"
            timing = analysis.get("trade_timing") or {}
            signal_stable = stability["confirmed_direction"] != "NEUTRAL" and stability["confirmed_direction"] == raw_direction and stability["lifecycle"] == "CONFIRMED"
            timing.setdefault("checks", {})["signal_stability"] = signal_stable
            if not signal_stable:
                timing["status"] = "WAIT"
                timing.setdefault("wait_for", []).append("signal stability")
            analysis["trade_timing"] = timing
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
            if timing.get("status") == "READY" and signal_stable:
                analysis["direction_stability"]["lifecycle"] = "READY"
            analysis["trade_plan"] = build_trade_plan(snapshot, analysis, calendar, primary_candles=selected_candles)
            return analysis
        except Exception as exc:
            stale = self._cache_get(f"analysis:{pair}:default", allow_stale=True)
            if stale is not None:
                stale = dict(stale)
                stale["cache"] = {"stale": True, "reason": str(exc)}
                return stale
            return {"error": f"analysis unavailable: {exc}"}

    def _get_market_info(self, pair: str) -> dict:
        client = _STATE.market_client
        if client is None:
            return {"status": "unconfigured"}
        try:
            snapshot = client.fetch_snapshot(pair)
            return {
                "status": "ok",
                "current_price": getattr(snapshot, "price", None),
                "bid": getattr(snapshot, "bid", None),
                "ask": getattr(snapshot, "ask", None),
                "volume_24h": getattr(snapshot, "volume", None),
            }
        except Exception:
            return {"status": "error"}

    def _get_lifecycle_state(self, signal_id: int) -> dict:
        if signal_id is None:
            return {"state": "unknown"}
        state_key = f"lifecycle:{signal_id}"
        cached = self._cache_get(state_key)
        if cached is not None:
            return cached
        return {"state": "active", "since": datetime.now(timezone.utc).isoformat()}

    def _get_recent_transitions(self, signal_id: int) -> list:
        if signal_id is None:
            return []
        transitions_key = f"transitions:{signal_id}"
        cached = self._cache_get(transitions_key)
        if cached is not None:
            return cached
        return []

    def _get_score_history(self, pair: str) -> dict:
        score_key = f"score_history:{pair}"
        cached = self._cache_get(score_key)
        if cached is not None:
            return cached
        return {"scores": [], "count": 0}

    def _get_provider_health(self) -> dict:
        calendar_health = getattr(_STATE.news_filter, "source_health", "unconfigured") if _STATE.news_filter else "unconfigured"
        return {
            "market_data": "ok" if _STATE.market_client else "unconfigured",
            "calendar": calendar_health,
            "minimax": "ok" if minimax_configured() else "unconfigured",
        }

    def _get_economic_risk(self) -> dict:
        try:
            if _STATE.news_filter is None:
                return {"level": "unknown", "active_events": 0}
            events = _STATE.news_filter.events
            high_impact = [e for e in events if getattr(e, "impact", "") == "high"]
            return {
                "level": "elevated" if high_impact else "normal",
                "active_events": len(events),
                "high_impact_count": len(high_impact),
            }
        except Exception:
            return {"level": "unknown", "active_events": 0}

    def _get_performance_summary(self) -> dict:
        try:
            repo = _STATE.closed_trade_repo
            if repo is None:
                return {"trades": 0, "win_rate": 0, "avg_r": 0}
            stats = repo.stats()
            return {
                "trades": stats.get("trades", 0),
                "win_rate": stats.get("win_rate", 0),
                "avg_r": stats.get("avg_r", 0),
            }
        except Exception:
            return {"trades": 0, "win_rate": 0, "avg_r": 0}


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
