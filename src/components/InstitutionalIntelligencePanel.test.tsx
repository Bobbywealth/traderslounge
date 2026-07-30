import { describe, expect, it } from 'vitest';
import { getIntelligenceDecisionState, type InstitutionalIntelligenceV2 } from './InstitutionalIntelligencePanel';

const intelligence = (overrides: Partial<InstitutionalIntelligenceV2> = {}): InstitutionalIntelligenceV2 => ({
  version: '2.0.0',
  multi_agent_consensus: {
    consensus_direction: 'BUY',
    canonical_direction: 'BUY',
    agreement_pct: 71.4,
    status: 'ALIGNED',
    votes: [],
    dissenting_agents: [],
    veto_reasons: [],
  },
  trade_grade: { grade: 'A-', score: 82, executable: true, deductions: [] },
  ...overrides,
});

describe('getIntelligenceDecisionState', () => {
  it('returns READY only when canonical eligibility and timing are ready', () => {
    expect(getIntelligenceDecisionState(intelligence(), true, 'READY')).toBe('READY');
  });

  it('returns BLOCKED when a veto agent blocks the setup', () => {
    const payload = intelligence({
      multi_agent_consensus: {
        consensus_direction: 'NEUTRAL',
        canonical_direction: 'BUY',
        agreement_pct: 42.9,
        status: 'BLOCKED',
        votes: [],
        dissenting_agents: [],
        veto_reasons: ['Execution is blocked by calendar status BLOCKED.'],
      },
    });
    expect(getIntelligenceDecisionState(payload, true, 'READY')).toBe('BLOCKED');
  });

  it('does not convert an advisory grade into readiness', () => {
    expect(getIntelligenceDecisionState(intelligence(), false, 'WAIT')).toBe('WAIT');
  });

  it('renders missing intelligence as unavailable instead of guessing', () => {
    expect(getIntelligenceDecisionState(undefined, true, 'READY')).toBe('UNAVAILABLE');
    expect(getIntelligenceDecisionState({ status: 'UNAVAILABLE' }, true, 'READY')).toBe('UNAVAILABLE');
  });
});
