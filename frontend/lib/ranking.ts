/**
 * lib/ranking.ts
 * Display helpers for a collective ranking (weak order with mid-ranks).
 */

/** True when two or more options share a place (mid-ranks repeat or are fractional). */
export function rankingHasTies(ranking: ReadonlyArray<{ midRank: number }>): boolean {
  const ranks = ranking.map((r) => r.midRank);
  return new Set(ranks).size < ranks.length || ranks.some((r) => !Number.isInteger(r));
}
