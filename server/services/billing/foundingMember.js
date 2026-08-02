// Founding Member counter. Single-row table. Server is authoritative.
//
// IMPORTANT: increment only after a successful first checkout that creates
// a real Stripe subscription. We do NOT count cancelled-before-renewal
// subscribers against the cap once the subscription is cancelled — but for
// billing correctness we keep the count stable once incremented. The brief
// requires a "server-side authoritative count" and a banner that hides once
// 50 paying customers are reached.

import { query } from './db.js';
import { FOUNDING_MEMBER_CAP } from './plans.js';

export async function getCounter() {
  const { rows } = await query(
    'SELECT count, cap, last_updated FROM founding_member_counter WHERE id = 1'
  );
  if (!rows.length) {
    return { count: 0, cap: FOUNDING_MEMBER_CAP, last_updated: null };
  }
  return {
    count: rows[0].count,
    cap: rows[0].cap,
    last_updated: rows[0].last_updated,
  };
}

export async function spotsRemaining() {
  const { count, cap } = await getCounter();
  return Math.max(0, cap - count);
}

export async function isAtCap() {
  const remaining = await spotsRemaining();
  return remaining === 0;
}

// Atomically reserves a slot. Returns true if reserved, false if at cap.
export async function reserveSlot(subscriptionId) {
  const { rows } = await query(
    `UPDATE founding_member_counter
        SET count = count + 1,
            last_updated = now(),
            last_subscription_id = $2
      WHERE id = 1 AND count < cap
      RETURNING count, cap`,
    [subscriptionId]
  );
  return rows.length > 0;
}

export async function recordFoundingSubscription(subscriptionId) {
  const reserved = await reserveSlot(subscriptionId);
  return { reserved, ...(await getCounter()) };
}
