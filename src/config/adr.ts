export type AdrLookbackPeriod = 5 | 10 | 14 | 20;

export type AdrHighLowMode = 'day-open-half' | 'midpoint-half';

export type AssetClass = 'forex' | 'crypto';

export type AdrDayBoundaryTimezone = 'America/New_York' | 'UTC';

export type AdrRangeDefinition = 'high-low' | 'true-range';

export interface AdrConfig {
  lookbackPeriod: AdrLookbackPeriod;
  dayBoundaryTimezone: Record<AssetClass, AdrDayBoundaryTimezone>;
  includeWeekendsForCrypto: boolean;
  rangeDefinition: AdrRangeDefinition;
  highLowMode: AdrHighLowMode;
}

export const ADR_CONFIG: AdrConfig = {
  lookbackPeriod: 5,
  dayBoundaryTimezone: {
    forex: 'America/New_York',
    crypto: 'UTC',
  },
  includeWeekendsForCrypto: true,
  rangeDefinition: 'high-low',
  highLowMode: 'day-open-half',
};
