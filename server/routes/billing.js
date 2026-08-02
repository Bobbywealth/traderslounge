// Stripe Checkout / Billing Portal / webhook endpoints. All auth via JWT
// bearer token; demo accounts cannot reach checkout.

import express from 'express';
import { requireAuth, requirePaid } from '../services/auth.js';
import { getStripe, getWebhookSecret } from '../services/billing/stripe.js';
import {
  PLAN_IDS,
  isValidPlanId,
  getPriceIdForPlan,
  ACTIVE_STATUSES,
} from '../services/billing/plans.js';
import {
  getActiveSubscription,
  getStripeCustomerByUserId,
  upsertStripeCustomer,
  computeAccess,
} from '../services/billing/entitlement.js';
import { getCounter, isAtCap } from '../services/billing/foundingMember.js';
import {
  handleStripeEvent,
  auditLog,
} from '../services/billing/webhook.js';

const router = express.Router();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`${name} is required`);
    err.statusCode = 500;
    throw err;
  }
  return value;
}

function getAppBaseUrl(req) {
  const fromEnv = process.env.APP_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/$/, '');
  return 'http://localhost:5173';
}

// Public: server-side authoritative count for the founding member banner.
router.get('/api/billing/founding-member-counter', async (req, res) => {
  try {
    const counter = await getCounter();
    res.json({
      count: counter.count,
      cap: counter.cap,
      remaining: Math.max(0, counter.cap - counter.count),
      at_cap: counter.count >= counter.cap,
      last_updated: counter.last_updated,
    });
  } catch (err) {
    console.error('[billing] counter error', err.message);
    res.status(500).json({ error: 'counter_unavailable' });
  }
});

// Authenticated: current entitlements for the logged-in user.
router.get('/api/billing/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    const subscription = await getActiveSubscription(userId);
    const access = computeAccess(subscription);
    res.json({
      user: {
        id: userId,
        email: req.user.email,
        role,
        is_demo: role === 'demo',
      },
      subscription: subscription || null,
      access,
    });
  } catch (err) {
    console.error('[billing] /me error', err.message);
    res.status(500).json({ error: 'entitlement_lookup_failed' });
  }
});

// Authenticated: create a Stripe Checkout Session.
router.post('/api/billing/create-checkout-session', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'demo') {
      return res.status(403).json({
        error: 'demo_account',
        message: 'Demo accounts cannot purchase subscriptions. Sign up for a real account.',
      });
    }

    const plan = req.body?.plan;
    if (!isValidPlanId(plan)) {
      return res.status(400).json({ error: 'invalid_plan', message: 'Unknown plan id' });
    }

    const existing = await getActiveSubscription(req.user.id);
    if (existing && ACTIVE_STATUSES.has(existing.status)) {
      return res.status(409).json({
        error: 'subscription_exists',
        message: 'You already have an active subscription. Use the Billing Portal to manage it.',
        manage_url: '/billing/manage',
      });
    }

    if (plan === PLAN_IDS.FOUNDING_MONTHLY) {
      if (await isAtCap()) {
        return res.status(409).json({
          error: 'founding_member_cap_reached',
          message: 'All 50 Founding Member spots have been claimed. Pro is still available.',
        });
      }
    }

    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      return res.status(500).json({
        error: 'price_not_configured',
        message: `Stripe price for ${plan} is not configured.`,
      });
    }

    let customer = await getStripeCustomerByUserId(req.user.id);
    if (!customer) {
      const stripeCustomer = await getStripe().customers.create({
        metadata: { user_id: req.user.id },
        email: req.user.email,
      });
      await upsertStripeCustomer({
        userId: req.user.id,
        stripeCustomerId: stripeCustomer.id,
        email: req.user.email,
      });
      customer = { stripe_customer_id: stripeCustomer.id, email: req.user.email };
    }

    const baseUrl = getAppBaseUrl(req);
    const successUrl = req.body?.successUrl || `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = req.body?.cancelUrl || `${baseUrl}/billing/cancel`;

    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customer.stripe_customer_id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: req.user.id,
      metadata: {
        user_id: req.user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          user_id: req.user.id,
          plan,
        },
      },
      allow_promotion_codes: true,
    });

    await auditLog({
      userId: req.user.id,
      eventType: 'checkout_started',
      subscriptionId: null,
      metadata: { plan, session_id: session.id },
    });

    res.json({
      url: session.url,
      session_id: session.id,
    });
  } catch (err) {
    next(err);
  }
});

// Authenticated: redirect to stripe-managed billing portal.
router.post('/api/billing/create-portal-session', requireAuth, async (req, res, next) => {
  try {
    const customer = await getStripeCustomerByUserId(req.user.id);
    if (!customer) {
      return res.status(404).json({
        error: 'no_customer',
        message: 'No Stripe customer is linked to this account yet.',
      });
    }
    const baseUrl = getAppBaseUrl(req);
    const returnUrl = req.body?.returnUrl || `${baseUrl}/settings`;
    const portal = await getStripe().billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: returnUrl,
    });
    await auditLog({
      userId: req.user.id,
      eventType: 'billing_portal_opened',
      subscriptionId: null,
      metadata: {},
    });
    res.json({ url: portal.url });
  } catch (err) {
    next(err);
  }
});

// Authenticated: pricing snapshot for the landing page. The frontend uses
// this to display accurate monthly/annual savings.
router.get('/api/billing/pricing', (req, res) => {
  res.json({
    currency: 'usd',
    plans: [
      {
        id: PLAN_IDS.PRO_MONTHLY,
        label: 'Pro Monthly',
        amount_cents: 49_00,
        interval: 'month',
      },
      {
        id: PLAN_IDS.PRO_ANNUAL,
        label: 'Pro Annual',
        amount_cents: 490_00,
        interval: 'year',
        annual_savings_cents: 49_00 * 12 - 490_00,
      },
      {
        id: PLAN_IDS.FOUNDING_MONTHLY,
        label: 'Founding Member',
        amount_cents: 29_00,
        interval: 'month',
        note: 'Grandfathered while subscription remains active. Limited to first 50 customers.',
      },
    ],
    risk_disclaimer:
      'ConfluenceX provides read-only market intelligence and decision support. It does not provide personalized financial advice or guarantee trading results.',
  });
});

export { router as billingRouter };

// === Webhook handler (mounted separately because it needs the raw body) ===
export const webhookRouter = express.Router();

webhookRouter.post(
  '/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let event;
    try {
      const stripe = getStripe();
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, getWebhookSecret());
    } catch (err) {
      console.error('[billing] webhook signature verification failed', err.message);
      return res.status(400).json({ error: 'invalid_signature', message: err.message });
    }

    try {
      const result = await handleStripeEvent(event);
      if (result.duplicate) {
        return res.status(200).json({ received: true, duplicate: true });
      }
      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('[billing] webhook handler error', err.message);
      // 500 lets Stripe retry — combined with idempotency tables this is safe.
      return res.status(500).json({ error: 'webhook_handler_failed', message: err.message });
    }
  }
);
