// Tests for the Stripe billing routes. Uses in-memory mocks for the Postgres
// pool and the Stripe SDK so the suite can run without a real database or
// network access. Anchors each billing requirement on a discrete test.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHmac } from 'node:crypto';

// === mock Stripe BEFORE importing the routes ===
const stripeMock = {
  customers: {
    create: vi.fn(),
    retrieve: vi.fn(),
  },
  checkout: {
    sessions: {
      create: vi.fn(),
    },
  },
  billingPortal: {
    sessions: {
      create: vi.fn(),
    },
  },
  subscriptions: {
    retrieve: vi.fn(),
  },
  webhooks: {
    constructEvent: vi.fn(),
  },
};

vi.mock('../services/billing/stripe.js', () => ({
  getStripe: () => stripeMock,
  getWebhookSecret: () => 'whsec_test',
  resetStripeForTesting: () => {},
  setStripeForTesting: () => {},
}));

// === mock pg pool ===
const dbState = {
  customers: new Map(),
  subscriptions: new Map(),
  webhookEvents: new Map(),
  counter: { count: 0, cap: 50, last_updated: null },
  auditLog: [],
};

function serialize(rows) {
  return { rows };
}

const queryMock = vi.fn(async (sql, params) => {
  const text = sql.replace(/\s+/g, ' ').trim();

  if (text.startsWith('INSERT INTO stripe_customers')) {
    const [userId, stripeCustomerId, email] = params;
    if (!dbState.customers.has(userId)) {
      dbState.customers.set(userId, { user_id: userId, stripe_customer_id: stripeCustomerId, email });
    } else {
      dbState.customers.set(userId, { user_id: userId, stripe_customer_id: stripeCustomerId, email });
    }
    return serialize([]);
  }

  if (text.startsWith('SELECT stripe_customer_id, email FROM stripe_customers WHERE user_id')) {
    const [userId] = params;
    const row = dbState.customers.get(userId);
    return serialize(row ? [row] : []);
  }

  if (text.startsWith('SELECT user_id FROM stripe_customers WHERE stripe_customer_id')) {
    const [cid] = params;
    for (const row of dbState.customers.values()) {
      if (row.stripe_customer_id === cid) return serialize([{ user_id: row.user_id }]);
    }
    return serialize([]);
  }

  if (text.startsWith('SELECT user_id FROM subscriptions WHERE stripe_subscription_id')) {
    const [sid] = params;
    for (const row of dbState.subscriptions.values()) {
      if (row.stripe_subscription_id === sid) return serialize([{ user_id: row.user_id }]);
    }
    return serialize([]);
  }

  if (text.startsWith('INSERT INTO subscriptions')) {
    const [
      userId, stripeSubId, stripeCustomerId, priceId, plan, status,
      currentPeriodEnd, cancelAtPeriodEnd, canceledAt, startedAt, endedAt,
    ] = params;
    dbState.subscriptions.set(stripeSubId, {
      user_id: userId,
      stripe_subscription_id: stripeSubId,
      stripe_customer_id: stripeCustomerId,
      stripe_price_id: priceId,
      plan,
      status,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      canceled_at: canceledAt,
      started_at: startedAt,
      ended_at: endedAt,
    });
    return serialize([]);
  }

  if (text.startsWith('SELECT s.id, s.user_id, s.stripe_subscription_id')) {
    const [userId, statuses] = params;
    const matching = [];
    for (const row of dbState.subscriptions.values()) {
      if (row.user_id === userId && statuses.includes(row.status)) {
        matching.push(row);
      }
    }
    matching.sort((a, b) => {
      const aT = a.current_period_end || '';
      const bT = b.current_period_end || '';
      return bT.localeCompare(aT);
    });
    return serialize(matching.slice(0, 1));
  }

  if (text.startsWith('SELECT * FROM subscriptions WHERE stripe_subscription_id')) {
    const [sid] = params;
    const row = dbState.subscriptions.get(sid);
    return serialize(row ? [row] : []);
  }

  if (text.startsWith('SELECT * FROM subscriptions WHERE stripe_customer_id')) {
    const [cid] = params;
    let latest = null;
    for (const row of dbState.subscriptions.values()) {
      if (row.stripe_customer_id === cid) {
        if (!latest) latest = row;
      }
    }
    return serialize(latest ? [latest] : []);
  }

  if (text.startsWith('INSERT INTO webhook_events')) {
    const [eventId, eventType, payload] = params;
    if (dbState.webhookEvents.has(eventId)) {
      // ON CONFLICT DO NOTHING: no rows returned.
      return serialize([]);
    }
    dbState.webhookEvents.set(eventId, { eventId, eventType, payload });
    // RETURNING stripe_event_id fires on a real insert.
    return serialize([{ stripe_event_id: eventId }]);
  }
  if (text.startsWith('SELECT 1 FROM webhook_events WHERE stripe_event_id')) {
    const [eventId] = params;
    return serialize(dbState.webhookEvents.has(eventId) ? [{ '?column?': 1 }] : []);
  }

  if (text.startsWith('SELECT count, cap, last_updated FROM founding_member_counter')) {
    return serialize([{ count: dbState.counter.count, cap: dbState.counter.cap, last_updated: dbState.counter.last_updated }]);
  }
  if (text.startsWith('UPDATE founding_member_counter')) {
    const [subscriptionId] = params;
    if (dbState.counter.count >= dbState.counter.cap) return serialize([]);
    dbState.counter.count += 1;
    dbState.counter.last_updated = new Date().toISOString();
    dbState.counter.last_subscription_id = subscriptionId;
    return serialize([{ count: dbState.counter.count, cap: dbState.counter.cap }]);
  }

  if (text.startsWith('INSERT INTO billing_audit_log')) {
    const [userId, eventType, subscriptionId, metadata] = params;
    dbState.auditLog.push({ userId, eventType, subscriptionId, metadata: JSON.parse(metadata) });
    return serialize([]);
  }

  throw new Error(`Unmocked SQL: ${text}`);
});

vi.mock('../services/billing/db.js', () => ({
  getPool: () => ({ query: queryMock }),
  query: queryMock,
  withTransaction: async (fn) => fn({ query: queryMock }),
  closePool: async () => {},
}));

// === Set required env ===
beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_monthly_test';
  process.env.STRIPE_PRICE_PRO_ANNUAL = 'price_pro_annual_test';
  process.env.STRIPE_PRICE_FOUNDING_MONTHLY = 'price_founding_monthly_test';
  process.env.APP_BASE_URL = 'http://localhost:5173';
});

beforeEach(() => {
  dbState.customers.clear();
  dbState.subscriptions.clear();
  dbState.webhookEvents.clear();
  dbState.counter = { count: 0, cap: 50, last_updated: null };
  dbState.auditLog.length = 0;

  stripeMock.customers.create.mockReset();
  stripeMock.customers.retrieve.mockReset();
  stripeMock.checkout.sessions.create.mockReset();
  stripeMock.billingPortal.sessions.create.mockReset();
  stripeMock.subscriptions.retrieve.mockReset();
  stripeMock.webhooks.constructEvent.mockReset();

  vi.resetModules();
});

function signToken({ id = '1', email = 'user@example.com', role = 'user', plan = 'free' } = {}) {
  return jwt.sign(
    { sub: String(id), email, role, plan, type: 'access' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

function signDemoToken() {
  return signToken({ id: '0', email: 'demo@trader.com', role: 'demo', plan: 'pro' });
}

async function buildApp() {
  const express = (await import('express')).default;
  const { billingRouter } = await import('../routes/billing.js');
  const app = express();
  app.use(express.json());
  app.use(billingRouter);
  return app;
}

describe('GET /api/billing/founding-member-counter', () => {
  it('returns the server-side authoritative count', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/billing/founding-member-counter');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 0, cap: 50, remaining: 50, at_cap: false });
  });

  it('returns at_cap=true once 50 paying customers are reached', async () => {
    dbState.counter.count = 50;
    const app = await buildApp();
    const res = await request(app).get('/api/billing/founding-member-counter');
    expect(res.body.at_cap).toBe(true);
    expect(res.body.remaining).toBe(0);
  });
});

describe('GET /api/billing/me', () => {
  it('returns no subscription for a fresh account by default', async () => {
    const app = await buildApp();
    const token = signToken({ id: '42', email: 'new@example.com' });
    const res = await request(app).get('/api/billing/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.access.hasAccess).toBe(false);
    expect(res.body.subscription).toBeNull();
    expect(res.body.user.is_demo).toBe(false);
  });

  it('returns hasAccess=true for an active subscription', async () => {
    dbState.subscriptions.set('sub_1', {
      user_id: '42', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1',
      stripe_price_id: 'price_pro_monthly_test', plan: 'pro_monthly', status: 'active',
      current_period_end: new Date(Date.now() + 86400_000).toISOString(),
      cancel_at_period_end: false,
    });
    const app = await buildApp();
    const token = signToken({ id: '42' });
    const res = await request(app).get('/api/billing/me').set('Authorization', `Bearer ${token}`);
    expect(res.body.access.hasAccess).toBe(true);
    expect(res.body.subscription.plan).toBe('pro_monthly');
  });

  it('returns hasAccess=false for cancelled subscriptions', async () => {
    dbState.subscriptions.set('sub_2', {
      user_id: '42', stripe_subscription_id: 'sub_2', stripe_customer_id: 'cus_2',
      stripe_price_id: 'price_pro_monthly_test', plan: 'pro_monthly', status: 'canceled',
      current_period_end: new Date(Date.now() - 86400_000).toISOString(),
      cancel_at_period_end: false,
    });
    const app = await buildApp();
    const token = signToken({ id: '42' });
    const res = await request(app).get('/api/billing/me').set('Authorization', `Bearer ${token}`);
    expect(res.body.access.hasAccess).toBe(false);
  });

  it('returns hasAccess=true for past_due until period end', async () => {
    dbState.subscriptions.set('sub_3', {
      user_id: '42', stripe_subscription_id: 'sub_3', stripe_customer_id: 'cus_3',
      stripe_price_id: 'price_pro_monthly_test', plan: 'pro_monthly', status: 'past_due',
      current_period_end: new Date(Date.now() + 86400_000).toISOString(),
      cancel_at_period_end: false,
    });
    const app = await buildApp();
    const token = signToken({ id: '42' });
    const res = await request(app).get('/api/billing/me').set('Authorization', `Bearer ${token}`);
    expect(res.body.access.hasAccess).toBe(true);
  });
});

describe('POST /api/billing/create-checkout-session', () => {
  it('returns 401 when no auth header is provided', async () => {
    const app = await buildApp();
    const res = await request(app).post('/api/billing/create-checkout-session').send({ plan: 'pro_monthly' });
    expect(res.status).toBe(401);
  });

  it('rejects the demo role with 403', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${signDemoToken()}`)
      .send({ plan: 'pro_monthly' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('demo_account');
  });

  it('rejects an unknown plan id', async () => {
    const app = await buildApp();
    const token = signToken();
    const res = await request(app)
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'totally_made_up' });
    expect(res.status).toBe(400);
  });

  it('rejects an active subscriber with a link to the billing portal', async () => {
    dbState.subscriptions.set('sub_active', {
      user_id: '1', stripe_subscription_id: 'sub_active', stripe_customer_id: 'cus_active',
      stripe_price_id: 'price_pro_monthly_test', plan: 'pro_monthly', status: 'active',
      current_period_end: new Date(Date.now() + 86400_000).toISOString(),
      cancel_at_period_end: false,
    });
    const app = await buildApp();
    const token = signToken({ id: '1' });
    const res = await request(app)
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro_monthly' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('subscription_exists');
    expect(res.body.manage_url).toBe('/billing/manage');
  });

  it('creates a checkout session for pro_monthly', async () => {
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_new_1', email: 'user@example.com' });
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs_test_1', url: 'https://stripe.test/cs_test_1' });

    const app = await buildApp();
    const token = signToken({ id: '1' });
    const res = await request(app)
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro_monthly' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://stripe.test/cs_test_1');
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'subscription',
      line_items: [{ price: 'price_pro_monthly_test', quantity: 1 }],
      metadata: expect.objectContaining({ user_id: '1', plan: 'pro_monthly' }),
    }));

    // Idempotency: recording a checkout_started audit event.
    const started = dbState.auditLog.find((a) => a.eventType === 'checkout_started');
    expect(started).toBeTruthy();
  });

  it('creates a checkout session for pro_annual with annual savings', async () => {
    stripeMock.customers.create.mockResolvedValue({ id: 'cus_new_1', email: 'user@example.com' });
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs_test_2', url: 'https://stripe.test/cs_test_2' });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${signToken({ id: '1' })}`)
      .send({ plan: 'pro_annual' });
    expect(res.status).toBe(200);
    expect(stripeMock.checkout.sessions.create.mock.calls[0][0].line_items[0].price)
      .toBe('price_pro_annual_test');
  });

  it('blocks Founding checkout when the cap is reached', async () => {
    dbState.counter.count = 50;
    const app = await buildApp();
    const res = await request(app)
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${signToken({ id: '1' })}`)
      .send({ plan: 'founding_monthly' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('founding_member_cap_reached');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/create-portal-session', () => {
  it('returns 404 when no Stripe customer is linked', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/billing/create-portal-session')
      .set('Authorization', `Bearer ${signToken({ id: '50' })}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_customer');
  });

  it('returns a portal URL for a known customer', async () => {
    dbState.customers.set('5', { user_id: '5', stripe_customer_id: 'cus_5', email: 'a@b.com' });
    stripeMock.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/abc' });
    const app = await buildApp();
    const res = await request(app)
      .post('/api/billing/create-portal-session')
      .set('Authorization', `Bearer ${signToken({ id: '5' })}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('https://billing.stripe.com');
  });
});

describe('POST /api/billing/webhook', () => {
  async function buildAppWithWebhook() {
    const express = (await import('express')).default;
    const { webhookRouter } = await import('../routes/billing.js');
    const app = express();
    app.use(webhookRouter);
    return app;
  }

  function buildSignature(body, secret = 'whsec_test') {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = `${timestamp}.${body}`;
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    return { 'stripe-signature': `t=${timestamp},v1=${sig}`, body };
  }

  let app;
  beforeEach(async () => {
    app = await buildAppWithWebhook();
  });

  it('returns 400 on signature verification failure', async () => {
    stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send('{"id":"evt_1"}');
    expect(res.status).toBe(400);
  });

  it('handles checkout.session.completed and persists the subscription', async () => {
    const event = {
      id: 'evt_1', type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1', customer: 'cus_1', customer_email: 'a@b.com',
          subscription: 'sub_1', metadata: { user_id: '7', plan: 'pro_monthly' },
          client_reference_id: '7',
        },
      },
    };
    stripeMock.webhooks.constructEvent.mockReturnValue(event);
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_1', customer: 'cus_1', status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_pro_monthly_test' } }] },
      metadata: { user_id: '7', plan: 'pro_monthly' },
    });

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(200);
    expect(dbState.subscriptions.get('sub_1').plan).toBe('pro_monthly');
    expect(dbState.subscriptions.get('sub_1').user_id).toBe('7');
  });

  it('handles invoice.paid for a recurring cycle', async () => {
    const event = {
      id: 'evt_paid', type: 'invoice.paid',
      data: { object: { id: 'in_1', customer: 'cus_1', subscription: 'sub_1' } },
    };
    stripeMock.webhooks.constructEvent.mockReturnValue(event);
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_1', customer: 'cus_1', status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      items: { data: [{ price: { id: 'price_pro_monthly_test' } }] },
      metadata: { user_id: '7', plan: 'pro_monthly' },
    });
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(200);
    expect(dbState.subscriptions.get('sub_1').status).toBe('active');
  });

  it('handles invoice.payment_failed by storing past_due', async () => {
    const event = {
      id: 'evt_failed', type: 'invoice.payment_failed',
      data: { object: { id: 'in_2', customer: 'cus_1', subscription: 'sub_1' } },
    };
    stripeMock.webhooks.constructEvent.mockReturnValue(event);
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_1', customer: 'cus_1', status: 'past_due',
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      items: { data: [{ price: { id: 'price_pro_monthly_test' } }] },
      metadata: { user_id: '7', plan: 'pro_monthly' },
    });
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(200);
    expect(dbState.subscriptions.get('sub_1').status).toBe('past_due');
  });

  it('handles customer.subscription.updated with cancel_at_period_end=true', async () => {
    const event = {
      id: 'evt_upd', type: 'customer.subscription.updated',
      data: { object: {
        id: 'sub_1', customer: 'cus_1', status: 'active',
        cancel_at_period_end: true,
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
        items: { data: [{ price: { id: 'price_pro_monthly_test' } }] },
        metadata: { user_id: '7', plan: 'pro_monthly' },
      } },
    };
    stripeMock.webhooks.constructEvent.mockReturnValue(event);
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(200);
    expect(dbState.subscriptions.get('sub_1').cancel_at_period_end).toBe(true);
  });

  it('handles customer.subscription.deleted by recording ended status', async () => {
    const event = {
      id: 'evt_del', type: 'customer.subscription.deleted',
      data: { object: {
        id: 'sub_1', customer: 'cus_1', status: 'canceled',
        cancel_at_period_end: false,
        current_period_end: Math.floor(Date.now() / 1000) - 86400,
        ended_at: Math.floor(Date.now() / 1000),
        items: { data: [{ price: { id: 'price_pro_monthly_test' } }] },
        metadata: { user_id: '7', plan: 'pro_monthly' },
      } },
    };
    stripeMock.webhooks.constructEvent.mockReturnValue(event);
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(200);
    expect(dbState.subscriptions.get('sub_1').status).toBe('canceled');
  });

  it('treats a replayed event id as a duplicate and short-circuits', async () => {
    const event = {
      id: 'evt_dup', type: 'invoice.paid',
      data: { object: { id: 'in_dup', customer: 'cus_1', subscription: 'sub_1' } },
    };
    stripeMock.webhooks.constructEvent.mockReturnValue(event);
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_1', customer: 'cus_1', status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      items: { data: [{ price: { id: 'price_pro_monthly_test' } }] },
      metadata: { user_id: '7', plan: 'pro_monthly' },
    });
    const payload = JSON.stringify(event);
    const first = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    const second = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
  });
});

describe('requirePaid middleware', () => {
  it('rejects demo users trying to bypass paid access', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/billing/create-checkout-session')
      .set('Authorization', `Bearer ${signDemoToken()}`)
      .send({ plan: 'pro_monthly' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('demo_account');
  });
});
