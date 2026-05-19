import {
  evaluatePreTradeRisk,
  GateFailure,
  PreTradeSignalInput,
  RiskConfig,
  defaultRiskConfig,
} from '../risk/preTradeFilter';
import {
  defaultNewsGateConfig,
  evaluateNewsGate,
  NewsGateConfig,
  RedFolderEvent,
} from '../news/newsGate';

export interface TradeSignalDraft extends PreTradeSignalInput {
  id: string;
  timestampIso: string;
}

export interface TradeAlert {
  id: string;
  instrument: string;
  timeframe: string;
  timestampIso: string;
  status: 'emitted' | 'blocked';
  blockers: Array<{ source: 'risk' | 'news'; details: string }>;
}

export interface TradeAlertDependencies {
  riskConfig?: RiskConfig;
  newsConfig?: NewsGateConfig;
  now?: Date;
  redFolderEvents?: RedFolderEvent[];
}

const stringifyFailure = (failure: GateFailure): string =>
  `${failure.code}: ${failure.message}`;

export const generateTradeAlert = (
  signal: TradeSignalDraft,
  deps: TradeAlertDependencies = {},
): TradeAlert => {
  const riskResult = evaluatePreTradeRisk(signal, deps.riskConfig ?? defaultRiskConfig);

  const newsResult = evaluateNewsGate(
    {
      now: deps.now ?? new Date(signal.timestampIso),
      instrument: signal.instrument,
      events: deps.redFolderEvents ?? [],
    },
    deps.newsConfig ?? defaultNewsGateConfig,
  );

  const blockers: TradeAlert['blockers'] = [];

  if (!riskResult.passed) {
    blockers.push(
      ...riskResult.failures.map((failure) => ({
        source: 'risk' as const,
        details: stringifyFailure(failure),
      })),
    );
  }

  if (!newsResult.passed) {
    blockers.push({
      source: 'news',
      details: newsResult.reason ?? 'Blocked by red-folder news event window.',
    });
  }

  return {
    id: signal.id,
    instrument: signal.instrument,
    timeframe: signal.timeframe,
    timestampIso: signal.timestampIso,
    status: blockers.length === 0 ? 'emitted' : 'blocked',
    blockers,
  };
};
