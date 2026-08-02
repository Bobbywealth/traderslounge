// Stripe webhook handler. All processing is idempotent — the webhook_events
// table dedupes by Stripe event id. Stale events are skipped safely.

import { getStripe } from './stripe.js';
import { query } from './db.js';
import {
  upsertStripeCustomer,
  upsertSubscription,
  findUserIdByCustomer,
  findUserIdBySubscription,
} from './entitlement.js';
import { getPlanByPriceId } from './plans.js';
import { recordFoundingSubscription } from './foundingMember.js';

async function ensureCustomer(stripeCustomerId, fallbackUserId) {
  let userId = await findUserIdByCustomer(stripeCustomerId);
  if (userId) return userId;
  // Look up the customer email from Stripe in case the customer object was
  // created in the same session as the subscription.
  const customer = await getStripe().customers.retrieve(stripeCustomerId);
  if (customer?.deleted) {
    throw new Error(`Stripe customer ${stripeCustomerId} was deleted`);
  }
  userId = fallbackUserId || customer?.metadata?.user_id || null;
  if (!userId) {
    throw new Error(`Cannot resolve user_id for Stripe customer ${stripeCustomerId}`);
  }
  await upsertStripeCustomer({
    userId,
    stripeCustomerId,
    email: customer?.email || null,
  });
  return userId;
}

function mapSubscriptionFromStripe(sub) {
  const priceId = sub.items?.data?.[0]?.price?.id || null;
  const plan = getPlanByPriceId(priceId) || (sub.metadata?.plan ?? null);
  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;
  const startedAt = sub.start_date ? new Date(sub.start_date * 1000) : null;
  const canceledAt = sub.canceled_at ? new Date(sub.canceled_at * 1000) : null;
  const endedAt = sub.ended_at ? new Date(sub.ended_at * 1000) : null;
  return {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: sub.customer,
    stripePriceId: priceId,
    plan,
    status: sub.status,
    currentPeriodEnd: currentPeriodEnd?.toISOString() || null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    canceledAt: canceledAt?.toISOString() || null,
    startedAt: startedAt?.toISOString() || null,
    endedAt: endedAt?.toISOString() || null,
  };
}

async function persistSubscriptionForCustomer(stripeCustomerId, stripeSubscription) {
  const userId = await ensureCustomer(stripeCustomerId, stripeSubscription.metadata?.user_id);
  const mapped = mapSubscriptionFromStripe(stripeSubscription);
  await upsertSubscription({ userId, ...mapped });
  if (mapped.plan === 'founding_monthly' && mapped.status === 'active') {
    await recordFoundingSubscription(mapped.stripeSubscriptionId);
  }
  return { userId, mapped };
}

export async function recordWebhookEvent(eventId, eventType, payload) {
  try {
    // RETURNING only emits a row when the INSERT actually inserted. When the
    // ON CONFLICT path fires, no row is returned — that's how we detect a
    // replayed event.
    const { rows } = await query(
      `INSERT INTO webhook_events (stripe_event_id, event_type, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (stripe_event_id) DO NOTHING
       RETURNING stripe_event_id`,
      [eventId, eventType, JSON.stringify(payload)]
    );
    return rows.length > 0;
  } catch (err) {
    console.error('[billing] failed to record webhook event', err.message);
    throw err;
  }
}

export async function handleStripeEvent(event) {
  if (!event || !event.id || !event.type) {
    return { handled: false, reason: 'invalid_event' };
  }
  const inserted = await recordWebhookEvent(event.id, event.type, event);
  if (!inserted) {
    return { handled: false, reason: 'duplicate', duplicate: true };
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.subscription) {
        const sub = await getStripe().subscriptions.retrieve(session.subscription);
        const userId = session.metadata?.user_id || session.client_reference_id || null;
        if (userId) {
          await upsertStripeCustomer({
            userId,
            stripeCustomerId: session.customer,
            email: session.customer_details?.email || session.customer_email || null,
          });
        }
        await persistSubscriptionForCustomer(session.customer, sub);
      }
      return { handled: true };
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const sub = await getStripe().subscriptions.retrieve(invoice.subscription);
        await persistSubscriptionForCustomer(invoice.customer, sub);
      }
      return { handled: true };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const sub = await getStripe().subscriptions.retrieve(invoice.subscription);
        await persistSubscriptionForCustomer(invoice.customer, sub);
      }
      return { handled: true };
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await persistSubscriptionForCustomer(sub.customer, sub);
      return { handled: true };
    }

    default:
      return { handled: true, reason: 'unhandled_type' };
  }
}

// Helper: log without leaking sensitive data.
export function auditLog({ userId, eventType, subscriptionId, metadata }) {
  return query(
    `INSERT INTO billing_audit_log (user_id, event_type, subscription_id, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [userId || null, eventType, subscriptionId || null, JSON.stringify(metadata || {})]
  ).catch((err) => {
    console.error('[billing] audit log failed', err.message);
  });
}

export { ensureCustomer, mapSubscriptionFromStripe, persistSubscriptionForCustomer };
