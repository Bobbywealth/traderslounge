// Stripe client wrapper. Lazily initializes so tests can mock the SDK
// without needing the real network.

import Stripe from 'stripe';

let stripeClient = null;

function resolveSecret() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is required for billing endpoints');
  }
  return key;
}

export function getStripe() {
  if (stripeClient) return stripeClient;
  stripeClient = new Stripe(resolveSecret(), {
    apiVersion: '2024-06-20',
    typescript: false,
    appInfo: {
      name: 'ConfluenceX',
      version: '0.1.0',
    },
  });
  return stripeClient;
}

// Test seam: allows tests to inject a stub implementation.
export function setStripeForTesting(client) {
  stripeClient = client;
}

export function resetStripeForTesting() {
  stripeClient = null;
}

export function getWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required for webhook verification');
  }
  return secret;
}
