"""Select the durable signal repository from environment configuration."""
from __future__ import annotations

import logging
import os

from .persistence import SQLiteRepository
from .postgres_repo import (
    PostgresRepository,
    PostgresUserRepository,
    PostgresPositionRepository,
    PostgresClosedTradeRepository,
    PostgresTradeManagerStateRepository,
    PostgresLastAnalysisRepository,
    is_available as pg_available,
)

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


def create_user_repository(db_path: str | None = None):
    """Postgres when DATABASE_URL is set; SQLite fallback otherwise."""
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url and pg_available():
        log.info("user_repo: using Postgres at %s", _redact(db_url))
        return PostgresUserRepository(db_url)
    from .persistence import SQLiteUserRepository
    log.info("user_repo: DATABASE_URL not set; using SQLite at %s", db_path or "scanner.db")
    return SQLiteUserRepository(db_path or "scanner.db")


def create_position_repository(db_path: str | None = None):
    """Postgres when DATABASE_URL is set; SQLite fallback otherwise."""
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url and pg_available():
        log.info("position_repo: using Postgres at %s", _redact(db_url))
        return PostgresPositionRepository(db_url)
    from .trade_repo import SQLitePositionRepository
    log.info("position_repo: DATABASE_URL not set; using SQLite at %s", db_path or "scanner.db")
    return SQLitePositionRepository(db_path or "scanner.db")


def create_closed_trade_repository(db_path: str | None = None):
    """Postgres when DATABASE_URL is set; SQLite fallback otherwise."""
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url and pg_available():
        log.info("closed_trade_repo: using Postgres at %s", _redact(db_url))
        return PostgresClosedTradeRepository(db_url)
    from .trade_repo import SQLiteClosedTradeRepository
    log.info("closed_trade_repo: DATABASE_URL not set; using SQLite at %s", db_path or "scanner.db")
    return SQLiteClosedTradeRepository(db_path or "scanner.db")


def create_trade_manager_state_repository():
    """Returns PostgresTradeManagerStateRepository or None (in-memory fallback)."""
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url and pg_available():
        log.info("trade_manager_state_repo: using Postgres")
        return PostgresTradeManagerStateRepository(db_url)
    log.info("trade_manager_state_repo: DATABASE_URL not set; in-memory only")
    return None


def create_last_analysis_repository():
    """Returns PostgresLastAnalysisRepository or None (in-memory fallback)."""
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url and pg_available():
        log.info("last_analysis_repo: using Postgres")
        return PostgresLastAnalysisRepository(db_url)
    log.info("last_analysis_repo: DATABASE_URL not set; in-memory only")
    return None


def _redact(url: str) -> str:
    if "://" not in url:
        return "[configured]"
    scheme, rest = url.split("://", 1)
    if "@" not in rest:
        return f"{scheme}://[configured]"
    credentials, host = rest.rsplit("@", 1)
    user = credentials.split(":", 1)[0]
    return f"{scheme}://{user}:***@{host}"
