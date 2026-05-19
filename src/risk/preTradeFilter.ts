export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | string;

export interface InstrumentRiskLimits {
  maxSlAbsolute: number;
  maxSlAtrMultiple: number;
  minRToTp1: number;
  maxSpread: number;
  maxSlippage: number;
}

export type RiskConfig = Record<string, Partial<Record<Timeframe, InstrumentRiskLimits>> & {
  default?: InstrumentRiskLimits;
}>;

export interface PreTradeSignalInput {
  instrument: string;
  timeframe: Timeframe;
  entryPrice: number;
  stopLossPrice: number;
  takeProfit1Price: number;
  atr: number;
  spread: number;
  expectedSlippage: number;
}

export interface GateFailure {
  code:
    | 'INVALID_PRICES'
    | 'MISSING_RISK_CONFIG'
    | 'SL_ABSOLUTE_EXCEEDED'
    | 'SL_ATR_EXCEEDED'
    | 'R_RATIO_TOO_LOW'
    | 'SPREAD_TOO_HIGH'
    | 'SLIPPAGE_TOO_HIGH';
  message: string;
  details?: Record<string, number | string>;
}

export interface GateResult {
  passed: boolean;
  failures: GateFailure[];
}

export const defaultRiskConfig: RiskConfig = {
  EURUSD: {
    default: {
      maxSlAbsolute: 0.004,
      maxSlAtrMultiple: 2,
      minRToTp1: 1,
      maxSpread: 0.0003,
      maxSlippage: 0.0002,
    },
    M15: {
      maxSlAbsolute: 0.0025,
      maxSlAtrMultiple: 1.6,
      minRToTp1: 1.1,
      maxSpread: 0.0002,
      maxSlippage: 0.00015,
    },
  },
};

const resolveLimits = (
  config: RiskConfig,
  instrument: string,
  timeframe: Timeframe,
): InstrumentRiskLimits | null => {
  const normalizedInstrument = instrument.toUpperCase();
  const byInstrument = config[normalizedInstrument];

  if (!byInstrument) {
    return null;
  }

  return byInstrument[timeframe] ?? byInstrument.default ?? null;
};

export const evaluatePreTradeRisk = (
  input: PreTradeSignalInput,
  config: RiskConfig = defaultRiskConfig,
): GateResult => {
  const failures: GateFailure[] = [];
  const slDistance = Math.abs(input.entryPrice - input.stopLossPrice);
  const rewardDistance = Math.abs(input.takeProfit1Price - input.entryPrice);

  if (!Number.isFinite(slDistance) || slDistance <= 0 || rewardDistance <= 0) {
    failures.push({
      code: 'INVALID_PRICES',
      message: 'SL/TP distance must be valid and greater than zero.',
    });
    return { passed: false, failures };
  }

  const limits = resolveLimits(config, input.instrument, input.timeframe);

  if (!limits) {
    failures.push({
      code: 'MISSING_RISK_CONFIG',
      message: `No risk config found for ${input.instrument} ${input.timeframe}.`,
    });
    return { passed: false, failures };
  }

  if (slDistance > limits.maxSlAbsolute) {
    failures.push({
      code: 'SL_ABSOLUTE_EXCEEDED',
      message: 'Stop loss distance exceeds absolute max.',
      details: { slDistance, limit: limits.maxSlAbsolute },
    });
  }

  if (input.atr <= 0 || !Number.isFinite(input.atr) || slDistance / input.atr > limits.maxSlAtrMultiple) {
    failures.push({
      code: 'SL_ATR_EXCEEDED',
      message: 'Stop loss distance exceeds ATR-relative max.',
      details: { slDistance, atr: input.atr, limit: limits.maxSlAtrMultiple },
    });
  }

  const rToTp1 = rewardDistance / slDistance;
  if (rToTp1 < limits.minRToTp1) {
    failures.push({
      code: 'R_RATIO_TOO_LOW',
      message: 'Risk-reward ratio to TP1 is below minimum threshold.',
      details: { ratio: rToTp1, minimum: limits.minRToTp1 },
    });
  }

  if (input.spread > limits.maxSpread) {
    failures.push({
      code: 'SPREAD_TOO_HIGH',
      message: 'Spread exceeds configured max.',
      details: { spread: input.spread, limit: limits.maxSpread },
    });
  }

  if (input.expectedSlippage > limits.maxSlippage) {
    failures.push({
      code: 'SLIPPAGE_TOO_HIGH',
      message: 'Expected slippage exceeds configured max.',
      details: { slippage: input.expectedSlippage, limit: limits.maxSlippage },
    });
  }

  return { passed: failures.length === 0, failures };
};
