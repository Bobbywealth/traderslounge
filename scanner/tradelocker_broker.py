"""TradeLocker REST client implementing the Broker protocol.

Spec §9.1 endpoints:
    POST   /auth
    GET    /accounts
    POST   /orders
    PATCH  /orders/{id}
    DELETE /orders/{id}
    GET    /positions

Stdlib `urllib` only. Authentication caches the session token in memory
and re-auths on 401. Includes exponential backoff retry for transient
failures (network errors, 5xx, timeouts).

LIVE MONEY WARNING: this class is only instantiated when
EXECUTION_MODE=live is set explicitly. Until you've verified one round
trip on a demo account, keep paper mode.
"""
from __future__ import annotations

import itertools
import json
import logging
import random
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import List, Optional

from .broker import Position
from .data_types import Direction
from .risk_manager import TradePlan

log = logging.getLogger(__name__)

# Retry configuration
MAX_RETRY_ATTEMPTS = 3
RETRY_BACKOFF_BASE = 1.0  # seconds
RETRY_BACKOFF_MAX = 8.0  # seconds

# HTTP status codes that should trigger retry
RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


class TradeLockerError(RuntimeError):
    pass


@dataclass
class TradeLockerBroker:
    api_key: str
    api_secret: str
    base_url: str = "https://api.tradelocker.com"
    account_id: Optional[str] = None
    timeout_seconds: float = 15.0
    name: str = "tradelocker"
    _token: Optional[str] = None
    _balance_cache: float = 0.0
    _balance_cached_at: float = 0.0

    def _request(self, method: str, path: str, body: dict | None = None,
                 retry_on_401: bool = True, max_attempts: int = MAX_RETRY_ATTEMPTS) -> dict:
        """Make HTTP request with exponential backoff retry.
        
        Retries on:
        - Network errors (URLError)
        - Timeout errors
        - Retryable HTTP status codes (408, 429, 500-504)
        
        Does NOT retry on:
        - 401 (handled separately with re-auth)
        - 4xx client errors (except 408, 429)
        """
        url = f"{self.base_url.rstrip('/')}{path}"
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "bwts-scanner/0.1",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        data = json.dumps(body).encode() if body is not None else None
        
        last_exception = None
        
        for attempt in range(max_attempts):
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
                    payload = resp.read().decode("utf-8")
                
                if not payload:
                    return {}
                try:
                    return json.loads(payload)
                except json.JSONDecodeError as exc:
                    raise TradeLockerError(f"invalid JSON from {path}: {exc}") from exc
                    
            except urllib.error.HTTPError as exc:
                # Handle 401 separately with re-auth
                if exc.code == 401 and retry_on_401 and self._token is not None:
                    log.info("tradelocker 401 — re-authenticating")
                    self._token = None
                    self._auth()
                    return self._request(method, path, body, retry_on_401=False)
                
                # Check if status code is retryable
                if exc.code in RETRYABLE_STATUS_CODES and attempt < max_attempts - 1:
                    try:
                        err_body = exc.read().decode("utf-8")
                    except Exception:
                        err_body = ""
                    
                    # Calculate backoff with jitter
                    backoff = min(RETRY_BACKOFF_BASE * (2 ** attempt), RETRY_BACKOFF_MAX)
                    jitter = random.uniform(0, backoff * 0.1)
                    wait_time = backoff + jitter
                    
                    log.warning(
                        "tradelocker %d %s → %d (attempt %d/%d), retrying in %.1fs",
                        method, path, exc.code, attempt + 1, max_attempts, wait_time,
                    )
                    time.sleep(wait_time)
                    last_exception = exc
                    continue
                
                # Non-retryable HTTP error
                try:
                    err_body = exc.read().decode("utf-8")
                except Exception:
                    err_body = ""
                raise TradeLockerError(f"{method} {path} → {exc.code}: {err_body}") from exc
                
            except urllib.error.URLError as exc:
                # Network error - retryable
                if attempt < max_attempts - 1:
                    backoff = min(RETRY_BACKOFF_BASE * (2 ** attempt), RETRY_BACKOFF_MAX)
                    jitter = random.uniform(0, backoff * 0.1)
                    wait_time = backoff + jitter
                    
                    log.warning(
                        "tradelocker %s %s network error (attempt %d/%d), retrying in %.1fs: %s",
                        method, path, attempt + 1, max_attempts, wait_time, str(exc),
                    )
                    time.sleep(wait_time)
                    last_exception = exc
                    continue
                
                raise TradeLockerError(f"{method} {path}: {exc}") from exc
        
        # If we exhausted retries, raise the last exception
        if last_exception:
            if isinstance(last_exception, urllib.error.HTTPError):
                try:
                    err_body = last_exception.read().decode("utf-8")
                except Exception:
                    err_body = ""
                raise TradeLockerError(
                    f"{method} {path} → {last_exception.code} (after {max_attempts} attempts): {err_body}"
                ) from last_exception
            else:
                raise TradeLockerError(
                    f"{method} {path} failed after {max_attempts} attempts: {last_exception}"
                ) from last_exception

    def _auth(self) -> None:
        data = self._request("POST", "/auth", body={
            "apiKey": self.api_key,
            "apiSecret": self.api_secret,
        }, retry_on_401=False)
        token = data.get("token") or data.get("accessToken")
        if not token:
            raise TradeLockerError(f"No token in /auth response: {data}")
        self._token = token

    def ensure_authed(self) -> None:
        if self._token is None:
            self._auth()

    def place_market_order(self, plan: TradePlan) -> Position:
        self.ensure_authed()
        payload = {
            "accountId": self.account_id,
            "symbol": plan.pair,
            "side": "buy" if plan.direction == Direction.BUY else "sell",
            "type": "market",
            "quantity": plan.lot_size,
            "stopLoss": plan.stop_loss,
            "takeProfit": plan.tp1,  # initial TP1; TP2/TP3 handled via partial closes
        }
        resp = self._request("POST", "/orders", body=payload)
        pid = str(resp.get("orderId") or resp.get("id") or "")
        if not pid:
            raise TradeLockerError(f"No order id in response: {resp}")
        log.info("tradelocker open %s %s %.2f lots @ %s",
                 plan.pair, plan.direction.value, plan.lot_size, plan.entry)
        return Position(
            id=pid, pair=plan.pair, direction=plan.direction,
            lot_size=plan.lot_size, entry=plan.entry,
            stop_loss=plan.stop_loss, tp1=plan.tp1, tp2=plan.tp2, tp3=plan.tp3,
            opened_at=time.time(),
        )

    def modify_stop_loss(self, position_id: str, new_sl: float) -> None:
        self.ensure_authed()
        self._request("PATCH", f"/orders/{position_id}",
                      body={"stopLoss": new_sl})
        log.info("tradelocker modify SL %s → %s", position_id, new_sl)

    def close_position(self, position_id: str, fraction: float = 1.0) -> None:
        self.ensure_authed()
        if fraction >= 1.0:
            self._request("DELETE", f"/orders/{position_id}")
            log.info("tradelocker close %s (full)", position_id)
        else:
            # Partial close via order modification — broker-specific shape
            self._request("PATCH", f"/orders/{position_id}",
                          body={"closeFraction": fraction})
            log.info("tradelocker partial close %s @ %.0f%%", position_id, fraction * 100)

    def list_positions(self) -> List[Position]:
        self.ensure_authed()
        data = self._request("GET", "/positions")
        rows = data.get("positions", data) if isinstance(data, dict) else data
        out: List[Position] = []
        for r in rows or []:
            try:
                out.append(Position(
                    id=str(r.get("id") or r.get("orderId")),
                    pair=r.get("symbol", ""),
                    direction=Direction.BUY if r.get("side") == "buy" else Direction.SELL,
                    lot_size=float(r.get("quantity", 0)),
                    entry=float(r.get("entryPrice", r.get("price", 0))),
                    stop_loss=float(r.get("stopLoss", 0)),
                    tp1=float(r.get("takeProfit", 0)),
                    tp2=0.0, tp3=0.0,
                    opened_at=float(r.get("openedAt", time.time())),
                ))
            except (TypeError, ValueError):
                continue
        return out

    def get_balance(self) -> float:
        # Cache for 60s to avoid hammering /accounts
        if time.time() - self._balance_cached_at < 60:
            return self._balance_cache
        self.ensure_authed()
        data = self._request("GET", "/accounts")
        accounts = data.get("accounts", [data]) if isinstance(data, dict) else data
        balance = 0.0
        for acc in accounts or []:
            if self.account_id and str(acc.get("id")) != str(self.account_id):
                continue
            balance = float(acc.get("balance", acc.get("equity", 0)))
            break
        self._balance_cache = balance
        self._balance_cached_at = time.time()
        return balance
