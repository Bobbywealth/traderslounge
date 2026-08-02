// Plan and price metadata. Server-side authoritative. The frontend reads price
// IDs from this module's exported function so labels and saving claims can't
// drift from backend config.

export const PLAN_IDS = Object.freeze({
  PRO_MONTHLY: 'pro_monthly',
  PRO_ANNUAL: 'pro_annual',
  FOUNDING_MONTHLY: 'founding_monthly',
});

export const PLAN_VALUES = Object.freeze(new Set([
  PLAN_IDS.PRO_MONTHLY,
  PLAN_IDS.PRO_ANNUAL,
  PLAN_IDS.FOUNDING_MONTHLY,
]));

export const PLAN_PRICES = Object.freeze({
  pro_monthly: 49_00, // cents
  pro_annual: 490_00, // cents → 2 months free vs monthly
  founding_monthly: 29_00,
});

export const PLAN_LABELS = Object.freeze({
  pro_monthly: 'Pro Monthly',
  pro_annual: 'Pro Annual',
  founding_monthly: 'Founding Member',
});

export const PLAN_INTERVALS = Object.freeze({
  pro_monthly: 'month',
  pro_annual: 'year',
  founding_monthly: 'month',
});

export const FOUNDING_MEMBER_CAP = 50;

export const ACTIVE_STATUSES = new Set([
  'incomplete',
  'trialing',
  'active',
  'past_due',
]);

// past_due is treated as "access through period end" per the brief.
export const ACCESS_GRANTING_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
]);

export function isValidPlanId(plan) {
  return PLAN_VALUES.has(plan);
}

export function getPlanByPriceId(priceId) {
  if (!priceId) return null;
  const map = {
    [process.env.STRIPE_PRICE_PRO_MONTHLY]: PLAN_IDS.PRO_MONTHLY,
    [process.env.STRIPE_PRICE_PRO_ANNUAL]: PLAN_IDS.PRO_ANNUAL,
    [process.env.STRIPE_PRICE_FOUNDING_MONTHLY]: PLAN_IDS.FOUNDING_MONTHLY,
  };
  return map[priceId] || null;
}

export function getPriceIdForPlan(plan) {
  switch (plan) {
    case PLAN_IDS.PRO_MONTHLY:
      return process.env.STRIPE_PRICE_PRO_MONTHLY;
    case PLAN_IDS.PRO_ANNUAL:
      return process.env.STRIPE_PRICE_PRO_ANNUAL;
    case PLAN_IDS.FOUNDING_MONTHLY:
      return process.env.STRIPE_PRICE_FOUNDING_MONTHLY;
    default:
      return null;
  }
}

export function annualSavingsCents() {
  return PLAN_PRICES.pro_monthly * 12 - PLAN_PRICES.pro_annual;
}
