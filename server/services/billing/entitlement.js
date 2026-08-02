// Entitlement and subscription persistence. Source of truth for paid access.

import { query } from './db.js';
import { ACCESS_GRANTING_STATUSES } from './plans.js';

export async function upsertStripeCustomer({ userId, stripeCustomerId, email }) {
  await query(
    `INSERT INTO stripe_customers (user_id, stripe_customer_id, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET stripe_customer_id = EXCLUDED.stripe_customer_id,
           email = EXCLUDED.email,
           updated_at = now()`,
    [userId, stripeCustomerId, email]
  );
}

export async function getStripeCustomerByUserId(userId) {
  const { rows } = await query(
    'SELECT stripe_customer_id, email FROM stripe_customers WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

export async function getActiveSubscription(userId) {
  const { rows } = await query(
    `SELECT s.id, s.user_id, s.stripe_subscription_id, s.stripe_customer_id,
            s.stripe_price_id, s.plan, s.status, s.current_period_end,
            s.cancel_at_period_end, s.canceled_at, s.started_at, s.ended_at,
            s.created_at, s.updated_at
       FROM subscriptions s
      WHERE s.user_id = $1
        AND s.status = ANY($2::text[])
      ORDER BY s.current_period_end DESC NULLS LAST, s.created_at DESC
      LIMIT 1`,
    [userId, Array.from(ACCESS_GRANTING_STATUSES)]
  );
  return rows[0] || null;
}

export async function getSubscriptionByStripeId(stripeSubscriptionId) {
  const { rows } = await query(
    'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1',
    [stripeSubscriptionId]
  );
  return rows[0] || null;
}

export async function getSubscriptionByCustomer(stripeCustomerId) {
  const { rows } = await query(
    `SELECT * FROM subscriptions
      WHERE stripe_customer_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [stripeCustomerId]
  );
  return rows[0] || null;
}

export async function upsertSubscription({
  userId,
  stripeSubscriptionId,
  stripeCustomerId,
  stripePriceId,
  plan,
  status,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  canceledAt,
  startedAt,
  endedAt,
}) {
  await query(
    `INSERT INTO subscriptions
       (user_id, stripe_subscription_id, stripe_customer_id, stripe_price_id,
        plan, status, current_period_end, cancel_at_period_end,
        canceled_at, started_at, ended_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (stripe_subscription_id) DO UPDATE
       SET stripe_price_id = EXCLUDED.stripe_price_id,
           plan = EXCLUDED.plan,
           status = EXCLUDED.status,
           current_period_end = EXCLUDED.current_period_end,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           canceled_at = EXCLUDED.canceled_at,
           started_at = EXCLUDED.started_at,
           ended_at = EXCLUDED.ended_at,
           updated_at = now()`,
    [
      userId,
      stripeSubscriptionId,
      stripeCustomerId,
      stripePriceId,
      plan,
      status,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      !!cancelAtPeriodEnd,
      canceledAt,
      startedAt,
      endedAt,
    ]
  );
}

export async function findUserIdByCustomer(stripeCustomerId) {
  const { rows } = await query(
    'SELECT user_id FROM stripe_customers WHERE stripe_customer_id = $1',
    [stripeCustomerId]
  );
  return rows[0]?.user_id || null;
}

export async function findUserIdBySubscription(stripeSubscriptionId) {
  const { rows } = await query(
    'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1',
    [stripeSubscriptionId]
  );
  return rows[0]?.user_id || null;
}

export function computeAccess(subscription) {
  if (!subscription) return { hasAccess: false, reason: 'no_subscription' };
  if (!ACCESS_GRANTING_STATUSES.has(subscription.status)) {
    return { hasAccess: false, reason: `status_${subscription.status}` };
  }
  // past_due keeps access until period end.
  if (subscription.status === 'past_due' && subscription.current_period_end) {
    const expired = new Date(subscription.current_period_end) < new Date();
    if (expired) {
      return { hasAccess: false, reason: 'past_due_expired' };
    }
  }
  return { hasAccess: true, reason: 'active' };
}
