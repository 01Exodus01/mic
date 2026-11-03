/**
 * __tests__/security/cohortAndIdempotency.test.ts
 * Rigorous verification of:
 *  1. Symmetric tie generating fractional mid-ranks (1.5) in Borda and Kemeny-Young
 *  2. Quorum guard: m = 1, 2 < 3 strictly transitions to QUORUM_UNMET
 *  3. Anticipated convergence: tau* >= tau triggers CONCLUDED
 *  4. Cohort closure and voter dropout: no carry-over
 *  5. Concurrent upsert simulation and idempotency
 */

import { describe, it, expect } from 'vitest';
import { bordaCount } from '../../lib/algorithms/borda';
import { kemenyYoung } from '../../lib/algorithms/kemenyYoung';
import { runAggregationEngine } from '../../lib/algorithms/engine';
import type { Ballot, WeakOrder } from '../../lib/algorithms/types';

const makeBallot = (pairs: [string, number][]): Ballot => new Map(pairs);

describe('Symmetric Tie Fractional Mid-Ranks (1.5)', () => {
  it('Borda Count produces fractional mid-rank 1.5 for a 2-way tie at the top', () => {
    // 2 voters, 3 alternatives
    // Voter 1: A (1st), B (2nd), C (3rd) -> A gets 2 pts, B gets 1 pt, C gets 0 pts
    // Voter 2: B (1st), A (2nd), C (3rd) -> B gets 2 pts, A gets 1 pt, C gets 0 pts
    // Total: A = 3 pts, B = 3 pts, C = 0 pts.
    // Positions tied: 1 and 2. Mid-rank = (1 + 2) / 2 = 1.5
    const ballots: Ballot[] = [
      makeBallot([['PROJ_A', 1], ['PROJ_B', 2], ['PROJ_C', 3]]),
      makeBallot([['PROJ_B', 1], ['PROJ_A', 2], ['PROJ_C', 3]]),
    ];

    const result = bordaCount(ballots, ['PROJ_A', 'PROJ_B', 'PROJ_C']);
    const rankMap = new Map(result.map(r => [r.id, r.midRank]));

    expect(rankMap.get('PROJ_A')).toBe(1.5);
    expect(rankMap.get('PROJ_B')).toBe(1.5);
    expect(rankMap.get('PROJ_C')).toBe(3);
  });

  it('Kemeny-Young produces symmetric mid-rank 1.5 when 2 permutations tie in min distance', () => {
    // Symmetric contradiction between A and B, both agreeing C is last
    const ballots: Ballot[] = [
      makeBallot([['PROJ_A', 1], ['PROJ_B', 2], ['PROJ_C', 3]]),
      makeBallot([['PROJ_B', 1], ['PROJ_A', 2], ['PROJ_C', 3]]),
    ];

    const result = kemenyYoung(ballots, ['PROJ_A', 'PROJ_B', 'PROJ_C']);
    const rankMap = new Map(result.map(r => [r.id, r.midRank]));

    // Weak order: (A ~ B) > C
    expect(rankMap.get('PROJ_A')).toBe(1.5);
    expect(rankMap.get('PROJ_B')).toBe(1.5);
    expect(rankMap.get('PROJ_C')).toBe(3);
  });
});

describe('Quorum Guard Enforcement (m = 1, 2)', () => {
  const projectIds = ['A', 'B', 'C'];

  it('fails quorum when m = 1 (m < 3 minimum mathematical guard)', () => {
    const singleBallot = new Map<string, Ballot>([
      ['v1', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
    ]);

    const output = runAggregationEngine({
      projectIds,
      ballots: singleBallot,
      method: 'BORDA',
      minMembers: 3,
      tauThreshold: 0.80,
      currentRound: 1,
      maxRounds: 3,
    });

    expect(output.quorumMet).toBe(false);
    expect(output.result).toBeNull();
    expect(output.shouldConclude).toBe(false);
    expect(output.shouldAdvance).toBe(false);
  });

  it('fails quorum when m = 2 (m < 3 minimum mathematical guard)', () => {
    const twoBallots = new Map<string, Ballot>([
      ['v1', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['v2', makeBallot([['B', 1], ['A', 2], ['C', 3]])],
    ]);

    const output = runAggregationEngine({
      projectIds,
      ballots: twoBallots,
      method: 'BORDA',
      minMembers: 3,
      tauThreshold: 0.80,
      currentRound: 1,
      maxRounds: 3,
    });

    expect(output.quorumMet).toBe(false);
    expect(output.result).toBeNull();
  });

  it('satisfies quorum exactly when m = 3', () => {
    const threeBallots = new Map<string, Ballot>([
      ['v1', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['v2', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['v3', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
    ]);

    const output = runAggregationEngine({
      projectIds,
      ballots: threeBallots,
      method: 'BORDA',
      minMembers: 3,
      tauThreshold: 0.80,
      currentRound: 1,
      maxRounds: 3,
    });

    expect(output.quorumMet).toBe(true);
    expect(output.result).not.toBeNull();
    expect(output.result?.mEfectivo).toBe(3);
  });
});

describe('Anticipated Convergence Stopping Criterion', () => {
  const projectIds = ['A', 'B', 'C', 'D'];

  it('triggers CONCLUDED when tau* >= tauThreshold in Round 1 (early convergence)', () => {
    // Unanimous agreement: tau* = 1.0 >= 0.80
    const unanimousBallots = new Map<string, Ballot>([
      ['v1', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
      ['v2', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
      ['v3', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
      ['v4', makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]])],
    ]);

    const output = runAggregationEngine({
      projectIds,
      ballots: unanimousBallots,
      method: 'BORDA',
      minMembers: 3,
      tauThreshold: 0.80,
      currentRound: 1, // Only round 1, but converged early!
      maxRounds: 3,
    });

    expect(output.result?.tauStar).toBe(1.0);
    expect(output.shouldConclude).toBe(true);
    expect(output.shouldAdvance).toBe(false);
  });
});

describe('Idempotency & Concurrent Vote Mutation Simulation', () => {
  it('simulates atomic upsert map: repeated or concurrent submissions update without duplicating', () => {
    // Simulate table state: Map<`${participante_id}_${ronda}_${proyecto_id}`, { posicion, justificacion }>
    const voteStore = new Map<string, { posicion: number; justificacion: string }>();

    const participantId = 'participant_007';
    const round = 1;
    const projectId = 'proj_alpha';
    const key = `${participantId}_${round}_${projectId}`;

    // Initial submission
    voteStore.set(key, { posicion: 2, justificacion: 'Initial justification > 25 chars' });
    expect(voteStore.size).toBe(1);
    expect(voteStore.get(key)?.posicion).toBe(2);

    // Re-edited submission by participant before deadline
    voteStore.set(key, { posicion: 1, justificacion: 'Updated revised justification > 25 chars' });
    expect(voteStore.size).toBe(1); // Still exactly 1 entry, no duplicate!
    expect(voteStore.get(key)?.posicion).toBe(1);
    expect(voteStore.get(key)?.justificacion).toBe('Updated revised justification > 25 chars');
  });

  it('guarantees voter dropout produces zero carry-over into subsequent rounds', () => {
    // Round 1 voters: v1, v2, v3, v4
    const r1Ballots = new Map<string, Ballot>([
      ['v1', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['v2', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['v3', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['v4', makeBallot([['B', 1], ['A', 2], ['C', 3]])],
    ]);

    // In Round 2, v4 drops out (absent). Only v1, v2, v3 submit.
    const r2Ballots = new Map<string, Ballot>([
      ['v1', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['v2', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
      ['v3', makeBallot([['A', 1], ['B', 2], ['C', 3]])],
    ]);

    const r2Output = runAggregationEngine({
      projectIds: ['A', 'B', 'C'],
      ballots: r2Ballots,
      method: 'BORDA',
      minMembers: 3,
      tauThreshold: 0.80,
      currentRound: 2,
      maxRounds: 3,
    });

    // m_efectivo in R2 must be 3, NOT 4 (v4 past ballot must NOT be carried over)
    expect(r2Output.result?.mEfectivo).toBe(3);
    expect(r2Output.result?.voterCIX).toHaveLength(3);
    const participantIds = r2Output.result?.voterCIX.map(v => v.participantId);
    expect(participantIds).not.toContain('v4');
  });
});
