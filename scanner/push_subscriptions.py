"""Browser push subscription storage for ConfluenceX.

Stores Web Push subscriptions (endpoint + VAPID keys) per user so the
alert dispatcher can deliver browser push notifications when the user
is not actively on the site.

Storage mirrors the AlertPreferencesStore pattern: JSON files on disk
with a Postgres-backed repository override when DATABASE_URL is set.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)


@dataclass
class PushSubscription:
    """A single browser push subscription."""
    endpoint: str
    p256dh: str
    auth: str
    user_id: int
    expiration_time: str | None = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PushSubscription":
        return cls(
            endpoint=str(payload.get("endpoint", "")),
            p256dh=str(payload.get("p256dh", "")),
            auth=str(payload.get("auth", "")),
            user_id=int(payload.get("user_id", 0)),
            expiration_time=payload.get("expiration_time"),
            created_at=str(payload.get("created_at", datetime.now(timezone.utc).isoformat())),
        )


DEFAULT_STORE_DIR = Path(
    os.environ.get(
        "CONFLUENCEX_PUSH_STORE",
        str(Path.home() / ".openclaw" / "state" / "push_subscriptions"),
    )
)


class PushSubscriptionStore:
    """Durable push subscription CRUD with local-file fallback.

    Each user can have multiple subscriptions (multiple browsers/devices).
    Subscriptions are stored as ``user-{id}.json`` containing a JSON array.
    """

    def __init__(self, root: Path | str | None = None, repository: Any | None = None):
        self.root = Path(root) if root else DEFAULT_STORE_DIR
        self.repository = repository
        self._lock = threading.Lock()
        self._memory: dict[int, list[dict[str, Any]]] = {}
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            self._persist_ok = True
        except OSError as exc:
            logger.warning("push store could not create %s: %s — using in-memory", self.root, exc)
            self._persist_ok = False

    def _path_for(self, user_id: int) -> Path:
        return self.root / f"user-{int(user_id)}.json"

    def _atomic_write(self, path: Path, payload: str) -> None:
        fd, tmp = tempfile.mkstemp(prefix=".push-", dir=str(self.root))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
            os.replace(tmp, path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def _read_user(self, user_id: int) -> list[dict[str, Any]]:
        """Read all subscriptions for a user from disk or memory."""
        if self._persist_ok and self._path_for(user_id).exists():
            try:
                return json.loads(self._path_for(user_id).read_text("utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("push subs read failed for user %s: %s", user_id, exc)
        return self._memory.get(user_id, [])

    def _write_user(self, user_id: int, subs: list[dict[str, Any]]) -> None:
        """Write all subscriptions for a user to disk or memory."""
        if self._persist_ok:
            try:
                self._atomic_write(self._path_for(user_id), json.dumps(subs, indent=2))
            except OSError as exc:
                logger.warning("push subs write failed for user %s: %s", user_id, exc)
                self._memory[user_id] = subs
        else:
            self._memory[user_id] = subs

    # ---- CRUD -----------------------------------------------------------

    def add(self, sub: PushSubscription) -> PushSubscription:
        """Add or update a subscription for the user."""
        with self._lock:
            subs = self._read_user(sub.user_id)
            # Deduplicate by endpoint
            subs = [s for s in subs if s.get("endpoint") != sub.endpoint]
            subs.append(sub.to_dict())
            self._write_user(sub.user_id, subs)
        return sub

    def remove(self, user_id: int, endpoint: str) -> bool:
        """Remove a subscription by endpoint. Returns True if found."""
        with self._lock:
            subs = self._read_user(user_id)
            original_len = len(subs)
            subs = [s for s in subs if s.get("endpoint") != endpoint]
            if len(subs) < original_len:
                self._write_user(user_id, subs)
                return True
        return False

    def list_for_user(self, user_id: int) -> list[PushSubscription]:
        """List all subscriptions for a user."""
        with self._lock:
            subs = self._read_user(user_id)
            return [PushSubscription.from_dict(s) for s in subs]

    def remove_expired(self, user_id: int) -> int:
        """Remove expired subscriptions. Returns count removed."""
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            subs = self._read_user(user_id)
            active = []
            removed = 0
            for s in subs:
                exp = s.get("expiration_time")
                if exp and exp < now:
                    removed += 1
                else:
                    active.append(s)
            if removed > 0:
                self._write_user(user_id, subs)
            return removed

    def all_user_ids(self) -> Iterable[int]:
        """List all user IDs that have push subscriptions."""
        with self._lock:
            ids = set(self._memory.keys())
            if self._persist_ok and self.root.exists():
                for entry in self.root.glob("user-*.json"):
                    try:
                        ids.add(int(entry.stem.split("-", 1)[1]))
                    except (ValueError, IndexError):
                        continue
            return list(ids)
