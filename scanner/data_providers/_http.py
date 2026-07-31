"""Shared HTTP helper for the institutional data providers.

Stdlib-only urllib wrapper with:

  - 8-second default timeout per request
  - 3 attempts with exponential backoff (0.25s, 0.5s, 1.0s)
  - explicit User-Agent so providers can identify and rate-limit fairly
  - structured :class:`HttpError` carrying status code + URL + reason

Providers should always call these helpers instead of using urllib
directly so the retry / timeout policy is consistent.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple, Union

DEFAULT_TIMEOUT = 8.0
DEFAULT_RETRIES = 3
DEFAULT_USER_AGENT = "bwts-scanner/0.1 (institutional-research)"


class HttpError(Exception):
    """A non-recoverable HTTP failure with structured diagnostics."""

    def __init__(self, status: int, url: str, reason: str):
        self.status = int(status) if status else 0
        self.url = url
        self.reason = reason
        super().__init__(f"HTTP {self.status} {self.url}: {self.reason}")


def _request_once(url: str, timeout: float, user_agent: str,
                  headers: Optional[Dict[str, str]] = None
                 ) -> Tuple[int, bytes]:
    req_headers = {"User-Agent": user_agent, "Accept": "*/*"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        # Body is included so the provider can inspect a 4xx/5xx payload.
        try:
            body = exc.read()
        except Exception:  # pragma: no cover - defensive
            body = b""
        return exc.code, body
    except urllib.error.URLError as exc:
        return 0, str(exc.reason).encode("utf-8")


def get_text(
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    user_agent: str = DEFAULT_USER_AGENT,
    headers: Optional[Dict[str, str]] = None,
) -> str:
    """Return response body as text or raise :class:`HttpError`."""
    status, body = get_raw(url, timeout=timeout, retries=retries,
                           user_agent=user_agent, headers=headers)
    if status >= 400 or status == 0:
        reason = body.decode("utf-8", errors="replace")[:200]
        raise HttpError(status, url, reason)
    return body.decode("utf-8", errors="replace")


def get_json(
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    user_agent: str = DEFAULT_USER_AGENT,
    headers: Optional[Dict[str, str]] = None,
) -> Any:
    """Return parsed JSON body or raise :class:`HttpError`."""
    text = get_text(url, timeout=timeout, retries=retries,
                    user_agent=user_agent, headers=headers)
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise HttpError(200, url, f"invalid JSON: {exc}") from exc


def get_raw(
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    user_agent: str = DEFAULT_USER_AGENT,
    headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, bytes]:
    """Low-level retry loop; returns (status, body_bytes)."""
    last_error: Optional[BaseException] = None
    for attempt in range(retries):
        status, body = _request_once(url, timeout, user_agent, headers=headers)
        if status and status < 400:
            return status, body
        # 4xx other than 408/429 are unlikely to recover — fail fast.
        if 400 <= status < 500 and status not in (408, 425, 429):
            return status, body
        last_error = HttpError(status, url, body.decode("utf-8", errors="replace")[:120])
        if attempt < retries - 1:
            time.sleep(0.25 * (2 ** attempt))
    # Final attempt failed; surface as HttpError.
    if last_error is not None:
        if isinstance(last_error, HttpError):
            raise last_error
        raise HttpError(0, url, str(last_error)) from last_error
    raise HttpError(0, url, "retries exhausted")