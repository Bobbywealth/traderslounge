"""HTTP API entrypoint — Render web service.

Usage (local):
    SIGNAL_DB_PATH=scanner.db python -m scanner.api_server

Usage (Render): set the start command on the web service to
`python -m scanner.api_server`. Reads the same SQLite file the
background worker writes to (mount a shared disk on Render or use
the Postgres backend in production).
"""
from __future__ import annotations

import logging
import os
import sys

from .api import ApiState, make_server
from .config import load_from_env
from .persistence import SQLiteRepository
from .postgres_repo import PostgresRepository, is_available as pg_available


def main() -> int:
    cfg = load_from_env()
    logging.basicConfig(
        level=cfg.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url and pg_available():
        logging.info("using Postgres at %s", _redact(db_url))
        repo = PostgresRepository(db_url)
    else:
        if db_url and not pg_available():
            logging.warning(
                "DATABASE_URL set but psycopg not installed — falling back to SQLite"
            )
        path = os.environ.get("SIGNAL_DB_PATH", "scanner.db")
        logging.info("using SQLite at %s", path)
        repo = SQLiteRepository(path)

    host = os.environ.get("API_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    state = ApiState(repository=repo, config=cfg)
    server = make_server(state, host=host, port=port)
    print(f"API listening on http://{host}:{port}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        repo.close()
    return 0


def _redact(url: str) -> str:
    """Hide password in a libpq DSN/URL for log output."""
    if "://" not in url:
        return url
    scheme, rest = url.split("://", 1)
    if "@" not in rest:
        return url
    creds, host = rest.split("@", 1)
    if ":" in creds:
        user = creds.split(":", 1)[0]
        creds = f"{user}:***"
    return f"{scheme}://{creds}@{host}"


if __name__ == "__main__":
    raise SystemExit(main())
