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
// PT-33: kendallTauC.ts was only a re-export of kendallTau.ts and has been removed
import { computeVoterCIX, computeGroupConsensus, PRIMARY_CONCORDANCE_INDEX } from '@mic/backend/algorithms/kendallTau';
import { runAggregationEngine } from '@mic/backend/algorithms/engine';
import type { Ballot, WeakOrder } from '@mic/backend/algorithms/types';

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

/**
 * AGENTS.md E-14 (r-fast-cr-5): the CIX and τ* are based on Stuart's tau-c.
 * Collective A = B (mid-rank 1.5) > C, ballot A > B > C: pairs (A,C) and (B,C)
 * concordant, (A,B) tied in the group. C = 2, D = 0, n = 3, q = min(3, 2) = 2.
 *   tau_c = 2·2·2 / (3²·1) = 8/9        → CIX = 17/18 ≈ 0.9444
 *   tau_b = 2 / √(3·2)     = 0.81650   → CIX ≈ 0.9082 (different on purpose)
 */
describe('E-14: el índice principal es tau-c de Stuart', () => {
  const tied = makeCollective([['A', 1.5], ['B', 1.5], ['C', 3]]);
  const ballot = makeBallot([['A', 1], ['B', 2], ['C', 3]]);

  it('la métrica principal del procedimiento es TAU_C', () => {
    expect(PRIMARY_CONCORDANCE_INDEX).toBe('TAU_C');
  });

  it('cix = (tau_c + 1) / 2, no (tau_b + 1) / 2, cuando el orden del grupo tiene empates', () => {
    const v = computeVoterCIX(ballot, tied, 'p1');
    expect(v.stuartTauC).toBeCloseTo(8 / 9, 12);
    expect(v.tauB).toBeCloseTo(2 / Math.sqrt(6), 12);
    expect(v.cix).toBeCloseTo(17 / 18, 12);
    expect(v.cix).toBe(v.stuartCix);
    expect(v.cix).not.toBeCloseTo((v.tauB! + 1) / 2, 3);
  });

  it('τ* es el promedio del CIX de tau-c', () => {
    const ballots = new Map<string, Ballot>([
      ['p1', ballot],
      ['p2', makeBallot([['B', 1], ['A', 2], ['C', 3]])],
      ['p3', makeBallot([['C', 1], ['A', 2], ['B', 3]])],
    ]);
    const { voterCIX, tauStar, stuartTauStar } = computeGroupConsensus(ballots, tied);
    // p3: (A,C) and (B,C) discordant → tau_c = −8/9, CIX = 1/18
    expect(voterCIX.map((v) => v.cix)).toEqual(voterCIX.map((v) => v.stuartCix));
    expect(tauStar).toBeCloseTo((17 / 18 + 17 / 18 + 1 / 18) / 3, 12);
    expect(tauStar).toBe(stuartTauStar);
  });

  it('TAU_B solo reproduce informes anteriores a r-fast-cr-5', () => {
    const v = computeVoterCIX(ballot, tied, 'p1', 'TAU_B');
    expect(v.cix).toBeCloseTo((2 / Math.sqrt(6) + 1) / 2, 12);
    expect(v.stuartCix).toBeCloseTo(17 / 18, 12);
  });

  it('el motor decide el consenso con tau-c: τ* de tau-c sobre el umbral aunque el de tau-b quede debajo', () => {
    // Borda on these 4 ballots: A = 6, B = 6, C = 0 → A and B tied (variant with ties, no rule)
    const ballots = new Map<string, Ballot>([
      ['p1', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['p2', makeBallot([['B', 1], ['A', 2], ['C', 3]])],
      ['p3', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['p4', makeBallot([['B', 1], ['A', 2], ['C', 3]])],
    ]);
    const base = { optionIds: ['A', 'B', 'C'], ballots, method: 'BORDA' as const, minMembers: 3, currentRound: 1, maxRounds: 3 };
    // Every ballot: C = 2, D = 0 → CIX tau-c = 17/18 ≈ 0.944; CIX tau-b ≈ 0.908
    const threshold = 0.93;
    const out = runAggregationEngine({ ...base, tauThreshold: threshold, tieBreak: { rule: 'NONE', optionOrder: ['A', 'B', 'C'] }, concordanceVariant: 'WITH_TIES' });
    expect(out.result!.concordanceIndex).toBe('TAU_C');
    expect(out.result!.tauStar).toBeCloseTo(17 / 18, 12);
    expect(out.shouldConclude).toBe(true);
    const legacy = runAggregationEngine({ ...base, tauThreshold: threshold, tieBreak: { rule: 'NONE', optionOrder: ['A', 'B', 'C'] }, concordanceVariant: 'WITH_TIES', concordanceIndex: 'TAU_B' });
    expect(legacy.result!.tauStar).toBeCloseTo((2 / Math.sqrt(6) + 1) / 2, 12);
    expect(legacy.shouldConclude).toBe(false);
  });

  it('sin empates en el orden del grupo (salas nuevas), tau-c = tau-b = gamma', () => {
    const strict = makeCollective([['A', 1], ['B', 2], ['C', 3], ['D', 4]]);
    const v = computeVoterCIX(makeBallot([['B', 1], ['A', 2], ['D', 3], ['C', 4]]), strict, 'p1');
    expect(v.stuartTauC).toBeCloseTo(v.tauB!, 12);
    expect(v.gamma).toBeCloseTo(v.tauB!, 12);
  });
});
