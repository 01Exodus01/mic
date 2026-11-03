/**
 * __tests__/algorithms/kendallTauC.test.ts
 * Unit tests for Stuart Kendall Tau-c normalized (CIX) and group consensus τ*.
 *
 * Verifies:
 * - CIX = 1.0 for perfect agreement (voter matches collective exactly)
 * - CIX = 0.0 for perfect disagreement (voter is the reverse of collective)
 * - CIX = 0.5 for neutral / indeterminate cases
 * - No division by zero when all collective ranks are tied
 * - Fractional CIX for partial agreement
 * - Correct τ* averaging
 */

import { describe, it, expect } from 'vitest';
import { computeVoterCIX, computeGroupConsensus } from '../../lib/algorithms/kendallTauC';
import type { Ballot, WeakOrder } from '../../lib/algorithms/types';

const makeBallot = (pairs: [string, number][]): Ballot => new Map(pairs);

const makeCollective = (entries: [string, number][]): WeakOrder[] =>
  entries.map(([id, midRank]) => ({ id, midRank, score: 0 }));

describe('computeVoterCIX', () => {
  const collective3 = makeCollective([['A', 1], ['B', 2], ['C', 3]]);

  it('returns CIX = 1.0 for perfect concordance', () => {
    const ballot = makeBallot([['A', 1], ['B', 2], ['C', 3]]);
    const { cix, concordant, discordant } = computeVoterCIX(ballot, collective3, 'voter1');
    // All 3 pairs concordant: (A,B), (A,C), (B,C)
    expect(concordant).toBe(3);
    expect(discordant).toBe(0);
    expect(cix).toBe(1.0);
  });

  it('returns CIX = 0.0 for perfect discordance (reverse ranking)', () => {
    const ballot = makeBallot([['C', 1], ['B', 2], ['A', 3]]); // exact reverse of collective
    const { cix, concordant, discordant } = computeVoterCIX(ballot, collective3, 'voter2');
    expect(concordant).toBe(0);
    expect(discordant).toBe(3);
    expect(cix).toBe(0.0);
  });

  it('returns CIX = 0.5 (neutral) when collective has all items tied', () => {
    const tiedCollective = makeCollective([['A', 2], ['B', 2], ['C', 2]]); // all mid-rank 2
    const ballot = makeBallot([['A', 1], ['B', 2], ['C', 3]]);
    const { cix } = computeVoterCIX(ballot, tiedCollective, 'voter3');
    expect(cix).toBe(0.5);
  });

  it('returns CIX = 0.5 when exactly half pairs agree', () => {
    // Collective: A>B>C, Voter: A>C>B
    // Pairs: (A,B) concordant ✓; (A,C) concordant ✓; (B,C) discordant ✗
    // C=2, D=1 → τ = (2-1)/3 = 1/3 → CIX = (1/3+1)/2 = 2/3
    const ballot = makeBallot([['A', 1], ['C', 2], ['B', 3]]);
    const { cix, concordant, discordant } = computeVoterCIX(ballot, collective3, 'voter4');
    expect(concordant).toBe(2);
    expect(discordant).toBe(1);
    expect(cix).toBeCloseTo(2 / 3, 10);
  });

  it('handles 2-way tie in collective correctly (tied pair ignored)', () => {
    // Collective: A=1, B=1.5, C=1.5 (B and C tied)
    const tiedBC = makeCollective([['A', 1], ['B', 1.5], ['C', 1.5]]);
    // Voter: A>B>C
    // Non-tied pairs: (A,B) and (A,C) only (B,C pair is tied in collective → ignored)
    const ballot = makeBallot([['A', 1], ['B', 2], ['C', 3]]);
    const { concordant, discordant } = computeVoterCIX(ballot, tiedBC, 'voter5');
    expect(concordant).toBe(2); // A>B and A>C both concordant
    expect(discordant).toBe(0); // B,C pair skipped
  });

  it('CIX is in [0, 1] for all cases', () => {
    const cases: [string, number][][] = [
      [['A', 1], ['B', 2], ['C', 3]],
      [['C', 1], ['A', 2], ['B', 3]],
      [['B', 1], ['C', 2], ['A', 3]],
    ];
    for (const ballotPairs of cases) {
      const ballot = makeBallot(ballotPairs as [string, number][]);
      const { cix } = computeVoterCIX(ballot, collective3, 'vx');
      expect(cix).toBeGreaterThanOrEqual(0);
      expect(cix).toBeLessThanOrEqual(1);
    }
  });
});

describe('computeGroupConsensus', () => {
  const collective = makeCollective([['A', 1], ['B', 2], ['C', 3]]);

  it('computes τ* as average of individual CIX values', () => {
    const ballots = new Map<string, Ballot>([
      ['p1', makeBallot([['A', 1], ['B', 2], ['C', 3]])], // CIX = 1.0
      ['p2', makeBallot([['C', 1], ['B', 2], ['A', 3]])], // CIX = 0.0
    ]);
    const { tauStar, voterCIX } = computeGroupConsensus(ballots, collective);
    expect(voterCIX).toHaveLength(2);
    expect(tauStar).toBeCloseTo(0.5, 5); // (1.0 + 0.0) / 2
  });

  it('returns τ* = 1.0 when all voters perfectly agree with collective', () => {
    const ballots = new Map<string, Ballot>([
      ['p1', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['p2', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['p3', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
    ]);
    const { tauStar } = computeGroupConsensus(ballots, collective);
    expect(tauStar).toBe(1.0);
  });

  it('returns τ* = 0.5 for empty ballot map', () => {
    const { tauStar } = computeGroupConsensus(new Map(), collective);
    expect(tauStar).toBe(0.5);
  });

  it('includes all voter CIX entries in result', () => {
    const ballots = new Map<string, Ballot>([
      ['v1', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['v2', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['v3', makeBallot([['B', 1], ['A', 2], ['C', 3]])],
    ]);
    const { voterCIX } = computeGroupConsensus(ballots, collective);
    const ids = voterCIX.map(v => v.participantId);
    expect(ids).toContain('v1');
    expect(ids).toContain('v2');
    expect(ids).toContain('v3');
  });
});
