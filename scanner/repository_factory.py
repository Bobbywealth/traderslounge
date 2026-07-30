"""Select the durable signal repository from environment configuration."""
from __future__ import annotations

import logging
import os

from .persistence import SQLiteRepository
from .postgres_repo import PostgresRepository, is_available as pg_available

log = logging.getLogger(__name__)


def create_signal_repository():
    """Use Postgres when DATABASE_URL is configured, else local SQLite.

    A configured Postgres database is treated as required. We deliberately do
    not silently fall back to ephemeral SQLite if the driver or connection is
    broken, because that would make production signals appear persisted when
    they are not.
    """
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url:
        if not pg_available():
            raise RuntimeError(
                "DATABASE_URL is set but psycopg is not installed; refusing ephemeral SQLite fallback"
            )
        log.info("using Postgres at %s", _redact(db_url))
        return PostgresRepository(db_url)

    path = os.environ.get("SIGNAL_DB_PATH", "scanner.db")
    log.info("DATABASE_URL not set; using SQLite at %s", path)
    return SQLiteRepository(path)


def _redact(url: str) -> str:
    if "://" not in url:
        return "[configured]"
    scheme, rest = url.split("://", 1)
    if "@" not in rest:
        return f"{scheme}://[configured]"
    credentials, host = rest.rsplit("@", 1)
    user = credentials.split(":", 1)[0]
    return f"{scheme}://{user}:***@{host}"
