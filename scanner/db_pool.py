"""Database connection pool with retry logic.

Provides a shared connection pool for all Postgres repositories,
with automatic reconnection and query timeout support.

Usage:
    from .db_pool import get_connection_pool, execute_with_retry

    pool = get_connection_pool()
    with pool.connection() as conn:
        result = conn.execute("SELECT ...")
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from typing import Any, Callable, Optional

log = logging.getLogger(__name__)

# Module-level singleton for the connection pool
_pool = None
_pool_lock = None

# Default pool configuration
DEFAULT_MIN_CONNECTIONS = 2
DEFAULT_MAX_CONNECTIONS = 10
DEFAULT_CONNECT_TIMEOUT = 10  # seconds
DEFAULT_QUERY_TIMEOUT = 30  # seconds

# Retry configuration
MAX_RETRY_ATTEMPTS = 3
RETRY_BACKOFF_BASE = 1.0  # seconds
RETRY_BACKOFF_MAX = 10.0  # seconds


def _get_pool_lock():
    """Get or create the pool lock (lazy import to avoid issues if psycopg not installed)."""
    global _pool_lock
    if _pool_lock is None:
        import threading
        _pool_lock = threading.Lock()
    return _pool_lock


def get_connection_pool():
    """Get or create the singleton connection pool.
    
    Returns None if psycopg is not installed or DATABASE_URL is not set.
    Uses psycopg_pool.ConnectionPool if available, otherwise falls back
    to a simple connection factory.
    """
    global _pool
    
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        log.warning("DATABASE_URL not set, database operations will fail")
        return None
    
    if _pool is not None:
        return _pool
    
    with _get_pool_lock():
        if _pool is not None:
            return _pool
        
        try:
            import psycopg
            from psycopg.rows import dict_row
            
            # Try to use psycopg_pool if available (preferred)
            try:
                from psycopg_pool import ConnectionPool
                
                min_conn = int(os.environ.get("DB_POOL_MIN", str(DEFAULT_MIN_CONNECTIONS)))
                max_conn = int(os.environ.get("DB_POOL_MAX", str(DEFAULT_MAX_CONNECTIONS)))
                
                _pool = ConnectionPool(
                    dsn,
                    min_size=min_conn,
                    max_size=max_conn,
                    kwargs={
                        "autocommit": True,
                        "row_factory": dict_row,
                        "connect_timeout": DEFAULT_CONNECT_TIMEOUT,
                    },
                )
                log.info(
                    "Created connection pool (min=%d, max=%d)",
                    min_conn,
                    max_conn,
                )
                return _pool
                
            except ImportError:
                log.info("psycopg_pool not available, using simple connection factory")
                
                # Fallback: create a simple connection factory
                class SimplePool:
                    """Simple connection wrapper that mimics psycopg_pool interface."""
                    
                    def __init__(self, dsn: str):
                        self._dsn = dsn
                        self._conn = None
                        self._lock = threading.Lock()
                    
                    def _get_connection(self):
                        if self._conn is None or self._conn.closed:
                            import psycopg
                            from psycopg.rows import dict_row
                            self._conn = psycopg.connect(
                                self._dsn,
                                autocommit=True,
                                row_factory=dict_row,
                                connect_timeout=DEFAULT_CONNECT_TIMEOUT,
                            )
                        return self._conn
                    
                    @contextmanager
                    def connection(self):
                        with self._lock:
                            conn = self._get_connection()
                            try:
                                yield conn
                            except Exception:
                                # On error, close and recreate connection
                                try:
                                    self._conn.close()
                                except Exception:
                                    pass
                                self._conn = None
                                raise
                
                import threading
                _pool = SimplePool(dsn)
                return _pool
                
        except ImportError:
            log.error("psycopg not installed, cannot create connection pool")
            return None


def execute_with_retry(
    operation: Callable,
    max_attempts: int = MAX_RETRY_ATTEMPTS,
    retryable_exceptions: tuple = (Exception,),
) -> Any:
    """Execute a database operation with exponential backoff retry.
    
    Args:
        operation: Callable that takes a connection and returns a result
        max_attempts: Maximum number of retry attempts
        retryable_exceptions: Tuple of exceptions that trigger retry
    
    Returns:
        Result of the operation
    
    Raises:
        Last exception if all retries fail
    """
    last_exception = None
    
    for attempt in range(max_attempts):
        try:
            pool = get_connection_pool()
            if pool is None:
                raise RuntimeError("Database pool not available")
            
            with pool.connection() as conn:
                # Set query timeout
                try:
                    conn.execute(
                        f"SET statement_timeout TO {DEFAULT_QUERY_TIMEOUT * 1000}"
                    )
                except Exception:
                    # Some connection types may not support this
                    pass
                
                return operation(conn)
                
        except retryable_exceptions as exc:
            last_exception = exc
            
            if attempt < max_attempts - 1:
                # Calculate backoff with jitter
                import random
                backoff = min(
                    RETRY_BACKOFF_BASE * (2 ** attempt),
                    RETRY_BACKOFF_MAX,
                )
                jitter = random.uniform(0, backoff * 0.1)
                wait_time = backoff + jitter
                
                log.warning(
                    "Database operation failed (attempt %d/%d), retrying in %.1fs: %s",
                    attempt + 1,
                    max_attempts,
                    wait_time,
                    str(exc),
                )
                time.sleep(wait_time)
            else:
                log.error(
                    "Database operation failed after %d attempts: %s",
                    max_attempts,
                    str(exc),
                )
    
    raise last_exception


def health_check() -> dict:
    """Check database health status.
    
    Returns:
        Dict with status and timing information
    """
    start_time = time.monotonic()
    
    try:
        pool = get_connection_pool()
        if pool is None:
            return {
                "status": "unavailable",
                "error": "Pool not initialized",
                "latency_ms": 0,
            }
        
        with pool.connection() as conn:
            result = conn.execute("SELECT 1 as ok")
            row = result.fetchone()
            
            latency_ms = (time.monotonic() - start_time) * 1000
            
            return {
                "status": "ok",
                "latency_ms": round(latency_ms, 2),
                "row": dict(row) if row else None,
            }
            
    except Exception as exc:
        latency_ms = (time.monotonic() - start_time) * 1000
        return {
            "status": "error",
            "error": str(exc),
            "latency_ms": round(latency_ms, 2),
        }


def close_pool():
    """Close the connection pool and clean up resources."""
    global _pool
    
    if _pool is not None:
        try:
            if hasattr(_pool, 'close'):
                _pool.close()
            elif hasattr(_pool, '_conn') and _pool._conn:
                _pool._conn.close()
        except Exception as exc:
            log.warning("Error closing connection pool: %s", exc)
        
        _pool = None
        log.info("Connection pool closed")
