export type ConfidenceFactorPolarity = 'positive' | 'negative';

export interface ConfidenceFactor {
  /**
   * Stable identifier for alert rendering and analytics.
   */
  key: string;
  label: string;
  description?: string;
  polarity: ConfidenceFactorPolarity;
  /**
   * Factor magnitude before weighting. Positive numbers only.
   */
  value: number;
  /**
   * Relative importance multiplier. Positive numbers only.
   */
  weight: number;
  /**
   * Set false to ignore this factor without removing it.
   */
  enabled?: boolean;
  /**
   * If true, this factor must be present and enabled for trade eligibility.
   */
  mandatory?: boolean;
}

export interface ConfidenceEngineInput {
  factors: ConfidenceFactor[];
  /**
   * Minimum score needed after normalization and rounding.
   */
  minimumScore?: number;
  /**
   * Optional explicit list of mandatory keys.
   */
  mandatoryFactorKeys?: string[];
}

export interface ConfidenceContribution {
  key: string;
  label: string;
  description?: string;
  polarity: ConfidenceFactorPolarity;
  value: number;
  weight: number;
  weightedValue: number;
}

export interface ConfidencePenalty extends ConfidenceContribution {
  reason: string;
}

export interface ConfidenceScoreExplanation {
  positive: ConfidenceContribution[];
  penalties: ConfidencePenalty[];
  missingMandatoryFactors: string[];
  totals: {
    positive: number;
    negative: number;
    gross: number;
    clamped: number;
    rounded: number;
  };
  rounding: {
    mode: 'half-away-from-zero';
    step: 1;
  };
}

export interface ConfidenceScoreResult {
  score: number;
  eligible: boolean;
  explanation: ConfidenceScoreExplanation;
}

const DEFAULT_MINIMUM_SCORE = 60;

const PENALTY_REASONS: Record<string, string> = {
  htf_conflict: 'Higher timeframe trend conflicts with setup direction.',
  adr_exhaustion_no_reversal_confirmation:
    'Price is near ADR exhaustion without reversal confirmation.',
};

const roundHalfAwayFromZero = (value: number): number => {
  if (value >= 0) {
    return Math.floor(value + 0.5);
  }
  return Math.ceil(value - 0.5);
};

const clampScore = (value: number): number => Math.max(0, Math.min(100, value));

export const calculateConfidenceScore = (
  input: ConfidenceEngineInput,
): ConfidenceScoreResult => {
  const enabledFactors = input.factors.filter((factor) => factor.enabled !== false);

  const mandatorySet = new Set([
    ...(input.mandatoryFactorKeys ?? []),
    ...enabledFactors.filter((factor) => factor.mandatory).map((factor) => factor.key),
  ]);

  const presentKeys = new Set(enabledFactors.map((factor) => factor.key));
  const missingMandatoryFactors = [...mandatorySet].filter((key) => !presentKeys.has(key));

  const positive: ConfidenceContribution[] = [];
  const penalties: ConfidencePenalty[] = [];

  let totalPositive = 0;
  let totalNegative = 0;

  for (const factor of enabledFactors) {
    const safeValue = Math.max(0, factor.value);
    const safeWeight = Math.max(0, factor.weight);
    const weightedValue = safeValue * safeWeight;

    if (factor.polarity === 'positive') {
      totalPositive += weightedValue;
      positive.push({
        key: factor.key,
        label: factor.label,
        description: factor.description,
        polarity: factor.polarity,
        value: safeValue,
        weight: safeWeight,
        weightedValue,
      });
      continue;
    }

    totalNegative += weightedValue;
    penalties.push({
      key: factor.key,
      label: factor.label,
      description: factor.description,
      polarity: factor.polarity,
      value: safeValue,
      weight: safeWeight,
      weightedValue,
      reason: PENALTY_REASONS[factor.key] ?? 'Risk factor penalty applied.',
    });
  }

  const gross = totalPositive - totalNegative;
  const clamped = clampScore(gross);
  const rounded = roundHalfAwayFromZero(clamped);

  const minimumScore = input.minimumScore ?? DEFAULT_MINIMUM_SCORE;
  const eligible = missingMandatoryFactors.length === 0 && rounded >= minimumScore;

  return {
    score: rounded,
    eligible,
    explanation: {
      positive,
      penalties,
      missingMandatoryFactors,
      totals: {
        positive: totalPositive,
        negative: totalNegative,
        gross,
        clamped,
        rounded,
      },
      rounding: {
        mode: 'half-away-from-zero',
        step: 1,
      },
    },
  };
};
