/**
 * __tests__/algorithms/engine.test.ts
 * Integration tests for the r-FAST-CR aggregation engine.
 * Verifies quorum guard, stop criterion, and method dispatch.
 */

import { describe, it, expect } from 'vitest';
import { runAggregationEngine } from '@mic/backend/algorithms/engine';
import type { Ballot } from '@mic/backend/algorithms/types';

const makeBallot = (pairs: [string, number][]): Ballot => new Map(pairs);

const projectIds = ['A', 'B', 'C', 'D'];

const fullBallots = new Map<string, Ballot>([
  ['p1', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
  ['p2', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
  ['p3', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
  ['p4', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
]);

describe('runAggregationEngine — Quorum Guard', () => {
  it('returns quorumMet=false when m_efectivo < minMembers', () => {
    const twoVoters = new Map<string, Ballot>([
      ['p1', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
      ['p2', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
    ]);
    const output = runAggregationEngine({
      projectIds, ballots: twoVoters, method: 'BORDA',
      minMembers: 3, tauThreshold: 0.80, currentRound: 1, maxRounds: 3,
    });
    expect(output.quorumMet).toBe(false);
    expect(output.result).toBeNull();
    expect(output.shouldConclude).toBe(false);
    expect(output.shouldAdvance).toBe(false);
  });

  it('accepts exactly minMembers voters', () => {
    const threeVoters = new Map<string, Ballot>([
      ['p1', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
      ['p2', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
      ['p3', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
    ]);
    const output = runAggregationEngine({
      projectIds, ballots: threeVoters, method: 'BORDA',
      minMembers: 3, tauThreshold: 0.80, currentRound: 1, maxRounds: 3,
    });
    expect(output.quorumMet).toBe(true);
    expect(output.result).not.toBeNull();
    expect(output.result!.mEfectivo).toBe(3);
    expect(output.result!.tauStar).toBe(1.0);
    expect(output.result!.ranking).toEqual([
      { id: 'A', score: 9, midRank: 1 },
      { id: 'B', score: 6, midRank: 2 },
      { id: 'C', score: 3, midRank: 3 },
      { id: 'D', score: 0, midRank: 4 },
    ]);
  });
});

describe('runAggregationEngine — Stop Criterion', () => {
  it('concludes when τ* >= tauThreshold', () => {
    // Perfect agreement → τ* = 1.0 >= 0.80
    const output = runAggregationEngine({
      projectIds, ballots: fullBallots, method: 'BORDA',
      minMembers: 3, tauThreshold: 0.80, currentRound: 1, maxRounds: 3,
    });
    expect(output.result!.tauStar).toBe(1.0);
    expect(output.shouldConclude).toBe(true);
    expect(output.shouldAdvance).toBe(false);
  });

  it('advances when τ* < tauThreshold and round < maxRounds', () => {
    // Divergent preferences → τ* < 0.95
    const divergentBallots = new Map<string, Ballot>([
      ['p1', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
      ['p2', makeBallot([['D', 1], ['C', 2], ['B', 3], ['A', 4]])],
      ['p3', makeBallot([['B', 1], ['A', 2], ['D', 3], ['C', 4]])],
    ]);
    const output = runAggregationEngine({
      projectIds, ballots: divergentBallots, method: 'BORDA',
      minMembers: 3, tauThreshold: 0.95, currentRound: 1, maxRounds: 3,
    });
    expect(output.shouldAdvance).toBe(true);
    expect(output.shouldConclude).toBe(false);
  });

  it('concludes at maxRounds even if τ* < tauThreshold', () => {
    const divergentBallots = new Map<string, Ballot>([
      ['p1', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
      ['p2', makeBallot([['D', 1], ['C', 2], ['B', 3], ['A', 4]])],
      ['p3', makeBallot([['B', 1], ['A', 2], ['D', 3], ['C', 4]])],
    ]);
    const output = runAggregationEngine({
      projectIds, ballots: divergentBallots, method: 'BORDA',
      minMembers: 3, tauThreshold: 0.95, currentRound: 3, maxRounds: 3, // At max round
    });
    expect(output.shouldConclude).toBe(true);
    expect(output.shouldAdvance).toBe(false);
  });
});

describe('runAggregationEngine — Method Dispatch', () => {
  const baseCfg = { projectIds, ballots: fullBallots, minMembers: 3, tauThreshold: 0.80, currentRound: 1, maxRounds: 3 };

  it('dispatches to Borda correctly', () => {
    const output = runAggregationEngine({ ...baseCfg, method: 'BORDA' });
    expect(output.result!.method).toBe('BORDA');
    expect(output.result!.ranking).toEqual([
      { id: 'A', score: 12, midRank: 1 },
      { id: 'B', score: 8, midRank: 2 },
      { id: 'C', score: 4, midRank: 3 },
      { id: 'D', score: 0, midRank: 4 },
    ]);
    expect(output.result!.tauStar).toBe(1.0);
  });

  it('dispatches to Schulze correctly', () => {
    const output = runAggregationEngine({ ...baseCfg, method: 'SCHULZE' });
    expect(output.result!.method).toBe('SCHULZE');
    expect(output.result!.ranking).toEqual([
      { id: 'A', score: 3, midRank: 1 },
      { id: 'B', score: 2, midRank: 2 },
      { id: 'C', score: 1, midRank: 3 },
      { id: 'D', score: 0, midRank: 4 },
    ]);
    expect(output.result!.tauStar).toBe(1.0);
  });

  it('dispatches to Kemeny-Young correctly', () => {
    const output = runAggregationEngine({ ...baseCfg, method: 'KEMENY_YOUNG' });
    expect(output.result!.method).toBe('KEMENY_YOUNG');
    expect(output.result!.ranking).toEqual([
      { id: 'A', score: -1, midRank: 1 },
      { id: 'B', score: -2, midRank: 2 },
      { id: 'C', score: -3, midRank: 3 },
      { id: 'D', score: -4, midRank: 4 },
    ]);
    expect(output.result!.tauStar).toBe(1.0);
  });

  it('includes m_efectivo in result', () => {
    const output = runAggregationEngine({ ...baseCfg, method: 'BORDA' });
    expect(output.result!.mEfectivo).toBe(4);
    expect(output.result!.effectiveVoters).toBe(4);
  });

  it('includes voterCIX for all voters', () => {
    const output = runAggregationEngine({ ...baseCfg, method: 'BORDA' });
    expect(output.result!.voterCIX).toHaveLength(4);
    expect(output.result!.voterCIX.map(v => ({ id: v.participantId, cix: v.cix }))).toEqual([
      { id: 'p1', cix: 1.0 },
      { id: 'p2', cix: 1.0 },
      { id: 'p3', cix: 1.0 },
      { id: 'p4', cix: 1.0 },
    ]);
  });
});
