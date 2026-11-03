import { describe, it, expect } from 'vitest';
import { isValidTransition, getValidTransitions, isTerminalState, isVotingOpen } from '../../lib/state-machine';
import { RoomStatus } from '@prisma/client';

describe('State Machine transitions', () => {
  it('allows DRAFT -> ROUND_OPEN', () => {
    expect(isValidTransition('DRAFT', 'ROUND_OPEN')).toBe(true);
  });

  it('rejects DRAFT -> CONCLUDED or DRAFT -> PROCESSING directly', () => {
    expect(isValidTransition('DRAFT', 'CONCLUDED')).toBe(false);
    expect(isValidTransition('DRAFT', 'PROCESSING')).toBe(false);
  });

  it('allows ROUND_OPEN -> PROCESSING, ROUND_OPEN -> INSUFFICIENT_VOTES, and ROUND_OPEN -> CANCELLED (cancel)', () => {
    expect(isValidTransition('ROUND_OPEN', 'PROCESSING')).toBe(true);
    expect(isValidTransition('ROUND_OPEN', 'INSUFFICIENT_VOTES')).toBe(true);
    expect(isValidTransition('ROUND_OPEN', 'CANCELLED')).toBe(true);
  });

  it('allows INSUFFICIENT_VOTES -> ROUND_OPEN (extend) or CANCELLED (cancel)', () => {
    expect(isValidTransition('INSUFFICIENT_VOTES', 'ROUND_OPEN')).toBe(true);
    expect(isValidTransition('INSUFFICIENT_VOTES', 'CANCELLED')).toBe(true);
  });

  it('allows PROCESSING -> CONCLUDED (reached tau or max rounds) or ROUND_FEEDBACK', () => {
    expect(isValidTransition('PROCESSING', 'CONCLUDED')).toBe(true);
    expect(isValidTransition('PROCESSING', 'ROUND_FEEDBACK')).toBe(true);
  });

  it('allows ROUND_FEEDBACK -> ROUND_OPEN for next round and ROUND_FEEDBACK -> CANCELLED for cancel', () => {
    expect(isValidTransition('ROUND_FEEDBACK', 'ROUND_OPEN')).toBe(true);
    expect(isValidTransition('ROUND_FEEDBACK', 'CANCELLED')).toBe(true);
  });

  it('identifies CONCLUDED and CANCELLED as terminal states with no valid transitions', () => {
    expect(isTerminalState('CONCLUDED')).toBe(true);
    expect(isTerminalState('CANCELLED')).toBe(true);
    expect(getValidTransitions('CONCLUDED')).toEqual([]);
    expect(getValidTransitions('CANCELLED')).toEqual([]);
    expect(isValidTransition('CONCLUDED', 'ROUND_OPEN')).toBe(false);
    expect(isValidTransition('CANCELLED', 'ROUND_OPEN')).toBe(false);
  });

  it('identifies ROUND_OPEN as the only voting state', () => {
    expect(isVotingOpen('ROUND_OPEN')).toBe(true);
    expect(isVotingOpen('DRAFT')).toBe(false);
    expect(isVotingOpen('PROCESSING')).toBe(false);
    expect(isVotingOpen('ROUND_FEEDBACK')).toBe(false);
    expect(isVotingOpen('INSUFFICIENT_VOTES')).toBe(false);
    expect(isVotingOpen('CONCLUDED')).toBe(false);
  });
});
