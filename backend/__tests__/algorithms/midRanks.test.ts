/**
 * __tests__/algorithms/midRanks.test.ts
 * Unit tests for mid-rank assignment (Weak Order axiom verification)
 */

import { describe, it, expect } from 'vitest';
import { assignMidRanks } from '@mic/backend/algorithms/midRanks';

describe('assignMidRanks', () => {
  it('assigns rank 1 to a single item', () => {
    const result = assignMidRanks([{ id: 'A', score: 10 }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'A', midRank: 1, score: 10 });
  });

  it('assigns correct ranks to 4 distinct scores', () => {
    const result = assignMidRanks([
      { id: 'A', score: 10 },
      { id: 'B', score: 5 },
      { id: 'C', score: 8 },
      { id: 'D', score: 2 },
    ]);
    // Sorted descending: A(10), C(8), B(5), D(2)
    const rankOf = new Map(result.map(r => [r.id, r.midRank]));
    expect(rankOf.get('A')).toBe(1);
    expect(rankOf.get('C')).toBe(2);
    expect(rankOf.get('B')).toBe(3);
    expect(rankOf.get('D')).toBe(4);
  });

  it('assigns fractional mid-ranks to tied items (2-way tie at top)', () => {
    // Scores: A=10, B=10, C=5 → A and B tie for positions 1-2, mid-rank = 1.5
    const result = assignMidRanks([
      { id: 'A', score: 10 },
      { id: 'B', score: 10 },
      { id: 'C', score: 5 },
    ]);
    const rankOf = new Map(result.map(r => [r.id, r.midRank]));
    expect(rankOf.get('A')).toBe(1.5);
    expect(rankOf.get('B')).toBe(1.5);
    expect(rankOf.get('C')).toBe(3);
  });

  it('assigns fractional mid-ranks to 3-way tie', () => {
    // A=5, B=5, C=5 → all tie for positions 1-2-3, mid-rank = 2
    const result = assignMidRanks([
      { id: 'A', score: 5 },
      { id: 'B', score: 5 },
      { id: 'C', score: 5 },
    ]);
    const rankOf = new Map(result.map(r => [r.id, r.midRank]));
    expect(rankOf.get('A')).toBe(2);
    expect(rankOf.get('B')).toBe(2);
    expect(rankOf.get('C')).toBe(2);
  });

  it('handles tie in middle (2 items tied at positions 2-3)', () => {
    // A=10, B=5, C=5, D=1 → B and C tie at 2-3, mid-rank = 2.5
    const result = assignMidRanks([
      { id: 'A', score: 10 },
      { id: 'B', score: 5 },
      { id: 'C', score: 5 },
      { id: 'D', score: 1 },
    ]);
    const rankOf = new Map(result.map(r => [r.id, r.midRank]));
    expect(rankOf.get('A')).toBe(1);
    expect(rankOf.get('B')).toBe(2.5);
    expect(rankOf.get('C')).toBe(2.5);
    expect(rankOf.get('D')).toBe(4);
  });

  it('returns empty array for empty input', () => {
    expect(assignMidRanks([])).toEqual([]);
  });

  it('handles all items with zero score', () => {
    const result = assignMidRanks([
      { id: 'A', score: 0 },
      { id: 'B', score: 0 },
      { id: 'C', score: 0 },
    ]);
    const ranks = result.map(r => r.midRank);
    expect(ranks.every(r => r === 2)).toBe(true); // All tied at mid-rank 2
  });
});
