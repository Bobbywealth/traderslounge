## Billing migrations

Run order is filename order. Each file is idempotent.

```bash
# Apply with psql
psql "$DATABASE_URL" -f db/migrations/001_billing.sql
```

The Express server also runs `001_billing.sql` on boot if `BILLING_RUN_MIGRATIONS=1`
is set, so manual application is only required for production deploys.

Tables:
- `stripe_customers` — maps app user id to Stripe customer id
- `subscriptions` — one row per Stripe subscription (latest snapshot wins)
- `webhook_events` — Stripe event id dedupe (idempotency)
- `founding_member_counter` — single-row counter for the 50-customer cap
- `billing_audit_log` — non-sensitive audit trail
