export type HtfTrend = 'bullish' | 'bearish' | 'neutral';
export type BiasStatus = 'bullish' | 'bearish' | 'mixed' | 'neutral';

export interface TimeframeSignal {
  trend?: string;
  signal?: string;
}

export interface HtfBiasInput {
  D1?: TimeframeSignal;
  H4?: TimeframeSignal;
  H1?: TimeframeSignal;
}

export interface HtfBiasResult {
  status: BiasStatus;
  weightedBullish: number;
  weightedBearish: number;
  confidencePenalty: number;
  hardInvalid: boolean;
}

const WEIGHTS = {
  D1: 0.5,
  H4: 0.3,
  H1: 0.2,
} as const;

const MIXED_BIAS_PENALTY = 12;
const HARD_INVALID_PENALTY = 100;

const normalizeTrend = (value?: string): HtfTrend => {
  const normalized = value?.toLowerCase();
  if (normalized === 'bullish' || normalized === 'buy') return 'bullish';
  if (normalized === 'bearish' || normalized === 'sell') return 'bearish';
  return 'neutral';
};

export const evaluateHtfBias = (input?: HtfBiasInput): HtfBiasResult => {
  const d1 = normalizeTrend(input?.D1?.trend ?? input?.D1?.signal);
  const h4 = normalizeTrend(input?.H4?.trend ?? input?.H4?.signal);
  const h1 = normalizeTrend(input?.H1?.trend ?? input?.H1?.signal);

  const weightedBullish =
    (d1 === 'bullish' ? WEIGHTS.D1 : 0) +
    (h4 === 'bullish' ? WEIGHTS.H4 : 0) +
    (h1 === 'bullish' ? WEIGHTS.H1 : 0);

  const weightedBearish =
    (d1 === 'bearish' ? WEIGHTS.D1 : 0) +
    (h4 === 'bearish' ? WEIGHTS.H4 : 0) +
    (h1 === 'bearish' ? WEIGHTS.H1 : 0);

  const hardInvalid =
    (d1 === 'bullish' && h4 === 'bearish') ||
    (d1 === 'bearish' && h4 === 'bullish');

  let status: BiasStatus = 'neutral';
  if (hardInvalid) {
    status = 'mixed';
  } else if (weightedBullish > weightedBearish && weightedBullish > 0) {
    status = 'bullish';
  } else if (weightedBearish > weightedBullish && weightedBearish > 0) {
    status = 'bearish';
  } else if (weightedBullish > 0 || weightedBearish > 0) {
    status = 'mixed';
  }

  const confidencePenalty = hardInvalid
    ? HARD_INVALID_PENALTY
    : status === 'mixed'
      ? MIXED_BIAS_PENALTY
      : 0;

  return {
    status,
    weightedBullish,
    weightedBearish,
    confidencePenalty,
    hardInvalid,
  };
};

export const applyHtfBiasPenalty = (confidence: number, bias: HtfBiasResult): number => {
  return Math.max(0, Math.min(100, confidence - bias.confidencePenalty));
};
