"""Browser push notification delivery for ConfluenceX.

Uses the Web Push protocol (RFC 8291) via pywebpush to send native
browser notifications to subscribed devices. VAPID keys authenticate
the server to the push service (FCM, Mozilla, etc.).

Environment variables:
  VAPID_PUBLIC_KEY   — base64url-encoded public key
  VAPID_PRIVATE_KEY  — base64url-encoded private key
  VAPID_CLAIM_EMAIL  — contact email for VAPID claims (e.g. mailto:alerts@confluencex.com)
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_vapid_private_key: str | None = None
_vapid_public_key: str | None = None
_vapid_claims: dict[str, str] | None = None
_webpush_available: bool = False

try:
    from pywebpush import webpush, WebPushException  # type: ignore[import-untyped]
    _webpush_available = True
except ImportError:
    logger.info("pywebpush not installed — browser push notifications disabled")


def _load_vapid_config() -> bool:
    """Load VAPID keys from environment. Returns True if configured."""
    global _vapid_private_key, _vapid_public_key, _vapid_claims

    _vapid_private_key = os.environ.get("VAPID_PRIVATE_KEY")
    _vapid_public_key = os.environ.get("VAPID_PUBLIC_KEY")
    email = os.environ.get("VAPID_CLAIM_EMAIL", "mailto:alerts@confluencex.com")

    if not _vapid_private_key or not _vapid_public_key:
        logger.warning("VAPID keys not set — push notifications will not be sent")
        return False

    _vapid_claims = {"sub": email}
    return True


def is_configured() -> bool:
    """Check whether push delivery is available."""
    if not _webpush_available:
        return False
    if _vapid_private_key is None:
        _load_vapid_config()
    return bool(_vapid_private_key and _vapid_public_key)


def send_push(
    endpoint: str,
    p256dh: str,
    auth: str,
    payload: dict[str, Any],
    ttl: int = 86400,
) -> bool:
    """Send a push notification to a single subscription.

    Args:
        endpoint: The push service URL from the subscription.
        p256dh: The client's public key.
        auth: The client's auth secret.
        payload: The JSON payload to send (title, body, icon, etc.).
        ttl: Time-to-live in seconds (default 24 hours).

    Returns:
        True if the push was sent successfully.
    """
    if not is_configured():
        logger.debug("Push not configured, skipping send to %s", endpoint[:60])
        return False

    subscription_info = {
        "endpoint": endpoint,
        "keys": {
            "p256dh": p256dh,
            "auth": auth,
        },
    }

    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=_vapid_private_key,
            vapid_claims=_vapid_claims,
            ttl=ttl,
        )
        logger.info("Push sent to %s", endpoint[:60])
        return True
    except WebPushException as exc:
        # 410 Gone = subscription expired or unsubscribed
        if hasattr(exc, "response") and getattr(exc.response, "status_code", 0) == 410:
            logger.info("Push subscription expired (410): %s", endpoint[:60])
            return False
        logger.error("Push failed for %s: %s", endpoint[:60], exc)
        return False
    except Exception as exc:
        logger.error("Unexpected push error for %s: %s", endpoint[:60], exc)
        return False


def send_alert_push(
    endpoint: str,
    p256dh: str,
    auth: str,
    alert_type: str,
    pair: str,
    title: str,
    body: str,
    severity: str = "info",
    url: str = "/",
) -> bool:
    """Send a ConfluenceX alert as a browser push notification.

    This is the convenience wrapper the alert dispatcher calls.
    """
    payload = {
        "title": title,
        "body": body,
        "icon": "/confluencex-mark.svg",
        "badge": "/confluencex-mark.svg",
        "tag": f"confluencex-{alert_type}-{pair}",
        "url": url,
        "alertType": alert_type,
        "pair": pair,
        "severity": severity,
        "requireInteraction": severity == "critical",
        "actions": [
            {"action": "view", "title": "View"},
            {"action": "dismiss", "title": "Dismiss"},
        ],
    }

    return send_push(endpoint, p256dh, auth, payload)


def send_batch(
    subscriptions: list[dict[str, str]],
    payload: dict[str, Any],
    ttl: int = 86400,
) -> tuple[int, int]:
    """Send a push to multiple subscriptions.

    Args:
        subscriptions: List of dicts with endpoint, p256dh, auth keys.
        payload: The JSON payload.
        ttl: Time-to-live in seconds.

    Returns:
        Tuple of (sent_count, failed_count).
    """
    sent = 0
    failed = 0
    for sub in subscriptions:
        if send_push(
            endpoint=sub["endpoint"],
            p256dh=sub["p256dh"],
            auth=sub["auth"],
            payload=payload,
            ttl=ttl,
        ):
            sent += 1
        else:
            failed += 1
    return sent, failed
