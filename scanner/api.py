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
from typing import Optional
from urllib.parse import parse_qs, urlsplit

from .config import Config
from .persistence import SignalRepository

log = logging.getLogger(__name__)


@dataclass
class ApiState:
    """Container so the handler class can find runtime deps."""
    repository: SignalRepository
    config: Config


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
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

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
        if path == "/api/signals":
            return self._list_signals(query)
        if path.startswith("/api/signals/"):
            try:
                sig_id = int(path.rsplit("/", 1)[1])
            except ValueError:
                return self._error(400, "invalid signal id")
            return self._get_signal(sig_id)
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
