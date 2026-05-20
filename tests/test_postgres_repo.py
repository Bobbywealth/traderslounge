"""Tests for the Postgres repo that don't require a live database.

When psycopg isn't installed we just verify the gating behavior and the
SQL schema text. Live integration is covered in CI once pypi is allow-
listed and we can install psycopg.
"""
import unittest

from scanner.postgres_repo import SCHEMA, PostgresRepository, is_available


class TestPostgresRepo(unittest.TestCase):
    def test_schema_includes_table_and_indexes(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS signals", SCHEMA)
        self.assertIn("idx_signals_pair_created", SCHEMA)
        self.assertIn("idx_signals_tier_created", SCHEMA)
        # JSONB reasons column (Postgres-specific)
        self.assertIn("reasons JSONB", SCHEMA)

    def test_raises_when_psycopg_missing(self):
        if is_available():
            self.skipTest("psycopg is installed — this guard is checked at import time")
        with self.assertRaises(RuntimeError):
            PostgresRepository("postgresql://example/db")


if __name__ == "__main__":
    unittest.main()
