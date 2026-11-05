/**
 * __tests__/algorithms/borda.test.ts
 * Unit tests for Borda Count aggregation.
 * Verifies positional scoring, tie handling, and weak order preservation.
 */

import { describe, it, expect } from 'vitest';
import { bordaCount } from '@mic/backend/algorithms/borda';
import type { Ballot } from '@mic/backend/algorithms/types';

// Helpers
const makeBallot = (pairs: [string, number][]): Ballot => new Map(pairs);

describe('bordaCount', () => {
  const projects = ['A', 'B', 'C', 'D'];

  it('correctly computes Borda scores for 3 voters, 4 alternatives', () => {
    // n=4, positions 1..4, score = n - position
    const ballots: Ballot[] = [
      makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]]), // A:3, B:2, C:1, D:0
      makeBallot([['B', 1], ['A', 2], ['C', 3], ['D', 4]]), // A:2, B:3, C:1, D:0
      makeBallot([['A', 1], ['C', 2], ['B', 3], ['D', 4]]), // A:3, B:1, C:2, D:0
    ];
    // A: 3+2+3=8, B: 2+3+1=6, C: 1+1+2=4, D: 0+0+0=0
    const result = bordaCount(ballots, projects);
    expect(result).toEqual([
      { id: 'A', score: 8, midRank: 1 },
      { id: 'B', score: 6, midRank: 2 },
      { id: 'C', score: 4, midRank: 3 },
      { id: 'D', score: 0, midRank: 4 },
    ]);
  });

  it('produces mid-rank ties when two alternatives score equally', () => {
    // 2 voters, 4 alternatives: symmetric preference → B and C tie
    const ballots: Ballot[] = [
      makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]]), // B:2, C:1
      makeBallot([['A', 1], ['C', 2], ['B', 3], ['D', 4]]), // B:1, C:2
    ];
    // A: 3+3=6, B: 2+1=3, C: 1+2=3, D: 0+0=0
    const result = bordaCount(ballots, projects);
    expect(result).toEqual([
      { id: 'A', score: 6, midRank: 1 },
      { id: 'B', score: 3, midRank: 2.5 },
      { id: 'C', score: 3, midRank: 2.5 },
      { id: 'D', score: 0, midRank: 4 },
    ]);
  });

  it('produces a 4-way tie when all ballots are perfectly symmetric', () => {
    // 4 voters, each ranking the 4 alternatives in a different cyclic order
    // → All total Borda scores equal
    const ballots: Ballot[] = [
      makeBallot([['A', 1], ['B', 2], ['C', 3], ['D', 4]]),
      makeBallot([['B', 1], ['C', 2], ['D', 3], ['A', 4]]),
      makeBallot([['C', 1], ['D', 2], ['A', 3], ['B', 4]]),
      makeBallot([['D', 1], ['A', 2], ['B', 3], ['C', 4]]),
    ];
    // Each gets: 3+0+1+2=6 and 2+3+0+1=6 etc — all 6
    const result = bordaCount(ballots, projects);
    expect(result).toEqual([
      { id: 'A', score: 6, midRank: 2.5 },
      { id: 'B', score: 6, midRank: 2.5 },
      { id: 'C', score: 6, midRank: 2.5 },
      { id: 'D', score: 6, midRank: 2.5 },
    ]);
  });

  it('handles 3 alternatives correctly', () => {
    const threeProjects = ['X', 'Y', 'Z'];
    const ballots: Ballot[] = [
      makeBallot([['X', 1], ['Y', 2], ['Z', 3]]), // X:2, Y:1, Z:0
      makeBallot([['X', 1], ['Y', 2], ['Z', 3]]), // X:2, Y:1, Z:0
      makeBallot([['Y', 1], ['X', 2], ['Z', 3]]), // X:1, Y:2, Z:0
    ];
    // X: 2+2+1=5, Y: 1+1+2=4, Z: 0+0+0=0
    const result = bordaCount(ballots, threeProjects);
    expect(result).toEqual([
      { id: 'X', score: 5, midRank: 1 },
      { id: 'Y', score: 4, midRank: 2 },
      { id: 'Z', score: 0, midRank: 3 },
    ]);
  });

  it('returns all alternatives with mid-rank (n+1)/2 and score 0 for empty ballots (AUD-10)', () => {
    const result = bordaCount([], ['X', 'Y', 'Z']);
    expect(result).toEqual([
      { id: 'X', score: 0, midRank: 2 },
      { id: 'Y', score: 0, midRank: 2 },
      { id: 'Z', score: 0, midRank: 2 },
    ]);
  });
});
