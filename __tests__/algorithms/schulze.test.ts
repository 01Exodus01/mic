/**
 * __tests__/algorithms/schulze.test.ts
 * Unit tests for Schulze Method (Beatpath / Floyd-Warshall).
 * Verifies pairwise matrix, beatpath propagation, ties, and Condorcet winner detection.
 */

import { describe, it, expect } from 'vitest';
import { schulzeMethod } from '../../lib/algorithms/schulze';
import type { Ballot } from '../../lib/algorithms/types';

const makeBallot = (pairs: [string, number][]): Ballot => new Map(pairs);

describe('schulzeMethod', () => {
  it('identifies a clear Condorcet winner', () => {
    const projects = ['A', 'B', 'C'];
    // All 3 voters rank A first: A beats B and C pairwise, B beats C
    const ballots: Ballot[] = [
      makeBallot([['A', 1], ['B', 2], ['C', 3]]),
      makeBallot([['A', 1], ['B', 2], ['C', 3]]),
      makeBallot([['A', 1], ['C', 2], ['B', 3]]),
    ];
    const result = schulzeMethod(ballots, projects);
    expect(result).toEqual([
      { id: 'A', score: 2, midRank: 1 },
      { id: 'B', score: 1, midRank: 2 },
      { id: 'C', score: 0, midRank: 3 },
    ]);
  });

  it('produces symmetric ties when preferences are perfectly cyclic (Condorcet paradox)', () => {
    // Classic Condorcet cycle: A>B>C>A (Cyclotomic preferences)
    const projects = ['A', 'B', 'C'];
    const ballots: Ballot[] = [
      makeBallot([['A', 1], ['B', 2], ['C', 3]]), // A>B>C
      makeBallot([['B', 1], ['C', 2], ['A', 3]]), // B>C>A
      makeBallot([['C', 1], ['A', 2], ['B', 3]]), // C>A>B
    ];
    // d[A][B]=2, d[B][A]=1; d[B][C]=2, d[C][B]=1; d[C][A]=2, d[A][C]=1
    // Beatpaths: p[A][B]=2, p[B][C]=2, p[C][A]=2
    // Since beatpaths are cyclic with equal strength, no candidate strictly defeats another (all score 0) -> 3-way tie at midRank 2
    const result = schulzeMethod(ballots, projects);
    expect(result).toEqual([
      { id: 'A', score: 0, midRank: 2 },
      { id: 'B', score: 0, midRank: 2 },
      { id: 'C', score: 0, midRank: 2 },
    ]);
  });

  it('handles 4 alternatives with a clear winner and losers', () => {
    const projects = ['W', 'X', 'Y', 'Z'];
    // W is strongly preferred by all voters
    const ballots: Ballot[] = [
      makeBallot([['W', 1], ['X', 2], ['Y', 3], ['Z', 4]]),
      makeBallot([['W', 1], ['Y', 2], ['X', 3], ['Z', 4]]),
      makeBallot([['W', 1], ['X', 2], ['Z', 3], ['Y', 4]]),
      makeBallot([['W', 1], ['Z', 2], ['X', 3], ['Y', 4]]),
    ];
    const result = schulzeMethod(ballots, projects);
    expect(result).toEqual([
      { id: 'W', score: 3, midRank: 1 },
      { id: 'X', score: 2, midRank: 2 },
      { id: 'Y', score: 0, midRank: 3.5 },
      { id: 'Z', score: 0, midRank: 3.5 },
    ]);
  });

  it('returns empty for empty projects list', () => {
    expect(schulzeMethod([], [])).toEqual([]);
  });

  it('returns all alternatives with mid-rank (n+1)/2 and score 0 for empty ballots (AUD-10)', () => {
    const projects = ['A', 'B', 'C'];
    const result = schulzeMethod([], projects);
    expect(result).toEqual([
      { id: 'A', score: 0, midRank: 2 },
      { id: 'B', score: 0, midRank: 2 },
      { id: 'C', score: 0, midRank: 2 },
    ]);
  });

  it('handles 5 alternatives', () => {
    const projects = ['A', 'B', 'C', 'D', 'E'];
    const ballots: Ballot[] = [
      makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5]]),
      makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5]]),
      makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5]]),
    ];
    const result = schulzeMethod(ballots, projects);
    expect(result).toEqual([
      { id: 'A', score: 4, midRank: 1 },
      { id: 'B', score: 3, midRank: 2 },
      { id: 'C', score: 2, midRank: 3 },
      { id: 'D', score: 1, midRank: 4 },
      { id: 'E', score: 0, midRank: 5 },
    ]);
  });
});
