-- ConfluenceX billing schema
-- Tables: stripe_customers, subscriptions, webhook_events, founding_member_counter
-- All entitlements are read from these tables. Never trust client input.

CREATE TABLE IF NOT EXISTS stripe_customers (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_customers_user_id
  ON stripe_customers (user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('pro_monthly', 'pro_annual', 'founding_monthly')),
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON subscriptions (user_id, status);

-- Webhook dedupe / idempotency
CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_type
  ON webhook_events (event_type);

-- Founding Member cap counter (single-row table)
CREATE TABLE IF NOT EXISTS founding_member_counter (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  count INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 50,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_subscription_id TEXT
);

INSERT INTO founding_member_counter (id, count, cap)
VALUES (1, 0, 50)
ON CONFLICT (id) DO NOTHING;

-- Audit trail for billing actions (no payment data, no PII beyond user id)
CREATE TABLE IF NOT EXISTS billing_audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL,
  subscription_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_audit_user
  ON billing_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_billing_audit_type
  ON billing_audit_log (event_type);
