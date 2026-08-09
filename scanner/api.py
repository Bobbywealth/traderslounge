"""HTTP API — stdlib `http.server`, no external deps.

Exposes JSON endpoints over the SignalRepository:

  GET  /api/health              → { status: "ok", db_signals: N, pairs: [...] }
  GET  /api/signals?limit=50&pair=XAUUSD&tier=STRONG
                                → { signals: [ ... ] }
  GET  /api/signals/<id>        → { signal: { ... } }
  GET  /api/pairs               → { pairs: [...] }
  GET  /api/config              → public-safe config (thresholds, pair list)

CORS and authentication policy:
  * Origins are read from a comma-separated ``ALLOWED_ORIGINS`` env var
    (default: ``https://traderslounge.onrender.com``). Wildcard reflection
    is no longer permitted when credentials are sent.
  * Mutating or expensive endpoints (AI calls, kill-switch, manual scan,
    dashboard snapshot, backtest) require a valid ``Authorization:
    Bearer`` token. The same is enforced for the Signals/Positions/Journal
    routes that were already protected.
  * Each request body is capped at ``MAX_BODY_BYTES`` (default 256 KB,
    10 MB only for ``/api/ai/chart-analyze``) and the value of
    ``Content-Length`` is rejected before reading if it exceeds the cap.
  * Per-token and per-IP token buckets protect the most expensive routes
    (AI, backtest, dashboard snapshot, kill-switch, manual scan).
"""
from __future__ import annotations

import json
import logging
import math
import os
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
from .crypto_analysis import analyze_crypto, _build_setup_zones
from .modules.institutional import build_institutional
from .lifecycle_manager import stabilize_direction, map_legacy_state
from .kill_switch import KillSwitch
from .metrics import metrics
from .minimax_client import analyze as minimax_analyze, analyze_chart as minimax_chart_analyze, configured as minimax_configured
from .news_filter import NewsFilter
from .persistence import SignalRepository
from .trade_planner import build_trade_plan
from .published_signals import build_published_signal
from .institutional_analysis import enrich_with_plan
from .decision_quality import attach_decision_quality
from .alert_preferences import (
    AlertEvent,
    AlertPreferences,
    AlertPreferencesStore,
    alert_event_key,
    evaluate_new_trade,
    evaluate_rules,
)
from .telegram_bot import TelegramBot
from .push_subscriptions import PushSubscription, PushSubscriptionStore
from .push_delivery import send_alert_push, is_configured as push_is_configured
from .validation_metrics import calibration_report, grouped_calibration, walk_forward_report
from .v2_backtester import run_v2_backtest
from .trade_repo import ClosedTradeRepository, PositionRepository
from .auth import (
    hash_password, verify_password, create_access_token,
    create_refresh_token, decode_token, get_current_user, User
)

log = logging.getLogger(__name__)


# --- CORS / size / rate-limit configuration ----------------------------

# Default to the production frontend origin. Override in the deploy env
# with a comma-separated list. We never reflect an arbitrary Origin.
_DEFAULT_ALLOWED_ORIGINS = "https://traderslounge.onrender.com,http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173"
MAX_BODY_BYTES_DEFAULT = 256 * 1024
MAX_BODY_BYTES_CHART_AI = 10 * 1024 * 1024

# Per-endpoint rate limits: (capacity, refill_per_second). The bucket is
# keyed first by authenticated user (when present) and falls back to
# client IP. Capacity is the burst budget; refill is the sustained
# allowance.
RATE_LIMITS: dict[str, tuple[int, float]] = {
    "/api/ai/analyze": (20, 20.0 / 60.0),          # 20 calls / minute
    "/api/ai/chart-analyze": (10, 10.0 / 60.0),   # 10 calls / minute
    "/api/backtest/v2": (10, 10.0 / 60.0),
    "/api/dashboard-snapshot": (30, 30.0 / 60.0),
    "/api/kill-switch": (10, 10.0 / 60.0),
    "/api/scans/refresh": (10, 10.0 / 60.0),
    "/api/alerts/preferences": (60, 60.0 / 60.0),
    "/api/alerts/feed": (60, 60.0 / 60.0),
    "/api/alerts/push/subscribe": (30, 30.0 / 60.0),
    "/api/alerts/push/unsubscribe": (30, 30.0 / 60.0),
    "/api/alerts/push/subscriptions": (30, 30.0 / 60.0),
}

# Endpoints that require a valid Authorization: Bearer token, in
# addition to the historical /api/signals|/positions|/journal protection.
PROTECTED_ROUTES: frozenset[str] = frozenset({
    "/api/ai/analyze",
    "/api/ai/chart-analyze",
    "/api/dashboard-snapshot",
    "/api/backtest/v2",
    "/api/kill-switch",
    "/api/scans/refresh",
    "/api/alerts/preferences",
    "/api/alerts/feed",
    "/api/alerts/push/subscribe",
    "/api/alerts/push/unsubscribe",
    "/api/alerts/push/subscriptions",
})

# Operational endpoints that require admin role
ADMIN_ROUTES: frozenset[str] = frozenset({
    "/api/kill-switch",
    "/api/scans/refresh",
})


def _allowed_origins() -> set[str]:
    raw = os.environ.get("ALLOWED_ORIGINS", _DEFAULT_ALLOWED_ORIGINS)
    return {origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()}


def _resolve_cors_origin(request_origin: Optional[str]) -> Optional[str]:
    """Return an allowed origin to echo back, or ``None`` to deny.

    The Python API does not use cookies for auth, so the response only
    includes ``Access-Control-Allow-Origin`` when the request origin is
    on the allowlist. This prevents arbitrary websites from invoking
    authenticated endpoints on behalf of a logged-in user.
    """
    if not request_origin:
        return None
    normalised = request_origin.rstrip("/")
    return normalised if normalised in _allowed_origins() else None


@dataclass
class _TokenBucket:
    capacity: float
    refill_per_second: float
    tokens: float = 0.0
    last_refill: float = 0.0

    def __post_init__(self) -> None:
        if self.last_refill == 0.0:
            self.last_refill = time.monotonic()
        self.tokens = float(self.capacity)

    def take(self, amount: float = 1.0) -> bool:
        now = time.monotonic()
        elapsed = now - self.last_refill
        if elapsed > 0:
            self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_per_second)
            self.last_refill = now
        if self.tokens >= amount:
            self.tokens -= amount
            return True
        return False


_rate_lock = threading.Lock()
_rate_buckets: dict[str, _TokenBucket] = {}


# ---------------------------------------------------------------------------
# Admin bootstrap
# ---------------------------------------------------------------------------

def _admin_emails() -> set[str]:
    """Return the set of emails that should be auto-promoted to ``admin``.

    Read from the ``ADMIN_EMAILS`` env var as a comma-separated list. The
    comparison is case-insensitive and whitespace is trimmed. If the env
    var is unset or empty, the set is empty and no automatic promotion
    happens.
    """
    raw = os.environ.get("ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def _maybe_promote_admin(user_repo, user_id: int, email: str) -> None:
    """If the email is on the admin allow-list, set the role to ``admin``.

    Idempotent: safe to call on every register/login. Failure is logged
    and ignored — a missing set_role method or a DB error must not block
    authentication.
    """
    if not email or "@" not in email:
        return
    if email.strip().lower() not in _admin_emails():
        return
    if user_repo is None or not hasattr(user_repo, "set_role"):
        return
    try:
        user_repo.set_role(int(user_id), "admin")
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("admin promotion failed for user %s: %s", user_id, exc)


def _client_ip(headers) -> str:
    # Render (and most proxies) supply the real client via X-Forwarded-For.
    forwarded = headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return headers.get("X-Real-IP") or (headers.get("Host") or "unknown")


def _check_rate_limit(bucket_key: str, route: str) -> bool:
    capacity, refill = RATE_LIMITS.get(route, (60, 60.0 / 60.0))
    with _rate_lock:
        bucket = _rate_buckets.get(bucket_key)
        if bucket is None or bucket.capacity != capacity or bucket.refill_per_second != refill:
            bucket = _TokenBucket(capacity=capacity, refill_per_second=refill)
            _rate_buckets[bucket_key] = bucket
    return bucket.take(1.0)

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
    # Stale-while-revalidate cache for the expensive dashboard snapshot.
    dashboard_cache: dict = field(default_factory=lambda: {"payload": None, "built_at": 0.0, "building": False})
    started_at: float = field(default_factory=time.time)
    user_repo: Optional[Any] = None
    # Optional SQLAlchemy-backed repositories — only populated when the
    # API server is wired to a Postgres-backed database. Existing call
    # sites default to None and fall back to the legacy SQLite paths.
    signal_repo: Optional[Any] = None
    alert_repo: Optional[Any] = None
    # In-process alert preferences store. Always present so /api/alerts
    # endpoints can answer without a database.
    alert_preferences_store: Optional[AlertPreferencesStore] = None
    # Last in-memory snapshot per pair, used by the invalidation rule
    # to detect price crossing the invalidation level.
    last_analysis_by_pair: dict = field(default_factory=dict)
    # Fallback de-duplication when persistent alert storage is unavailable.
    alert_event_keys: set[str] = field(default_factory=set)
    perf_repo: Optional[Any] = None
    # Telegram bot handle. Optional so the API still boots when the
    # TELEGRAM_BOT_TOKEN env var is not configured. When present,
    # ``/api/telegram/*`` and the alert dispatcher route through it.
    telegram_bot: Optional[TelegramBot] = None
    # Browser push subscription store.
    push_subscription_store: Optional[PushSubscriptionStore] = None
    market_event_repo: Optional[Any] = None
    trade_setup_repo: Optional[Any] = None
    trade_outcome_repo: Optional[Any] = None
    # Optional bot runner for automated trading. Populated when the
    # BotRunner class is available; /api/bot/* endpoints return 503
    # when this is None.
    bot_runner: Optional[Any] = None


# Module-level state pointer — http.server's handler API doesn't make
# passing state in clean. Set via make_server() before the server runs.
_STATE: Optional[ApiState] = None
_DASHBOARD_PREWARMED = False


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
        
        # Include correlation ID in response for client-side tracing
        from .logging_config import get_request_id
        request_id = get_request_id()
        if request_id:
            self.send_header("X-Request-ID", request_id)
        
        # Strict CORS: only echo the Origin when it is on the allowlist.
        # We no longer reflect arbitrary origins nor use "*" with
        # credentials — that combination is the most common path to
        # cross-site authenticated abuse.
        allowed = _resolve_cors_origin(self.headers.get("Origin"))
        if allowed is not None:
            self.send_header("Access-Control-Allow-Origin", allowed)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, status: int, message: str) -> None:
        from .logging_config import get_request_id
        body = {"error": message}
        request_id = get_request_id()
        if request_id:
            body["request_id"] = request_id
        self._json(status, body)

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
        allowed = _resolve_cors_origin(self.headers.get("Origin"))
        if allowed is not None:
            self.send_header("Access-Control-Allow-Origin", allowed)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    def do_POST(self):  # noqa: N802
        if _STATE is None:
            return self._error(503, "API state not initialized")
        url = urlsplit(self.path)
        path = url.path.rstrip("/") or "/"
        max_bytes = MAX_BODY_BYTES_CHART_AI if path == "/api/ai/chart-analyze" else MAX_BODY_BYTES_DEFAULT
        
        # Generate correlation ID for request tracing
        from .logging_config import set_request_context, generate_request_id
        correlation_id = self.headers.get("X-Request-ID") or generate_request_id()
        set_request_context(request_id=correlation_id)
        
        start_time = time.monotonic()
        try:
            body = self._read_body(max_bytes=max_bytes)
        except ValueError as exc:
            return self._error(413, str(exc))
        try:
            result = self._route_post(path, body)
            duration_ms = (time.monotonic() - start_time) * 1000
            log.info("POST %s completed in %.1fms", path, duration_ms)
            return result
        except Exception as exc:
            duration_ms = (time.monotonic() - start_time) * 1000
            log.exception("api error (POST) %s in %.1fms", path, duration_ms)
            return self._error(500, str(exc))
        finally:
            from .logging_config import clear_request_context
            clear_request_context()

    def _read_body(self, max_bytes: int = MAX_BODY_BYTES_DEFAULT) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        # Reject oversized payloads before reading them into memory. The
        # chart-AI endpoint is the only legitimate exception (it carries
        # a base64 image) and is capped at 10 MB.
        if length > max_bytes:
            raise ValueError(f"request body of {length} bytes exceeds limit of {max_bytes}")
        try:
            raw = self.rfile.read(length).decode("utf-8")
            return json.loads(raw) if raw else {}
        except (ValueError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid request body: {exc}") from exc

    def do_GET(self):  # noqa: N802
        if _STATE is None:
            return self._error(503, "API state not initialized")
        url = urlsplit(self.path)
        path = url.path.rstrip("/") or "/"
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        
        # Generate correlation ID for request tracing
        from .logging_config import set_request_context, generate_request_id
        correlation_id = self.headers.get("X-Request-ID") or generate_request_id()
        set_request_context(request_id=correlation_id)
        
        start_time = time.monotonic()
        try:
            result = self._route(path, query)
            duration_ms = (time.monotonic() - start_time) * 1000
            log.info("GET %s completed in %.1fms", path, duration_ms)
            return result
        except Exception as exc:  # last-resort
            duration_ms = (time.monotonic() - start_time) * 1000
            log.exception("api error GET %s in %.1fms", path, duration_ms)
            return self._error(500, str(exc))
        finally:
            from .logging_config import clear_request_context
            clear_request_context()

    # --- routing --------------------------------------------------------

    def _enforce_route_policy(self, path: str, method: str) -> Optional[Tuple[int, str]]:
        """Return an ``(status, message)`` tuple if the request must be denied."""
        if path in PROTECTED_ROUTES:
            result = self._require_auth(self.headers)
            if isinstance(result, tuple):
                return result[1], result[2]
            # Admin role required for operational endpoints
            if method in ("POST", "PUT", "DELETE") and path in ADMIN_ROUTES:
                if result.role != "admin":
                    return 403, "Admin role required for this operation"
            if method == "POST" and result.role == "demo" and path in ADMIN_ROUTES:
                return 403, "Demo sessions are read-only for operational controls"
        if path in RATE_LIMITS:
            user = get_current_user(self.headers.get("Authorization", ""))
            bucket_key = f"u:{user.id}" if user else f"ip:{_client_ip(self.headers)}"
            if not _check_rate_limit(bucket_key, path):
                return 429, "rate limit exceeded; retry after a short delay"
        return None

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

            # Protected paths + rate limit gate
            denied = self._enforce_route_policy(path, "GET")
            if denied is not None:
                return self._error(denied[0], denied[1])

            # Legacy protected paths check (signals/positions/journal)
            protected_paths = ['/api/signals', '/api/positions', '/api/journal', '/api/alerts',
                               '/api/alerts/preferences', '/api/alerts/feed', '/api/alerts/activity']
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
            if path == "/api/public/dashboard-snapshot":
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
            if path == "/api/published-signals":
                return self._list_published_signals(query)
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
            if path == "/api/performance/stats":
                return self._performance_stats(query)
            if path == "/api/alerts/preferences":
                return self._alerts_get_preferences()
            if path == "/api/alerts/feed":
                return self._alerts_feed(query)
            if path == "/api/alerts/activity":
                return self._alerts_activity()
            if path == "/api/alerts/push/subscriptions":
                return self._push_list_subscriptions()
            if path == "/api/telegram/status":
                return self._telegram_status()
            if path == "/api/validation/report":
                return self._validation_report(query)
            # Autonomy endpoints
            if path == "/api/autonomy/status":
                return self._autonomy_status()
            if path == "/api/autonomy/setups":
                return self._autonomy_setups(query)
            if path == "/api/autonomy/opportunities":
                return self._autonomy_opportunities(query)
            if path == "/api/autonomy/journal":
                return self._autonomy_journal(query)
            if path == "/api/autonomy/regime":
                return self._autonomy_regime(query)
            if path == "/api/autonomy/news":
                return self._autonomy_news()
            if path == "/api/autonomy/alerts":
                return self._autonomy_alerts(query)
            if path == "/api/autonomy/activity":
                return self._autonomy_activity(query)
            return self._error(404, f"unknown route: {path}")
        finally:
            duration_ms = (time.time() - start_time) * 1000
            metrics.timing('api.request.duration_ms', duration_ms, {
                'path': path,
                'method': 'GET'
            })
            metrics.increment('api.requests', labels={'path': path})

    def _route_post(self, path: str, body: dict) -> None:
        # Auth + rate-limit gate for protected mutating routes. The
        # public registration/login routes are intentionally exempt so
        # new users can still obtain credentials.
        if path not in {"/api/auth/register", "/api/auth/login", "/api/auth/refresh"}:
            denied = self._enforce_route_policy(path, "POST")
            if denied is not None:
                return self._error(denied[0], denied[1])
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
        if path == "/api/ai/chart-analyze":
            return self._ai_chart_analyze(body)
        if path == "/api/alerts/preferences":
            return self._alerts_set_preferences(body)
        if path == "/api/alerts/push/subscribe":
            return self._push_subscribe(body)
        if path == "/api/alerts/push/unsubscribe":
            return self._push_unsubscribe(body)
        if path == "/api/telegram/webhook":
            return self._telegram_webhook(body)
        if path == "/api/telegram/link-token":
            return self._telegram_link_token(body)
        if path == "/api/telegram/register-webhook":
            return self._telegram_register_webhook(body)
        return self._error(404, f"unknown route: {path}")

    # --- handlers -------------------------------------------------------

    def _health(self) -> None:
        # Health checks are the earliest signal the server is up, so use the
        # first one to pre-warm the dashboard snapshot cache in the background.
        # The captured handler only calls stateless helpers (they read _STATE,
        # never request I/O), which is safe after the request completes.
        self._maybe_prewarm_dashboard()
        return self._json(200, {
            'status': 'ok',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

    def _maybe_prewarm_dashboard(self) -> None:
        global _DASHBOARD_PREWARMED
        if _DASHBOARD_PREWARMED:
            return
        with _STATE.cache_lock:
            already = _STATE.dashboard_cache.get("payload") is not None
            building = bool(_STATE.dashboard_cache.get("building"))
        if already or building:
            _DASHBOARD_PREWARMED = True
            return
        _DASHBOARD_PREWARMED = True
        threading.Thread(target=self._refresh_dashboard_cache, name="dashboard-prewarm", daemon=True).start()

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
        # source_health is emitted uppercase ("LIVE"/"STALE"/"UNAVAILABLE") while
        # the unconfigured sentinel is lowercase — compare case-insensitively or
        # a dead calendar feed still reports the service as ready.
        ready = _STATE.market_client is not None and str(calendar_health).lower() not in ("unavailable", "unconfigured")
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
        created = user_repo.create(email=email, password_hash=password_hash, name=name)
        user_id = created.get("id") if isinstance(created, dict) else created.id
        # ADMIN_EMAILS auto-promotion runs after the row exists so the
        # user_id is real. If the email is on the allow-list, this upgrades
        # the role to ``admin`` before we mint the JWT.
        _maybe_promote_admin(user_repo, user_id, email)
        refreshed = user_repo.get_by_id(int(user_id)) if hasattr(user_repo, "get_by_id") else None
        role = (
            refreshed.get("role")
            if isinstance(refreshed, dict)
            else (created.get("role", "user") if isinstance(created, dict) else created.role)
        )
        user = User(
            id=user_id,
            email=created.get("email") if isinstance(created, dict) else created.email,
            name=created.get("name") if isinstance(created, dict) else created.name,
            role=role,
            plan=created.get("plan", "free") if isinstance(created, dict) else created.plan,
            created_at=created.get("created_at", "") if isinstance(created, dict) else created.created_at,
        )
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
        if email == "demo@trader.com" and password == "demo123":
            user = User(id=0, email=email, name="Demo Trader", role="demo", plan="pro", created_at="")
            return self._json(200, {
                "user": {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "plan": user.plan},
                "access_token": create_access_token(user),
                "refresh_token": create_refresh_token(user),
            })
        user_repo = getattr(_STATE, "user_repo", None)
        if user_repo is None:
            return self._error(503, "user_repo not configured")
        user_data = user_repo.get_by_email(email) if hasattr(user_repo, "get_by_email") else None
        if not user_data:
            return self._error(401, "invalid credentials")
        stored_hash = user_data.get("password_hash") if isinstance(user_data, dict) else getattr(user_data, "password_hash", "")
        if not verify_password(password, stored_hash):
            return self._error(401, "invalid credentials")
        # Re-read the user after a possible admin promotion so the
        # freshly-minted JWT carries the up-to-date role.
        _maybe_promote_admin(user_repo, user_data.get("id") if isinstance(user_data, dict) else getattr(user_data, "id", 0), email)
        refreshed_login = user_repo.get_by_email(email) if hasattr(user_repo, "get_by_email") else user_data
        login_user_data = refreshed_login if isinstance(refreshed_login, dict) else user_data
        user = User(
            id=login_user_data.get("id") if isinstance(login_user_data, dict) else getattr(login_user_data, "id", 0),
            email=login_user_data.get("email") if isinstance(login_user_data, dict) else getattr(login_user_data, "email", ""),
            name=login_user_data.get("name") if isinstance(login_user_data, dict) else getattr(login_user_data, "name", ""),
            role=login_user_data.get("role") if isinstance(login_user_data, dict) else getattr(login_user_data, "role", "user"),
            plan=login_user_data.get("plan") if isinstance(login_user_data, dict) else getattr(login_user_data, "plan", "free"),
            created_at=login_user_data.get("created_at") if isinstance(login_user_data, dict) else getattr(login_user_data, "created_at", ""),
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
        user_id = int(payload["sub"])
        if user_id == 0:
            user = User(id=0, email="demo@trader.com", name="Demo Trader", role="demo", plan="pro", created_at="")
            return self._json(200, {
                "access_token": create_access_token(user),
                "refresh_token": create_refresh_token(user),
            })
        user_repo = getattr(_STATE, "user_repo", None)
        if user_repo is None:
            return self._error(503, "user_repo not configured")
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
        if isinstance(result, tuple):
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

    def _ai_chart_analyze(self, body: dict) -> None:
        pair = str(body.get("pair") or body.get("symbol") or "").upper()[:20]
        timeframe = str(body.get("timeframe") or "1h")[:10]
        image_data_url = body.get("image_data_url")
        if not pair:
            return self._error(400, "pair is required")
        if not isinstance(image_data_url, str) or not image_data_url.startswith("data:image/"):
            return self._error(400, "image_data_url must be a chart image data URL")
        # Size enforcement is now handled at the transport layer
        # (``_read_body`` with ``MAX_BODY_BYTES_CHART_AI``) so we cannot
        # allocate a 10 MB+ payload before rejecting it.

        news = _STATE.news_filter
        calendar = news.evaluate(pair) if news else {"status": "UNAVAILABLE", "reason_code": "SOURCE_UNAVAILABLE"}
        raw_chart = body.get("chart") if isinstance(body.get("chart"), dict) else {}
        raw_analysis = body.get("analysis") if isinstance(body.get("analysis"), dict) else {}
        candles = raw_chart.get("candles") if isinstance(raw_chart.get("candles"), list) else []
        chart_context = {
            "pair": pair,
            "timeframe": timeframe,
            "current_price": raw_chart.get("current_price"),
            "candles": candles[-120:],
            "overlays": raw_chart.get("overlays") if isinstance(raw_chart.get("overlays"), dict) else {},
            "manual_drawings": raw_chart.get("manual_drawings") if isinstance(raw_chart.get("manual_drawings"), list) else [],
            "v2_analysis": {
                "direction": raw_analysis.get("direction"),
                "total_score": raw_analysis.get("total_score"),
                "category_breakdown": raw_analysis.get("category_breakdown"),
                "market_context": raw_analysis.get("market_context"),
                "trade_timing": raw_analysis.get("trade_timing"),
                "scenarios": raw_analysis.get("scenarios"),
                "trade_plan": raw_analysis.get("trade_plan"),
            },
            "economic_calendar": calendar,
        }
        if not minimax_configured():
            direction = str(raw_analysis.get("direction") or "NEUTRAL")
            patterns = (chart_context["overlays"] or {}).get("harmonics") or []
            return self._json(200, {"configured": False, "analysis": {
                "summary": f"{pair} {timeframe} chart captured. Deterministic V2 direction is {direction}; MiniMax is not configured for visual chart analysis.",
                "visual_bias": direction,
                "confidence": int(raw_analysis.get("total_score") or 0),
                "visible_patterns": [str(pattern.get("type")) for pattern in patterns if isinstance(pattern, dict) and pattern.get("type")],
                "key_levels": [], "confirmations": [], "conflicts": [], "risk_factors": [],
                "wait_for": "Scanner confirmation and calendar clearance",
                "invalidation": "Use the deterministic V2 invalidation when available",
                "educational_note": "Visual AI is advisory. Deterministic scanner and calendar gates remain authoritative.",
            }, "calendar": calendar})
        try:
            result = minimax_chart_analyze(chart_context, image_data_url)
        except RuntimeError as exc:
            return self._error(502, str(exc))
        result["calendar"] = calendar
        return self._json(200, result)

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
            body = dict(cached)
            cache_meta = dict(body.get("cache") or {})
            if (body.get("data_quality") or {}).get("data_stale"):
                cache_meta.update({"stale": True, "reason": "underlying market candles are stale"})
            body["cache"] = cache_meta or {"stale": False}
            return self._json(200, body)
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
            calendar_status = calendar.get("status", "UNAVAILABLE")
            if calendar_status in ("BLOCKED", "POST_NEWS"):
                timing["status"] = "AVOID"
                timing.setdefault("wait_for", []).append(f"calendar {calendar_status}")
            elif calendar_status == "UNAVAILABLE":
                # Calendar feed unreachable. Note the degradation but do not
                # park every market in WAIT — an upstream outage would
                # otherwise mute the whole product with no visible cause.
                timing["calendar_degraded"] = True
            elif calendar_status != "CLEAR":
                timing["status"] = "WAIT"
                timing.setdefault("wait_for", []).append(f"calendar {calendar_status}")
            analysis["trade_timing"] = timing
            if timing.get("status") == "READY" and signal_stable:
                analysis["direction_stability"]["lifecycle"] = "READY"
                lifecycle_state = "ready"
            analysis["lifecycle_state"] = lifecycle_state
            if selected_candles:
                analysis["zones"]["setup_zones"] = _build_setup_zones(price=float(selected_candles[-1].close), atr_value=analysis.get("indicators", {}).get("atr"), zones=analysis.get("zones", {}), indicators=analysis.get("indicators", {}), direction=analysis.get("direction", "NEUTRAL"), market_context=analysis.get("market_context", {}), trade_timing=analysis.get("trade_timing", {}))
            analysis["trade_plan"] = build_trade_plan(snapshot, analysis, calendar, primary_candles=selected_candles)
            enrich_with_plan(analysis)
            self._attach_institutional_block(analysis, snapshot, selected_timeframe)
            analysis = attach_decision_quality(analysis, calendar=calendar)
            self._publish_actionable_analysis(analysis)
        except Exception as exc:
            stale = self._cache_get(cache_key, allow_stale=True)
            if stale is not None:
                stale = dict(stale)
                stale["cache"] = {"stale": True, "reason": str(exc)}
                return self._json(200, stale)
            return self._error(502, f"analysis unavailable: {exc}")
        data_stale = bool((analysis.get("data_quality") or {}).get("data_stale"))
        analysis["cache"] = {"stale": data_stale, "ttl_seconds": 20, **({"reason": "underlying market candles are stale"} if data_stale else {})}
        self._cache_set(cache_key, analysis)
        self._json(200, analysis)

    def _attach_institutional_block(
        self,
        analysis: dict,
        snapshot,
        selected_timeframe,
    ) -> None:
        """Attach the Phase 1 + Phase 2 institutional report to an
        analysis dict.

        Pure additive attachment — never mutates canonical fields. Wrapped
        in a try/except so a failure inside any institutional module can
        never break the canonical /api/analysis or scanner response; in the
        worst case the user sees a stub ``available: False`` block.
        """
        try:
            calendar_state = str(
                (analysis.get("economic_calendar") or {}).get("status")
                or "CLEAR"
            ).upper()
            if calendar_state not in (
                "CLEAR", "CAUTION", "BLOCKED", "POST_NEWS", "UNAVAILABLE"
            ):
                calendar_state = "CLEAR"
            primary_tf = (
                selected_timeframe
                or (analysis.get("data_quality") or {}).get("primary_timeframe")
            )
            analysis["institutional"] = build_institutional(
                analysis,
                snapshot,
                calendar_state=calendar_state,
                primary_timeframe=primary_tf,
                market_client=_STATE.market_client,
            )
        except Exception as exc:  # pragma: no cover - defensive
            analysis["institutional"] = {
                "available": False,
                "reason": f"institutional_modules_error: {exc!r}",
            }

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
        # 1000 covers a full initial chart load (matches Binance's per-page
        # cap); "before" lets the chart page further back on scroll-back for
        # crypto (Twelve Data has no pagination knob, see MultiSourceClient).
        limit = _clamp_int(query.get("limit"), default=250, lo=1, hi=1000)
        before_raw = query.get("before")
        end_time_ms: Optional[int] = None
        if before_raw not in (None, ""):
            try:
                end_time_ms = int(float(before_raw) * 1000)
            except (TypeError, ValueError):
                return self._error(400, "before must be a unix timestamp in seconds")
        cache_key = f"candles:{pair}:{timeframe}:{limit}:{end_time_ms or 0}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return self._json(200, cached)
        try:
            candles = client.fetch_candles(pair, timeframe, limit=limit, end_time_ms=end_time_ms)
        except Exception as exc:
            stale = self._cache_get(cache_key, allow_stale=True)
            if stale is not None:
                return self._json(200, stale)
            return self._error(502, f"market data unavailable: {exc}")
        rows = [
            {
                "time": c.time, "open": c.open, "high": c.high,
                "low": c.low, "close": c.close, "volume": c.volume,
            }
            for c in candles
        ]
        body = {
            "pair": pair, "timeframe": timeframe,
            "candles": rows, "count": len(rows),
            "has_more": end_time_ms is not None and len(rows) >= limit,
        }
        # Pagination pages are immutable (a fixed historical window), so cache
        # them far longer than the live "latest" window.
        self._cache_set(cache_key, body, ttl=15 if end_time_ms is None else 3600, stale_ttl=120)
        self._json(200, body)

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
        cache_key = f"harmonics:{pair}:{timeframe}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return self._json(200, cached)
        try:
            candles = client.fetch_candles(pair, timeframe)
            from .modules.harmonic import detect
            from .modules.classical import detect_all as detect_classical
            from .modules.trendlines import detect as detect_trendlines
            match = detect(candles)
            classical = detect_classical(candles)
            trendlines = detect_trendlines(candles)
        except Exception as exc:
            stale = self._cache_get(cache_key, allow_stale=True)
            if stale is not None:
                return self._json(200, stale)
            return self._error(502, f"harmonic data unavailable: {exc}")
        if match is None:
            body = {"pair": pair, "timeframe": timeframe,
                    "status": "candidate" if (classical or trendlines) else "none",
                    "pattern": None, "classical": classical, "trendlines": trendlines}
        else:
            points = {
                label: {"time": swing.time, "price": swing.price}
                for label, swing in match["points"].items()
            }
            prz = float(match["prz"])
            width = max(abs(prz) * 0.0015, 1e-8)
            candidate_zone = match.get("prz_zone") or {}
            body = {
                "pair": pair, "timeframe": timeframe, "status": "candidate",
                "pattern": {
                    "name": match["name"], "direction": match["direction"],
                    "candidate_status": match.get("candidate_status", "candidate_unvalidated"),
                    "validated": False,
                    "prz": {
                        "price": prz,
                        "low": candidate_zone.get("lower", prz - width),
                        "high": candidate_zone.get("upper", prz + width),
                    },
                    "points": points, "pivots": match.get("pivot_coordinates") or {},
                    "ratios": match["ratios"], "ratio_validation": match.get("ratio_validation") or {},
                    "invalidation": match.get("invalidation"),
                    "alternative": match.get("alternative_interpretation"),
                    "geometry_quality": match.get("geometry_quality"),
                    "forward_validation": match.get("forward_validation"),
                    "trade_levels": match.get("trade_levels"),
                },
                "classical": classical,
                "trendlines": trendlines,
                "warning": "Candidate only. Pattern geometry has not yet passed forward outcome validation.",
            }
        self._cache_set(cache_key, body, ttl=30, stale_ttl=120)
        self._json(200, body)

    def _adr(self, query: dict) -> None:
        client = _STATE.market_client
        if client is None:
            return self._error(503, "market data client not configured")
        pair = str(query.get("pair") or query.get("symbol") or "").upper()
        if not pair:
            return self._error(400, "pair is required")
        cache_key = f"adr:{pair}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return self._json(200, cached)
        try:
            candles = client.fetch_candles(pair, "D1")
            from .modules.adr_calculator import snapshot
            adr = snapshot(candles)
        except Exception as exc:
            stale = self._cache_get(cache_key, allow_stale=True)
            if stale is not None:
                return self._json(200, stale)
            return self._error(502, f"ADR data unavailable: {exc}")
        if adr is None:
            return self._error(422, "insufficient daily candles for ADR")
        body = adr.__dict__.copy()
        body.update({"pair": pair, "period": 14, "day_time": candles[-1].time})
        self._cache_set(cache_key, body, ttl=60, stale_ttl=300)
        self._json(200, body)

    def _list_published_signals(self, query: dict) -> None:
        limit = _clamp_int(query.get("limit"), default=50, lo=1, hi=200)
        status = str(query.get("status") or "").upper() or None
        repo = _STATE.repository
        if not hasattr(repo, "published"):
            return self._json(200, {"signals": [], "count": 0})
        rows = repo.published(limit=limit, status=status)
        self._json(200, {"signals": rows, "count": len(rows), "source": "V2_GUARDED"})

    def _publish_actionable_analysis(self, analysis: dict) -> None:
        payload = build_published_signal(analysis)
        if payload is None:
            return

        # Publication is the authority for a "new trade". Serialize this small
        # section so simultaneous dashboard/analysis requests cannot announce
        # the same setup twice. Repositories keep at most one ACTIVE call per
        # pair/timeframe and report whether this invocation created it.
        try:
            with _STATE.cache_lock:
                if hasattr(_STATE.repository, "publish_actionable_once"):
                    signal_id, is_new = _STATE.repository.publish_actionable_once(payload)
                elif hasattr(_STATE.repository, "publish_actionable"):
                    signal_id = _STATE.repository.publish_actionable(payload)
                    is_new = True
                else:
                    return
            payload["id"] = int(signal_id)
        except Exception:
            logging.exception("failed to persist actionable V2 signal for %s", analysis.get("pair"))
            return

        try:
            if hasattr(_STATE.repository, "save_forecast"):
                quality = analysis.get("decision_quality") or {}
                weights = ((quality.get("scenario_weights") or {}).get("weights") or {})
                direction = str(payload["direction"]).upper()
                primary_label = "bull" if direction == "BUY" else "bear"
                plan = analysis.get("trade_plan") or {}
                timing = analysis.get("trade_timing") or {}
                locations = timing.get("location_signals") or ["unspecified"]
                _STATE.repository.save_forecast({
                    "fingerprint": payload["fingerprint"],
                    "created_at": payload["published_at"].isoformat(),
                    "pair": payload["pair"],
                    "timeframe": payload["timeframe"],
                    "direction": direction,
                    "forecast_weight": float(weights.get(primary_label, 0.0)) / 100.0,
                    "weight_label": "scenario_weight_uncalibrated",
                    "setup_type": "+".join(sorted(map(str, locations))),
                    "session": ((timing.get("session") or {}).get("name")),
                    "volatility_regime": ((timing.get("regime") or {}).get("name") or (timing.get("regime") or {}).get("volatility") or "unknown"),
                    "score": payload["score"],
                    "setup_quality_score": quality.get("setup_quality"),
                    "execution_readiness_score": quality.get("execution_readiness"),
                    "entry": payload["entry"],
                    "stop_loss": payload["stop_loss"],
                    "target": payload["tp1"],
                    "engine_version": payload["engine_version"],
                    "metadata": {
                        "calibrated": False,
                        "position_sizing_allowed": False,
                        "risk_profile": quality.get("financial_risk_profile") or {},
                        "evidence_ledger": quality.get("evidence_ledger") or {},
                    },
                })
        except Exception:
            logging.exception("failed to persist actionable V2 forecast for %s", analysis.get("pair"))

        try:
            self._evaluate_and_persist_alerts(
                analysis,
                new_trade=payload if is_new else None,
            )
        except Exception:
            logging.exception("alert evaluation failed for %s", analysis.get("pair"))

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

    # --- alert preferences / feed ---------------------------------------

    def _alert_store(self) -> AlertPreferencesStore:
        store = getattr(_STATE, "alert_preferences_store", None)
        if store is None:
            store = AlertPreferencesStore(repository=_STATE.repository)
            _STATE.alert_preferences_store = store  # type: ignore[attr-defined]
        return store

    def _alerts_get_preferences(self) -> None:
        user = self._authenticate(self.headers)
        if not user:
            return self._error(401, "Unauthorized")
        prefs = self._alert_store().get(int(user.id))
        if prefs is None:
            # Return conservative defaults so the UI can render even
            # before the user has saved preferences once.
            prefs = AlertPreferences(user_id=int(user.id))
        self._json(200, prefs.to_dict())

    def _alerts_set_preferences(self, body: dict) -> None:
        user = self._authenticate(self.headers)
        if not user:
            return self._error(401, "Unauthorized")
        try:
            body = body or {}
            body["user_id"] = int(user.id)
            prefs = AlertPreferences.from_dict(body)
        except (TypeError, ValueError) as exc:
            return self._error(400, f"invalid preferences payload: {exc}")
        saved = self._alert_store().upsert(prefs)
        self._json(200, saved.to_dict())

    def _alerts_feed(self, query: dict) -> None:
        user = self._authenticate(self.headers)
        if not user:
            return self._error(401, "Unauthorized")
        limit = _clamp_int(query.get("limit"), default=50, lo=1, hi=200)
        repo = getattr(_STATE, "alert_repo", None)
        events: list[dict] = []
        if repo is not None and hasattr(repo, "recent_for_user"):
            try:
                events = list(repo.recent_for_user(int(user.id), limit=limit))
            except Exception:
                logging.exception("alert_repo.recent_for_user failed")
                events = []
        # If no persistent repo is wired, return an empty feed so the
        # UI renders the empty state correctly without 503-ing.
        self._json(200, {"events": events, "count": len(events)})

    def _alerts_activity(self) -> None:
        """Live activity feed: reshapes the dashboard cache into an
        activity-focused payload for the Alerts page.  Returns scanner
        status, per-pair active setups, lifecycle transitions, and
        economic-calendar gate status without triggering a fresh scan."""
        user = self._authenticate(self.headers)
        if not user:
            return self._error(401, "Unauthorized")

        dashboard = None
        with _STATE.cache_lock:
            dashboard = _STATE.dashboard_cache.get("payload")

        if dashboard is None:
            try:
                dashboard = self._build_dashboard_payload()
                with _STATE.cache_lock:
                    _STATE.dashboard_cache["payload"] = dashboard
                    _STATE.dashboard_cache["built_at"] = time.monotonic()
            except Exception:
                logging.exception("alerts/activity: dashboard build failed")
                return self._json(200, {
                    "scanner_running": False,
                    "pairs": [],
                    "transitions": [],
                    "calendar": None,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                })

        health = dashboard.get("scanner_health") or {}
        config = dashboard.get("config") or {}
        econ = dashboard.get("economic_event_risk") or {}
        markets = dashboard.get("markets") or []

        pairs_activity = []
        all_transitions = []

        for m in markets:
            sig = m.get("signal") or {}
            analysis = m.get("analysis") or {}
            ls = m.get("lifecycle_state") or {}
            transitions = m.get("recent_transitions") or []
            plan = analysis.get("trade_plan") or {}
            timing = analysis.get("trade_timing") or {}
            calendar = analysis.get("economic_calendar") or {}
            score_hist = m.get("score_history") or {}
            scores = score_hist.get("scores") or []

            pair_name = str(sig.get("pair") or "").upper()
            direction = sig.get("direction") or analysis.get("direction") or "NEUTRAL"
            score = sig.get("confidence_score") or analysis.get("total_score") or 0
            tier = sig.get("tier") or (
                "STRONG" if plan.get("status") in ("STRONG", "VALID")
                else "WATCHLIST" if score >= 50
                else "NO_TRADE"
            )

            pairs_activity.append({
                "pair": pair_name,
                "direction": direction,
                "score": int(score),
                "tier": tier,
                "status": plan.get("status") or "WAIT",
                "eligible": plan.get("eligible", False),
                "timing_status": timing.get("status") or "UNKNOWN",
                "lifecycle": ls.get("state") or "unknown",
                "confirmed_direction": ls.get("confirmed_direction"),
                "since_bar_time": ls.get("since_bar_time"),
                "reason": ls.get("reason"),
                "entry": plan.get("entry"),
                "stop_loss": plan.get("stop"),
                "tp1": plan.get("tp1"),
                "net_rr": plan.get("net_rr"),
                "calendar_status": calendar.get("status") or "UNKNOWN",
                "blocking_reasons": plan.get("blocking_reasons") or [],
                "latest_score": scores[-1] if scores else None,
                "market_info": m.get("market_info") or {},
            })

            for t in transitions:
                all_transitions.append({**t, "pair": pair_name})

        all_transitions.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

        calendar_summary = {
            "global_status": econ.get("status") or "UNKNOWN",
            "event_title": econ.get("event_title"),
            "currency": econ.get("currency"),
            "impact": econ.get("impact"),
            "minutes_to_event": econ.get("time_until_event_minutes"),
            "affected_symbols": econ.get("affected_symbols") or [],
            "next_eligible_time": econ.get("next_eligible_time"),
            "next_event": econ.get("next_event"),
        }

        self._json(200, {
            "scanner_running": health.get("status") == "running",
            "scanner_health": health,
            "scan_interval_seconds": config.get("scan_interval_seconds"),
            "pairs_monitored": list(_STATE.config.pairs),
            "pairs": pairs_activity,
            "transitions": all_transitions[:30],
            "calendar": calendar_summary,
            "generated_at": dashboard.get("generated_at"),
            "market_data_timestamp": dashboard.get("market_data_timestamp"),
        })

    # --- Browser Push Notification routes -------------------------------

    def _push_store(self) -> PushSubscriptionStore:
        store = getattr(_STATE, "push_subscription_store", None)
        if store is None:
            store = PushSubscriptionStore()
            if _STATE is not None:
                _STATE.push_subscription_store = store
        return store

    def _push_subscribe(self, body: dict) -> None:
        user = self._authenticate(self.headers)
        if not user:
            return self._error(401, "Unauthorized")
        endpoint = (body or {}).get("endpoint")
        keys = (body or {}).get("keys") or {}
        p256dh = keys.get("p256dh")
        auth = keys.get("auth")
        if not endpoint or not p256dh or not auth:
            return self._error(400, "endpoint, keys.p256dh, and keys.auth are required")
        expiration_time = (body or {}).get("expiration_time")
        sub = PushSubscription(
            endpoint=str(endpoint),
            p256dh=str(p256dh),
            auth=str(auth),
            user_id=int(user.id),
            expiration_time=str(expiration_time) if expiration_time else None,
        )
        self._push_store().add(sub)
        logger.info("Push subscription saved for user %s: %s", user.id, endpoint[:60])
        self._json(200, {"ok": True})

    def _push_unsubscribe(self, body: dict) -> None:
        user = self._authenticate(self.headers)
        if not user:
            return self._error(401, "Unauthorized")
        endpoint = (body or {}).get("endpoint")
        if not endpoint:
            return self._error(400, "endpoint is required")
        removed = self._push_store().remove(int(user.id), str(endpoint))
        self._json(200, {"ok": removed})

    def _push_list_subscriptions(self) -> None:
        user = self._authenticate(self.headers)
        if not user:
            return self._error(401, "Unauthorized")
        subs = self._push_store().list_for_user(int(user.id))
        self._json(200, {
            "subscriptions": [
                {
                    "endpoint": s.endpoint,
                    "created_at": s.created_at,
                    "expiration_time": s.expiration_time,
                }
                for s in subs
            ]
        })

    def _push_send_alert(self, user_id: int, alert_type: str, pair: str, title: str, body: str, severity: str = "info") -> None:
        """Send a push notification to all of a user's subscribed browsers."""
        if not push_is_configured():
            return
        store = self._push_store()
        subs = store.list_for_user(user_id)
        for sub in subs:
            send_alert_push(
                endpoint=sub.endpoint,
                p256dh=sub.p256dh,
                auth=sub.auth,
                alert_type=alert_type,
                pair=pair,
                title=title,
                body=body,
                severity=severity,
                url=f"/tradingview?symbol={pair}",
            )

    # --- Telegram bot routes --------------------------------------------

    def _telegram_bot(self) -> Optional[TelegramBot]:
        return getattr(_STATE, "telegram_bot", None)

    def _telegram_status(self) -> None:
        """Public GET describing whether the Telegram bot is wired."""
        bot = self._telegram_bot()
        if bot is None:
            self._json(200, {"configured": False})
            return
        self._json(200, {
            "configured": bool(bot.is_configured),
            "username": bot.bot_username or None,
            "webhook_secret_set": bool(bot.webhook_secret),
        })

    def _telegram_webhook(self, body: dict) -> None:
        """Receive a Telegram Update from the Bot API webhook."""
        bot = self._telegram_bot()
        if bot is None or not bot.is_configured:
            return self._error(503, "telegram bot not configured")
        if not bot.verify_webhook_secret(self.headers):
            return self._error(403, "invalid webhook secret")
        if not isinstance(body, dict):
            return self._error(400, "expected JSON object body")
        try:
            response_text = bot.handle_update(body, _STATE)
        except Exception:
            logging.exception("telegram webhook handler crashed")
            return self._error(500, "handler error")
        if response_text:
            chat_id = (body.get("message") or body.get("edited_message") or {}).get("chat", {}).get("id")
            if chat_id is not None:
                bot.send_message(chat_id, response_text)
        self._json(200, {"ok": True})

    def _telegram_link_token(self, body: dict) -> None:
        """Mint a one-time link token for the authenticated user."""
        bot = self._telegram_bot()
        if bot is None or not bot.is_configured:
            return self._error(503, "telegram bot not configured")
        user = self._authenticate(self.headers)
        if not user:
            return self._error(401, "Unauthorized")
        token = bot.mint_link_token(int(user.id))
        self._json(200, {
            "token": token,
            "deep_link": bot.deep_link(token),
            "bot_username": bot.bot_username or None,
            "expires_in_seconds": 600,
        })

    def _telegram_register_webhook(self, body: dict) -> None:
        """Call ``setWebhook`` against the bot for the current deployment."""
        bot = self._telegram_bot()
        if bot is None or not bot.is_configured:
            return self._error(503, "telegram bot not configured")
        user = self._authenticate(self.headers)
        if not user:
            return self._error(401, "Unauthorized")
        if getattr(user, "role", "") != "admin":
            return self._error(403, "Admin role required for this operation")
        body = body or {}
        base = (body.get("public_base_url") or os.environ.get("PUBLIC_BASE_URL", "")).rstrip("/")
        if not base:
            return self._error(400, "public_base_url is required (or set PUBLIC_BASE_URL)")
        url = f"{base}/api/telegram/webhook"
        result = bot.set_webhook(url)
        if result is None:
            return self._error(502, "telegram api call failed")
        info = bot.get_webhook_info() or {}
        self._json(200, {"set_webhook": result, "webhook_info": info})


    def _evaluate_and_persist_alerts(
        self,
        analysis: dict,
        new_trade: Optional[dict] = None,
    ) -> None:
        """Evaluate, durably de-duplicate, persist, and deliver alerts."""
        store = self._alert_store()
        user_ids = list(store.all_user_ids())
        pair = str(analysis.get("pair") or "").upper()
        last_analysis = _STATE.last_analysis_by_pair.get(pair) if hasattr(_STATE, "last_analysis_by_pair") else None
        try:
            calendar = analysis.get("economic_calendar") or {}
        except Exception:
            calendar = {}
        bot = getattr(_STATE, "telegram_bot", None)
        repo = getattr(_STATE, "alert_repo", None)

        for uid in user_ids:
            prefs = store.get(int(uid))
            if prefs is None:
                continue
            events = evaluate_rules(prefs, analysis, calendar=calendar, last_analysis=last_analysis)
            if new_trade is not None:
                # NEW_TRADE is the single user-facing confirmation for a newly
                # published call. Suppress the older generic confirmation event
                # on that same cycle so Telegram receives one clear message.
                events = [event for event in events if event.alert_type != "confirmation"]
                events.extend(evaluate_new_trade(prefs, new_trade))
            if not events:
                continue
            event_dicts = [event.to_dict() for event in events]
            deliverable = event_dicts
            if repo is not None and hasattr(repo, "save_events"):
                try:
                    saved = repo.save_events(event_dicts)
                    deliverable = list(saved) if saved is not None else event_dicts
                except Exception:
                    logging.exception("alert_repo.save_events failed for user %s", uid)
                    deliverable = self._claim_in_memory_alerts(event_dicts)
            else:
                deliverable = self._claim_in_memory_alerts(event_dicts)

            if bot is not None:
                for event in deliverable:
                    try:
                        bot.dispatch_event(event, prefs)
                    except Exception:
                        logging.exception("telegram dispatch failed for user %s", uid)

            # Dispatch browser push notifications
            if "push" in prefs.delivery_channels or "in_app" in prefs.delivery_channels:
                for event in deliverable:
                    try:
                        self._push_send_alert(
                            user_id=int(uid),
                            alert_type=event.get("alert_type", ""),
                            pair=event.get("pair", ""),
                            title=event.get("title", "ConfluenceX Alert"),
                            body=event.get("body", ""),
                            severity=event.get("severity", "info"),
                        )
                    except Exception:
                        logging.exception("push dispatch failed for user %s", uid)

        try:
            if hasattr(_STATE, "last_analysis_by_pair"):
                _STATE.last_analysis_by_pair[pair] = analysis
        except Exception:
            pass

    def _claim_in_memory_alerts(self, events: list[dict]) -> list[dict]:
        """Fallback event de-duplication for local/no-database deployments."""
        claimed: list[dict] = []
        with _STATE.cache_lock:
            for event in events:
                key = alert_event_key(event)
                if key in _STATE.alert_event_keys:
                    continue
                _STATE.alert_event_keys.add(key)
                # Fallback-only cache: bound memory if durable storage is down.
                while len(_STATE.alert_event_keys) > 5000:
                    _STATE.alert_event_keys.pop()
                claimed.append({**event, "event_key": key})
        return claimed

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

    def _performance_stats(self, query: dict) -> None:
        repo = _STATE.closed_trade_repo
        if repo is None:
            return self._json(200, {
                "source": "backtested",
                "sampleSize": 0,
                "dateRange": "N/A",
                "lastUpdated": datetime.now(timezone.utc).isoformat(),
                "winRate": 0,
                "tp1HitRate": 0,
                "tp2HitRate": 0,
                "tp3HitRate": 0,
                "stopLossRate": 0,
                "breakEvenRate": 0,
                "expirationRate": 0,
                "avgR": 0,
                "medianR": 0,
                "expectancy": 0,
                "profitFactor": 0,
                "maxDrawdown": 0,
                "maxConsecutiveLosses": 0,
                "mfe": 0,
                "mae": 0,
                "avgHoldingBars": 0,
                "avgTimeToTP1": 0,
                "avgTimeToStop": 0,
                "note": "closed_trade_repo not configured"
            })
        try:
            stats = repo.stats()
            trades = repo.recent(limit=10000)
            if not trades:
                return self._json(200, {
                    "source": "user_journal",
                    "sampleSize": 0,
                    "dateRange": "No data",
                    "lastUpdated": datetime.now(timezone.utc).isoformat(),
                    "winRate": 0,
                    "tp1HitRate": 0,
                    "tp2HitRate": 0,
                    "tp3HitRate": 0,
                    "stopLossRate": 0,
                    "breakEvenRate": 0,
                    "expirationRate": 0,
                    "avgR": 0,
                    "medianR": 0,
                    "expectancy": 0,
                    "profitFactor": 0,
                    "maxDrawdown": 0,
                    "maxConsecutiveLosses": 0,
                    "mfe": 0,
                    "mae": 0,
                    "avgHoldingBars": 0,
                    "avgTimeToTP1": 0,
                    "avgTimeToStop": 0,
                })
            wins = [t for t in trades if t.get('r_multiple', 0) > 0]
            losses = [t for t in trades if t.get('r_multiple', 0) < 0]
            tp1_hits = len([t for t in trades if t.get('outcome', '').endswith('tp1')])
            tp2_hits = len([t for t in trades if t.get('outcome', '').endswith('tp2')])
            tp3_hits = len([t for t in trades if t.get('outcome', '').endswith('tp3')])
            stop_hits = len([t for t in trades if t.get('outcome', '') == 'stopped'])
            be_hits = len([t for t in trades if t.get('outcome', '') == 'break_even'])
            expired = len([t for t in trades if t.get('outcome', '') == 'expired'])
            total = len(trades)
            r_values = [t.get('r_multiple', 0) for t in trades]
            avg_r = sum(r_values) / total if total > 0 else 0
            median_r = sorted(r_values)[total // 2] if total > 0 else 0
            expectancy = avg_r
            profit_factor = (sum(t.get('r_multiple', 0) for t in wins) / abs(sum(t.get('r_multiple', 0) for t in losses))) if losses else 0
            max_dd = 0
            cumulative = 0
            peak = 0
            for r in r_values:
                cumulative += r
                if cumulative > peak:
                    peak = cumulative
                dd = peak - cumulative
                if dd > max_dd:
                    max_dd = dd
            max_consecutive = 0
            current_streak = 0
            for r in r_values:
                if r < 0:
                    current_streak += 1
                    if current_streak > max_consecutive:
                        max_consecutive = current_streak
                else:
                    current_streak = 0
            holding_bars = [t.get('holding_bars', 0) for t in trades if t.get('holding_bars')]
            avg_holding = sum(holding_bars) / len(holding_bars) if holding_bars else 0
            times_to_tp1 = [t.get('bars_to_tp1', 0) for t in trades if t.get('bars_to_tp1')]
            avg_tp1 = sum(times_to_tp1) / len(times_to_tp1) if times_to_tp1 else 0
            times_to_stop = [t.get('bars_to_stop', 0) for t in trades if t.get('bars_to_stop')]
            avg_stop = sum(times_to_stop) / len(times_to_stop) if times_to_stop else 0
            mfe = max(r_values) if r_values else 0
            mae = min(r_values) if r_values else 0
            dates = [t.get('closed_at') for t in trades if t.get('closed_at')]
            date_range = "All time"
            if dates:
                try:
                    dmin = datetime.fromtimestamp(min(dates), tz=timezone.utc).strftime('%Y-%m-%d')
                    dmax = datetime.fromtimestamp(max(dates), tz=timezone.utc).strftime('%Y-%m-%d')
                    date_range = f"{dmin} to {dmax}"
                except Exception:
                    pass
            self._json(200, {
                "source": "user_journal",
                "sampleSize": total,
                "dateRange": date_range,
                "lastUpdated": datetime.now(timezone.utc).isoformat(),
                "winRate": (len(wins) / total * 100) if total > 0 else 0,
                "tp1HitRate": (tp1_hits / total * 100) if total > 0 else 0,
                "tp2HitRate": (tp2_hits / total * 100) if total > 0 else 0,
                "tp3HitRate": (tp3_hits / total * 100) if total > 0 else 0,
                "stopLossRate": (stop_hits / total * 100) if total > 0 else 0,
                "breakEvenRate": (be_hits / total * 100) if total > 0 else 0,
                "expirationRate": (expired / total * 100) if total > 0 else 0,
                "avgR": avg_r,
                "medianR": median_r,
                "expectancy": expectancy,
                "profitFactor": profit_factor,
                "maxDrawdown": max_dd,
                "maxConsecutiveLosses": max_consecutive,
                "mfe": mfe,
                "mae": mae,
                "avgHoldingBars": avg_holding,
                "avgTimeToTP1": avg_tp1,
                "avgTimeToStop": avg_stop,
            })
        except Exception as exc:
            return self._error(500, f"performance stats unavailable: {exc}")

    def _validation_report(self, query: dict) -> None:
        """Return live outcome calibration without treating scenario weights as probabilities."""
        repo = _STATE.repository
        limit = _clamp_int(query.get("limit"), default=5000, lo=100, hi=20000)
        if not hasattr(repo, "forecast_rows"):
            return self._json(200, {
                "status": "INSUFFICIENT_DATA", "pending": 0, "resolved": 0,
                "calibration": calibration_report([]), "segments": {},
                "walk_forward": walk_forward_report([]),
                "warning": "Outcome ledger is not configured. Scenario weights remain uncalibrated and cannot drive sizing.",
            })
        try:
            rows = repo.forecast_rows(limit=limit)
            resolved = [row for row in rows if row.get("outcome") is not None]
            dimensions = ("pair", "timeframe", "volatility_regime", "session", "setup_type")
            report = calibration_report(resolved)
            status = "CALIBRATED" if report.get("calibrated") else "INSUFFICIENT_DATA"
            return self._json(200, {
                "status": status,
                "pending": len(rows) - len(resolved),
                "resolved": len(resolved),
                "calibration": report,
                "segments": grouped_calibration(resolved, dimensions),
                "walk_forward": walk_forward_report(resolved),
                "warning": "Scenario weights are not forecast probabilities and never drive sizing until this report reaches a defensible calibrated sample.",
                "dimensions": list(dimensions),
            })
        except Exception as exc:
            return self._error(500, f"validation report unavailable: {exc}")

    # --- Autonomy endpoints ---

    def _autonomy_status(self) -> None:
        """Return autonomy system status."""
        try:
            from .autonomy import get_autonomy_status, get_autonomy_config
            status = get_autonomy_status()
            config = get_autonomy_config()
            return self._json(200, {
                'mode': config.mode.value,
                'health': status.health.overall.value,
                'components': {
                    'market_data': status.health.market_data.value,
                    'database': status.health.database.value,
                    'scanner': status.health.scanner.value,
                    'news': status.health.news.value,
                    'execution': status.health.execution.value,
                    'alerts': status.health.alerts.value,
                },
                'active_setups': status.active_setups,
                'active_positions': status.active_positions,
                'last_scan_time': status.last_scan_time,
                'scan_count': status.instruments_scanned,
                'engine_version': config.engine_version,
            })
        except Exception as exc:
            return self._error(500, f'autonomy status unavailable: {exc}')

    def _autonomy_setups(self, query: dict) -> None:
        """Return active setups from Postgres."""
        try:
            repo = _STATE.repository
            if not hasattr(repo, '_get_connection'):
                return self._json(200, {'setups': [], 'total': 0, 'message': 'Database not available'})
            limit = _clamp_int(query.get('limit'), default=50, lo=1, hi=200)
            state_filter = str(query.get('state') or '').upper() or None
            with repo._get_connection() as conn:
                with conn.cursor() as cur:
                    if state_filter:
                        cur.execute(
                            "SELECT * FROM autonomy_setups WHERE state = %s ORDER BY score DESC LIMIT %s",
                            (state_filter.lower(), limit),
                        )
                    else:
                        cur.execute(
                            "SELECT * FROM autonomy_setups WHERE state NOT IN ('closed','invalidated','expired','cancelled') ORDER BY score DESC LIMIT %s",
                            (limit,),
                        )
                    rows = cur.fetchall()
            return self._json(200, {'setups': rows, 'total': len(rows)})
        except Exception as exc:
            return self._error(500, f'autonomy setups unavailable: {exc}')

    def _autonomy_opportunities(self, query: dict) -> None:
        """Return ranked opportunities from active setups."""
        try:
            repo = _STATE.repository
            if not hasattr(repo, '_get_connection'):
                return self._json(200, {'opportunities': [], 'total': 0})
            with repo._get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT setup_id, symbol, direction, score, state, "
                        "entry_low, stop_loss, tp1, tp2, tp3, market_regime, session, "
                        "data_quality, detected_at, updated_at "
                        "FROM autonomy_setups WHERE state NOT IN ('closed','invalidated','expired','cancelled') "
                        "ORDER BY score DESC LIMIT 20"
                    )
                    rows = cur.fetchall()
            return self._json(200, {'opportunities': rows, 'total': len(rows)})
        except Exception as exc:
            return self._error(500, f'autonomy opportunities unavailable: {exc}')

    def _autonomy_journal(self, query: dict) -> None:
        """Return journal entries from Postgres."""
        try:
            repo = _STATE.repository
            if not hasattr(repo, '_get_connection'):
                return self._json(200, {'entries': [], 'total': 0, 'stats': {}})
            limit = _clamp_int(query.get('limit'), default=50, lo=1, hi=200)
            with repo._get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT * FROM journal_entries ORDER BY detected_at DESC LIMIT %s",
                        (limit,),
                    )
                    rows = cur.fetchall()
            return self._json(200, {'entries': rows, 'total': len(rows)})
        except Exception as exc:
            return self._error(500, f'autonomy journal unavailable: {exc}')

    def _autonomy_regime(self, query: dict) -> None:
        """Return latest regime snapshot from market memory."""
        try:
            repo = _STATE.repository
            if not hasattr(repo, '_get_connection'):
                return self._json(200, {'regimes': {}})
            with repo._get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT DISTINCT ON (symbol) symbol, regime, trend, volatility, "
                        "price, timestamp FROM market_snapshots ORDER BY symbol, timestamp DESC"
                    )
                    rows = cur.fetchall()
            regimes = {r['symbol']: r for r in rows}
            return self._json(200, {'regimes': regimes})
        except Exception as exc:
            return self._error(500, f'autonomy regime unavailable: {exc}')

    def _autonomy_news(self) -> None:
        """Return upcoming news events from calendar."""
        try:
            repo = _STATE.repository
            if not hasattr(repo, '_get_connection'):
                return self._json(200, {'total_upcoming': 0, 'events': []})
            with repo._get_connection() as conn:
                with conn.cursor() as cur:
                    # Try reading from the calendar events table if it exists
                    try:
                        cur.execute(
                            "SELECT * FROM calendar_events WHERE scheduled_at > NOW() "
                            "ORDER BY scheduled_at LIMIT 20"
                        )
                        rows = cur.fetchall()
                    except Exception:
                        rows = []
            return self._json(200, {
                'total_upcoming': len(rows),
                'events': rows,
            })
        except Exception as exc:
            return self._error(500, f'autonomy news unavailable: {exc}')

    def _autonomy_alerts(self, query: dict) -> None:
        """Return recent alert events."""
        try:
            repo = _STATE.repository
            if not hasattr(repo, '_get_connection'):
                return self._json(200, {'alerts': [], 'total': 0})
            limit = _clamp_int(query.get('limit'), default=20, lo=1, hi=100)
            with repo._get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT * FROM alert_events ORDER BY created_at DESC LIMIT %s",
                        (limit,),
                    )
                    rows = cur.fetchall()
            return self._json(200, {'alerts': rows, 'total': len(rows)})
        except Exception as exc:
            return self._error(500, f'autonomy alerts unavailable: {exc}')

    def _autonomy_activity(self, query: dict) -> None:
        """Return autonomous activity feed (real-time decision timeline)."""
        try:
            from .autonomy.loop import get_activity_feed
            feed = get_activity_feed()
            limit = _clamp_int(query.get('limit'), default=50, lo=1, hi=200)
            category = str(query.get('category') or '') or None
            entries = feed.get_recent(limit=limit, category=category)
            return self._json(200, {'entries': entries, 'total': len(entries)})
        except Exception as exc:
            return self._error(500, f'autonomy activity unavailable: {exc}')

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

    # The dashboard snapshot is expensive to build (full analysis for every
    # recent market). Serve it stale-while-revalidate so the dashboard always
    # loads in well under the 12s frontend watchdog: return the last payload
    # immediately and refresh it in the background when it goes stale.
    _DASHBOARD_CACHE_TTL = 30.0

    def _dashboard_snapshot(self) -> None:
        now = time.monotonic()
        with _STATE.cache_lock:
            payload = _STATE.dashboard_cache.get("payload")
            stale = payload is not None and (now - _STATE.dashboard_cache.get("built_at", 0.0)) > self._DASHBOARD_CACHE_TTL
            building = _STATE.dashboard_cache.get("building", False)
        if payload is not None:
            self._json(200, payload)
            if stale and not building:
                self._spawn_dashboard_refresh()
            return
        # First-ever build (pre-warm missed): assemble once synchronously, then
        # every subsequent load is instant.
        payload = self._build_dashboard_payload()
        with _STATE.cache_lock:
            _STATE.dashboard_cache["payload"] = payload
            _STATE.dashboard_cache["built_at"] = time.monotonic()
            _STATE.dashboard_cache["building"] = False
        self._json(200, payload)

    def _spawn_dashboard_refresh(self) -> None:
        with _STATE.cache_lock:
            if _STATE.dashboard_cache.get("building"):
                return
            _STATE.dashboard_cache["building"] = True
        threading.Thread(target=self._refresh_dashboard_cache, name="dashboard-refresh", daemon=True).start()

    def _refresh_dashboard_cache(self) -> None:
        try:
            payload = self._build_dashboard_payload()
            with _STATE.cache_lock:
                _STATE.dashboard_cache["payload"] = payload
                _STATE.dashboard_cache["built_at"] = time.monotonic()
        except Exception:
            logging.exception("dashboard snapshot background refresh failed")
        finally:
            with _STATE.cache_lock:
                _STATE.dashboard_cache["building"] = False

    def _build_dashboard_payload(self) -> dict:
        snapshot_id = str(uuid.uuid4())
        generated_at = datetime.now(timezone.utc).isoformat()

        health = self._get_health_data()
        config = self._get_config_data()
        recent_signals = _STATE.repository.recent(limit=max(200, len(_STATE.config.pairs) * 10))

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

        # Dashboard should represent the current market universe, not the last
        # N historical signal rows. Collapse stored signals to one latest row per
        # configured pair, compute fresh analysis once, and synthesize a clean
        # read-only signal shell when the repository has no useful row.
        latest_signal_by_pair: dict = {}
        for sig in recent_signals:
            pair = str(sig.get("pair") or "").upper()
            if pair and pair not in latest_signal_by_pair:
                latest_signal_by_pair[pair] = self._sanitize_dashboard_signal(sig)

        snapshots = []
        for pair in list(_STATE.config.pairs):
            pair = str(pair).upper()
            if not pair:
                continue
            analysis = self._compute_analysis(pair)
            signal = latest_signal_by_pair.get(pair) or self._signal_from_analysis(pair, analysis, generated_at)
            snapshots.append({
                "signal": signal,
                "analysis": analysis,
                "market_info": self._get_market_info(pair),
                "lifecycle_state": self._get_lifecycle_state(analysis),
                "recent_transitions": self._get_recent_transitions(analysis),
                "score_history": self._get_score_history(pair),
            })

        return {
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
        }

    def _sanitize_dashboard_signal(self, sig: dict) -> dict:
        clean = dict(sig or {})
        for key in ("entry", "stop_loss", "tp1", "tp2", "tp3"):
            try:
                value = float(clean.get(key) or 0)
            except (TypeError, ValueError):
                value = 0.0
            if not value:
                clean[key] = None
        clean["pair"] = str(clean.get("pair") or "").upper()
        return clean

    def _signal_from_analysis(self, pair: str, analysis: dict, generated_at: str) -> dict:
        plan = analysis.get("trade_plan") or {}
        direction = analysis.get("direction") or "NEUTRAL"
        score = int(analysis.get("total_score") or 0)
        status = plan.get("status") or "WAIT"
        tier = "STRONG" if status in ("STRONG", "VALID") else "WATCHLIST" if score >= 50 else "NO_TRADE"
        targets = plan.get("targets") or []
        return {
            "id": 0,
            "created_at": generated_at,
            "pair": pair,
            "direction": direction,
            "tier": tier,
            "confidence_score": score,
            "entry": plan.get("entry"),
            "stop_loss": plan.get("stop") or plan.get("invalidation"),
            "tp1": (targets[0] or {}).get("price") if len(targets) > 0 else plan.get("tp1"),
            "tp2": (targets[1] or {}).get("price") if len(targets) > 1 else plan.get("tp2"),
            "tp3": (targets[2] or {}).get("price") if len(targets) > 2 else plan.get("tp3"),
            "risk_level": "High" if plan.get("eligible") is not True else "Managed",
            "session": ((plan.get("timing") or {}).get("session") or {}).get("name") or "Current",
            "adr_status": "available" if (plan.get("daily_range") or {}) else "unknown",
            "htf_bias": (analysis.get("market_context") or {}).get("macro_bias") or "neutral",
            "pattern": (analysis.get("scenarios") or {}).get("primary") or "forming",
            "reasons": [r.get("message") for r in (plan.get("reasons") or []) if isinstance(r, dict) and r.get("message")][:3],
        }

    def _get_health_data(self) -> dict:
        try:
            n = _count(_STATE.repository)
        except Exception:
            n = 0
        calendar_health = getattr(_STATE.news_filter, "source_health", "unconfigured") if _STATE.news_filter else "unconfigured"
        # source_health is emitted uppercase ("LIVE"/"STALE"/"UNAVAILABLE") while
        # the unconfigured sentinel is lowercase — compare case-insensitively or
        # a dead calendar feed still reports the service as ready.
        ready = _STATE.market_client is not None and str(calendar_health).lower() not in ("unavailable", "unconfigured")
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
        # Cache the full H1 analysis so the dashboard loop and the 30s
        # auto-refresh reuse work instead of recomputing every market on every
        # call. Stale values are still served on transient errors.
        cache_key = f"analysis:{pair}:H1"
        cached = self._cache_get(cache_key)
        if cached is not None:
            body = dict(cached)
            cache_meta = dict(body.get("cache") or {})
            if (body.get("data_quality") or {}).get("data_stale"):
                cache_meta.update({"stale": True, "reason": "underlying market candles are stale"})
            body["cache"] = cache_meta or {"stale": False}
            return body
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
            calendar_status = calendar.get("status", "UNAVAILABLE")
            if calendar_status in ("BLOCKED", "POST_NEWS"):
                timing["status"] = "AVOID"
                timing.setdefault("wait_for", []).append(f"calendar {calendar_status}")
            elif calendar_status == "UNAVAILABLE":
                # Calendar feed unreachable. Note the degradation but do not
                # park every market in WAIT — an upstream outage would
                # otherwise mute the whole product with no visible cause.
                timing["calendar_degraded"] = True
            elif calendar_status != "CLEAR":
                timing["status"] = "WAIT"
                timing.setdefault("wait_for", []).append(f"calendar {calendar_status}")
            analysis["trade_timing"] = timing
            if timing.get("status") == "READY" and signal_stable:
                analysis["direction_stability"]["lifecycle"] = "READY"
            if selected_candles:
                analysis["zones"]["setup_zones"] = _build_setup_zones(price=float(selected_candles[-1].close), atr_value=analysis.get("indicators", {}).get("atr"), zones=analysis.get("zones", {}), indicators=analysis.get("indicators", {}), direction=analysis.get("direction", "NEUTRAL"), market_context=analysis.get("market_context", {}), trade_timing=analysis.get("trade_timing", {}))
            analysis["trade_plan"] = build_trade_plan(snapshot, analysis, calendar, primary_candles=selected_candles)
            enrich_with_plan(analysis)
            self._attach_institutional_block(analysis, snapshot, "H1")
            analysis = attach_decision_quality(analysis, calendar=calendar)
            self._publish_actionable_analysis(analysis)
            data_stale = bool((analysis.get("data_quality") or {}).get("data_stale"))
            analysis["cache"] = {"stale": data_stale, "ttl_seconds": 20, **({"reason": "underlying market candles are stale"} if data_stale else {})}
            self._cache_set(cache_key, analysis, ttl=20, stale_ttl=120)
            return analysis
        except Exception as exc:
            stale = self._cache_get(cache_key, allow_stale=True)
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

    def _get_lifecycle_state(self, analysis: dict) -> dict:
        """Report the lifecycle the engine actually computed.

        This used to return a literal {"state": "active", "since": <now>} for
        every market — a fabricated status that refreshed its own timestamp on
        each request. The real state is produced by stabilize_direction and
        already lives on the analysis.
        """
        stability = (analysis or {}).get("direction_stability") or {}
        lifecycle = stability.get("lifecycle") or (analysis or {}).get("lifecycle_state")
        if not lifecycle:
            return {"state": "unknown"}
        return {
            "state": str(lifecycle).lower(),
            "confirmed_direction": stability.get("confirmed_direction"),
            "since_bar_time": stability.get("last_change_time"),
            "reason": stability.get("reason"),
        }

    def _get_recent_transitions(self, analysis: dict) -> list:
        return list((analysis or {}).get("recent_transitions") or [])

    def _get_score_history(self, pair: str) -> dict:
        """Real scored history for the pair, from persisted scanner signals."""
        repo = _STATE.repository
        if not hasattr(repo, "by_pair"):
            return {"scores": [], "count": 0}
        try:
            rows = repo.by_pair(pair, limit=50)
        except Exception:
            logging.exception("score history lookup failed for %s", pair)
            return {"scores": [], "count": 0}
        scores = [
            {"score": row.get("confidence_score"), "at": row.get("created_at"), "tier": row.get("tier")}
            for row in rows
            if row.get("confidence_score") is not None
        ]
        scores.reverse()  # oldest first, for charting
        return {"scores": scores, "count": len(scores)}

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


def start_signal_monitor(
    state: ApiState,
    interval_seconds: Optional[int] = None,
) -> threading.Event:
    """Continuously refresh canonical V2 analyses even with no browser open.

    The refresh path is the same one used by the dashboard, so a newly eligible
    plan is published and dispatched without relying on a user page load. The
    default cadence follows SCAN_INTERVAL_SECONDS (five minutes in production),
    which is fast enough for H1 calls while respecting the FX data budget.
    """
    stop = threading.Event()
    if interval_seconds is None:
        raw = os.environ.get("SIGNAL_MONITOR_INTERVAL_SECONDS")
        try:
            interval_seconds = int(raw) if raw else int(state.config.scan_interval_seconds)
        except (TypeError, ValueError):
            interval_seconds = 300
    interval_seconds = max(25, int(interval_seconds))

    def run() -> None:
        handler = object.__new__(_ApiHandler)
        while not stop.is_set():
            should_refresh = False
            with state.cache_lock:
                if not state.dashboard_cache.get("building"):
                    state.dashboard_cache["building"] = True
                    should_refresh = True
            if should_refresh:
                try:
                    handler._refresh_dashboard_cache()
                except Exception:
                    logging.exception("background signal monitor refresh failed")
            stop.wait(interval_seconds)

    thread = threading.Thread(target=run, name="v2-signal-monitor", daemon=True)
    thread.start()
    logging.info("V2 signal monitor started (%ds cadence, %d pairs)", interval_seconds, len(state.config.pairs))
    return stop


def make_server(state: ApiState, host: str = "0.0.0.0", port: int = 8000) -> ThreadingHTTPServer:
    set_state(state)
    return ThreadingHTTPServer((host, port), _ApiHandler)
