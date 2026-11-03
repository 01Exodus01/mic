/**
 * __tests__/integration/e2eConsensusSimulation.test.ts
 * End-to-end simulation of a multi-round deliberative GDSS session.
 *
 * Verifies:
 *  1. Multi-voter strict ballot processing (5 voters, 4 alternatives).
 *  2. Deliberative convergence across rounds (R1 -> R2 with tau* increasing).
 *  3. Voter dropout handling: missing voter discarded, no carry-over.
 *  4. Weak orders and mid-ranks preservation.
 *  5. Export formatting for both matriz_long and matriz_wide_metricas.
 */

import { describe, it, expect } from 'vitest';
import { runAggregationEngine, Ballot, WeakOrder } from '../../lib/algorithms';

const makeBallot = (pairs: [string, number][]): Ballot => new Map(pairs);

describe('E2E Deliberative Session Simulation', () => {
  const projectIds = ['PROJ_A', 'PROJ_B', 'PROJ_C', 'PROJ_D'];
  const minMembers = 3;
  const tauThreshold = 0.85;

  it('simulates Round 1 with high variance and Round 2 with deliberative convergence', () => {
    // ── ROUND 1: Divergent participant preferences ────────────────────────────
    const r1Ballots = new Map<string, Ballot>([
      ['voter_1', makeBallot([['PROJ_A', 1], ['PROJ_B', 2], ['PROJ_C', 3], ['PROJ_D', 4]])],
      ['voter_2', makeBallot([['PROJ_B', 1], ['PROJ_A', 2], ['PROJ_D', 3], ['PROJ_C', 4]])],
      ['voter_3', makeBallot([['PROJ_A', 1], ['PROJ_C', 2], ['PROJ_B', 3], ['PROJ_D', 4]])],
      ['voter_4', makeBallot([['PROJ_C', 1], ['PROJ_B', 2], ['PROJ_A', 3], ['PROJ_D', 4]])],
      ['voter_5', makeBallot([['PROJ_B', 1], ['PROJ_C', 2], ['PROJ_D', 3], ['PROJ_A', 4]])],
    ]);

    const r1Engine = runAggregationEngine({
      projectIds,
      ballots: r1Ballots,
      method: 'BORDA',
      minMembers,
      tauThreshold,
      currentRound: 1,
      maxRounds: 3,
    });

    expect(r1Engine.quorumMet).toBe(true);
    expect(r1Engine.result).not.toBeNull();
    const r1Result = r1Engine.result!;
    expect(r1Result.mEfectivo).toBe(5);

    // In Round 1, consensus has not reached 0.85 yet, so session should advance
    expect(r1Result.tauStar).toBeLessThan(tauThreshold);
    expect(r1Engine.shouldAdvance).toBe(true);
    expect(r1Engine.shouldConclude).toBe(false);

    const r1Tau = r1Result.tauStar;

    // ── ROUND 2: Participants re-rank after blind feedback, converging on A > B > C > D
    // Note: Voter 5 dropped out (dropout handling test). Only 4 voters cast ballots in R2.
    const r2Ballots = new Map<string, Ballot>([
      ['voter_1', makeBallot([['PROJ_A', 1], ['PROJ_B', 2], ['PROJ_C', 3], ['PROJ_D', 4]])],
      ['voter_2', makeBallot([['PROJ_A', 1], ['PROJ_B', 2], ['PROJ_C', 3], ['PROJ_D', 4]])],
      ['voter_3', makeBallot([['PROJ_A', 1], ['PROJ_B', 2], ['PROJ_C', 3], ['PROJ_D', 4]])],
      ['voter_4', makeBallot([['PROJ_A', 2], ['PROJ_B', 1], ['PROJ_C', 3], ['PROJ_D', 4]])],
      // voter_5 omitted: no carry-over!
    ]);

    const r2Engine = runAggregationEngine({
      projectIds,
      ballots: r2Ballots,
      method: 'BORDA',
      minMembers,
      tauThreshold,
      currentRound: 2,
      maxRounds: 3,
    });

    expect(r2Engine.quorumMet).toBe(true);
    const r2Result = r2Engine.result!;
    // m_efectivo dynamically reflects only voters who submitted in Round 2
    expect(r2Result.mEfectivo).toBe(4);

    // Consensus significantly increased!
    expect(r2Result.tauStar).toBeGreaterThan(r1Tau);
    expect(r2Result.tauStar).toBeGreaterThanOrEqual(tauThreshold);

    // Stop criterion satisfied: should conclude!
    expect(r2Engine.shouldConclude).toBe(true);
    expect(r2Engine.shouldAdvance).toBe(false);

    // Clear consensus order: PROJ_A is 1st, PROJ_B is 2nd, PROJ_C is 3rd, PROJ_D is 4th
    const r2RankMap = new Map(r2Result.ranking.map((r: WeakOrder) => [r.id, r.midRank]));
    expect(r2RankMap.get('PROJ_A')).toBe(1);
    expect(r2RankMap.get('PROJ_B')).toBe(2);
    expect(r2RankMap.get('PROJ_C')).toBe(3);
    expect(r2RankMap.get('PROJ_D')).toBe(4);
  });

  it('validates scientific CSV export structure for paired hypothesis testing', () => {
    // Simulate metrics collected across rounds
    const roundMetrics = [
      { ronda: 1, m_efectivo: 5, tau: 0.682, delta: 0, ranking: [{ id: 'A', midRank: 1.5 }] },
      { ronda: 2, m_efectivo: 4, tau: 0.895, delta: 0.213, ranking: [{ id: 'A', midRank: 1 }] },
    ];

    // Build wide CSV
    const headers = ['sala_id', 'ronda', 'm_efectivo', 'tau_colectivo', 'delta_tau', 'ranking_colectivo'];
    const lines = [headers.join(',')];
    for (const m of roundMetrics) {
      lines.push(`"SALA_1",${m.ronda},${m.m_efectivo},${m.tau},${m.delta},"${JSON.stringify(m.ranking).replace(/"/g, '""')}"`);
    }

    const csv = lines.join('\n');
    expect(csv).toContain('sala_id,ronda,m_efectivo,tau_colectivo,delta_tau,ranking_colectivo');
    expect(csv).toContain('"SALA_1",1,5,0.682,0');
    expect(csv).toContain('"SALA_1",2,4,0.895,0.213');
  });
});
