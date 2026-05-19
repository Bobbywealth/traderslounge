export interface RedFolderEvent {
  startsAtIso: string;
  instrument?: string;
  impact?: 'low' | 'medium' | 'high' | 'red';
}

export interface NewsGateConfig {
  blackoutMinutesBefore: number;
  blackoutMinutesAfter: number;
  enabledImpacts: Array<'high' | 'red'>;
}

export interface NewsGateInput {
  now: Date;
  instrument: string;
  events: RedFolderEvent[];
}

export interface NewsGateResult {
  passed: boolean;
  blockedBy?: RedFolderEvent;
  reason?: string;
}

export const defaultNewsGateConfig: NewsGateConfig = {
  blackoutMinutesBefore: 30,
  blackoutMinutesAfter: 30,
  enabledImpacts: ['high', 'red'],
};

const eventAppliesToInstrument = (event: RedFolderEvent, instrument: string): boolean => {
  if (!event.instrument) return true;
  const normalizedInstrument = instrument.toUpperCase();
  const normalizedEventInstrument = event.instrument.toUpperCase();

  return normalizedInstrument.includes(normalizedEventInstrument) || normalizedEventInstrument.includes(normalizedInstrument);
};

export const evaluateNewsGate = (
  input: NewsGateInput,
  config: NewsGateConfig = defaultNewsGateConfig,
): NewsGateResult => {
  const nowMs = input.now.getTime();

  for (const event of input.events) {
    const impact = event.impact ?? 'red';
    if (!config.enabledImpacts.includes(impact as 'high' | 'red')) {
      continue;
    }

    if (!eventAppliesToInstrument(event, input.instrument)) {
      continue;
    }

    const eventMs = new Date(event.startsAtIso).getTime();
    if (!Number.isFinite(eventMs)) {
      continue;
    }

    const windowStart = eventMs - config.blackoutMinutesBefore * 60_000;
    const windowEnd = eventMs + config.blackoutMinutesAfter * 60_000;

    if (nowMs >= windowStart && nowMs <= windowEnd) {
      return {
        passed: false,
        blockedBy: event,
        reason: `Inside red-folder blackout window (${config.blackoutMinutesBefore}m before / ${config.blackoutMinutesAfter}m after).`,
      };
    }
  }

  return { passed: true };
};
