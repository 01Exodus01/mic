/**
 * __tests__/algorithms/kemenyYoung.test.ts
 * Unit tests for Kemeny-Young exact method.
 * Verifies optimal permutation selection, symmetric tie fusion, and n≤8 guard.
 */

import { describe, it, expect } from 'vitest';
import { kemenyYoung } from '../../lib/algorithms/kemenyYoung';
import type { Ballot } from '../../lib/algorithms/types';

const makeBallot = (pairs: [string, number][]): Ballot => new Map(pairs);

describe('kemenyYoung', () => {
  it('finds the unanimous consensus when all voters agree', () => {
    const projects = ['A', 'B', 'C'];
    const ballots: Ballot[] = [
      makeBallot([['A', 1], ['B', 2], ['C', 3]]),
      makeBallot([['A', 1], ['B', 2], ['C', 3]]),
      makeBallot([['A', 1], ['B', 2], ['C', 3]]),
    ];
    const result = kemenyYoung(ballots, projects);
    const rankOf = new Map(result.map(r => [r.id, r.midRank]));
    expect(rankOf.get('A')).toBe(1);
    expect(rankOf.get('B')).toBe(2);
    expect(rankOf.get('C')).toBe(3);
  });

  it('produces symmetric mid-rank fusion for symmetric disagreement', () => {
    // 2 voters with exactly opposite rankings → multiple optimal permutations
    const projects = ['A', 'B'];
    const ballots: Ballot[] = [
      makeBallot([['A', 1], ['B', 2]]),
      makeBallot([['B', 1], ['A', 2]]),
    ];
    // Both permutations [A,B] and [B,A] have same Kemeny cost of 1
    // Symmetric fusion: A and B get mid-rank 1.5
    const result = kemenyYoung(ballots, projects);
    const rankOf = new Map(result.map(r => [r.id, r.midRank]));
    expect(rankOf.get('A')).toBe(1.5);
    expect(rankOf.get('B')).toBe(1.5);
  });

  it('selects majority preference in 3-voter case', () => {
    const projects = ['A', 'B', 'C'];
    const ballots: Ballot[] = [
      makeBallot([['A', 1], ['B', 2], ['C', 3]]),
      makeBallot([['A', 1], ['B', 2], ['C', 3]]),
      makeBallot([['C', 1], ['B', 2], ['A', 3]]),
    ];
    // 2/3 prefer A first, 2/3 prefer B second → optimal: A>B>C
    const result = kemenyYoung(ballots, projects);
    const rankOf = new Map(result.map(r => [r.id, r.midRank]));
    expect(rankOf.get('A')).toBe(1);
    expect(rankOf.get('B')).toBe(2);
    expect(rankOf.get('C')).toBe(3);
  });

  it('handles the 4-alternative Condorcet cycle gracefully', () => {
    // 4 voters, 4-way cyclic preferences → multiple optimal permutations → mid-rank fusion
    const projects = ['A', 'B', 'C', 'D'];
    const ballots: Ballot[] = [
      makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]]),
      makeBallot([['B', 1], ['C', 2], ['D', 3], ['A', 4]]),
      makeBallot([['C', 1], ['D', 2], ['A', 3], ['B', 4]]),
      makeBallot([['D', 1], ['A', 2], ['B', 3], ['C', 4]]),
    ];
    const result = kemenyYoung(ballots, projects);
    expect(result.map(r => ({ id: r.id, midRank: r.midRank }))).toEqual([
      { id: 'A', midRank: 2.5 },
      { id: 'B', midRank: 2.5 },
      { id: 'C', midRank: 2.5 },
      { id: 'D', midRank: 2.5 },
    ]);
  });

  it('throws error for n > 8', () => {
    const projects = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']; // n=9
    expect(() => kemenyYoung([], projects)).toThrow(/n ≤ 8/);
  });

  it('returns a valid 3-item ranking for empty ballots (no tie forced by spec)', () => {
    // With no ballots, all permutations have cost=0 and are equally optimal.
    // Symmetric mid-rank fusion over all 3! = 6 permutations yields mid-rank = 2 for all.
    const result = kemenyYoung([], ['A', 'B', 'C']);
    expect(result).toEqual([
      { id: 'A', score: 0, midRank: 2 },
      { id: 'B', score: 0, midRank: 2 },
      { id: 'C', score: 0, midRank: 2 },
    ]);
  });

  it('handles n=8 (maximum complexity) without hanging', () => {
    const projects = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const ballots: Ballot[] = [
      makeBallot([['A',1],['B',2],['C',3],['D',4],['E',5],['F',6],['G',7],['H',8]]),
      makeBallot([['H',1],['G',2],['F',3],['E',4],['D',5],['C',6],['B',7],['A',8]]),
      makeBallot([['A',1],['B',2],['C',3],['D',4],['E',5],['F',6],['G',7],['H',8]]),
    ];
    const start = Date.now();
    const result = kemenyYoung(ballots, projects);
    const elapsed = Date.now() - start;
    expect(result.map(r => ({ id: r.id, midRank: r.midRank }))).toEqual([
      { id: 'A', midRank: 1 },
      { id: 'B', midRank: 2 },
      { id: 'C', midRank: 3 },
      { id: 'D', midRank: 4 },
      { id: 'E', midRank: 5 },
      { id: 'F', midRank: 6 },
      { id: 'G', midRank: 7 },
      { id: 'H', midRank: 8 },
    ]);
    expect(elapsed).toBeLessThan(2000); // Must complete in < 2 seconds
  }, 5000);
});
