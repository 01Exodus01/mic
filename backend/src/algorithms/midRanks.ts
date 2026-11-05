/**
 * midRanks.ts
 * Assigns fractional mid-ranks to items with equal scores.
 * Equivalent to scipy.stats.rankdata(..., method='average').
 *
 * Example: scores [10, 5, 5, 2] → ranks [1, 2.5, 2.5, 4]
 *
 * Axiom: Cero desempates arbitrarios — equal scores produce equal fractional ranks.
 */

import type { RankedItem, WeakOrder } from './types';

/**
 * Assigns mid-ranks to an array of {id, score} items.
 * Items are ranked in DESCENDING order of score (highest score = rank 1).
 *
 * @param items Array of {id, score} objects
 * @returns Array of WeakOrder with fractional midRanks
 */
export function assignMidRanks(items: { id: string; score: number }[]): WeakOrder[] {
  if (items.length === 0) return [];

  // Sort descending by score; for tied scores, sort deterministically by id for serialization (AUD-24)
  const sorted = [...items].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.id.localeCompare(b.id);
  });

  const result: WeakOrder[] = new Array(sorted.length);
  let i = 0;

  while (i < sorted.length) {
    let j = i;
    // Find all items with the same score
    while (j < sorted.length && sorted[j].score === sorted[i].score) {
      j++;
    }
    // Mid-rank for positions [i+1 ... j] (1-indexed) = (i+1 + j) / 2
    const midRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      result[k] = { id: sorted[k].id, midRank, score: sorted[k].score };
    }
    i = j;
  }

  return result;
}

/**
 * Converts a WeakOrder array (by id) into a lookup Map<id, midRank>
 */
export function weakOrderToMap(order: WeakOrder[]): Map<string, number> {
  return new Map(order.map(o => [o.id, o.midRank]));
}
