/**
 * borda.ts
 * Borda Count positional voting method.
 *
 * For n options, a voter placing option x in position p awards:
 *   B(x) += (n - p)
 *
 * Ties in the collective output are preserved as mid-ranks (Weak Orders).
 * No arbitrary tiebreaking is applied.
 *
 * Reference: Specification §2.1 — Método de Borda (Posicional)
 */

import type { Ballot, WeakOrder } from './types';
import { assignMidRanks } from './midRanks';

/**
 * Computes the Borda Count collective ranking.
 *
 * @param ballots Array of individual Ballot maps (optionId -> position 1..n)
 * @param optionIds Ordered list of all option IDs in the room
 * @returns WeakOrder array with mid-ranks (ties preserved)
 */
export function bordaCount(
  ballots: Ballot[],
  optionIds: string[]
): WeakOrder[] {
  const n = optionIds.length;
  if (n === 0) return [];
  // AUD-10: Con 0 boletas todas las opciones están empatadas con rango medio (n+1)/2 y score 0
  if (ballots.length === 0) return optionIds.map((id) => ({ id, midRank: (n + 1) / 2, score: 0 }));

  // Accumulate Borda scores: score(x) += (n - position_in_ballot)
  const scores = new Map<string, number>(optionIds.map(id => [id, 0]));

  for (const ballot of ballots) {
    for (const [optionId, position] of ballot.entries()) {
      if (scores.has(optionId)) {
        scores.set(optionId, scores.get(optionId)! + (n - position));
      }
    }
  }

  const items = optionIds.map(id => ({ id, score: scores.get(id) ?? 0 }));
  return assignMidRanks(items);
}
