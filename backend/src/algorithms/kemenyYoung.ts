/**
 * kemenyYoung.ts
 * Kemeny-Young exact method (brute-force over permutations).
 *
 * For n ≤ 8 (max 8! = 40,320 permutations), finds the permutation σ*
 * that minimizes total Kendall-tau distance to all voter ballots:
 *
 *   σ* = argmin_{σ ∈ S_n} Σ_j d_K(σ, R_j)
 *
 * where d_K(σ, R_j) counts the number of pairwise inversions
 * (pairs (x, y) where σ and R_j disagree on their relative order).
 *
 * Tie handling (Weak Order / Symmetric Merge):
 * If multiple permutations achieve the same minimum cost, their
 * ranks are averaged (mid-rank fusion) — no arbitrary tiebreaking.
 *
 * Reference: Specification §2.3 — Método de Kemeny-Young (Exacto)
 */

import type { Ballot, WeakOrder } from './types';

/**
 * Generates all permutations of an array using Heap's algorithm.
 * Memory-efficient via generator (no allocating all 40,320 arrays at once).
 */
function* permutations<T>(arr: T[]): Generator<T[], void, unknown> {
  const a = [...arr];
  const n = a.length;
  const c = new Array(n).fill(0);

  yield [...a];

  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      if (i % 2 === 0) {
        const temp = a[0];
        a[0] = a[i];
        a[i] = temp;
      } else {
        const temp = a[c[i]];
        a[c[i]] = a[i];
        a[i] = temp;
      }
      yield [...a];
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

/**
 * Computes the Kendall-tau inversion distance between a candidate
 * permutation sigma (array of ids in rank order) and a voter ballot.
 * A pair (a, b) is an inversion if sigma and ballot disagree on their relative order.
 *
 * @param sigma Candidate permutation: sigma[0] = rank-1 item
 * @param ballot Voter ballot: Map<optionId, position>
 * @returns Number of pairwise inversions
 */
function kendallDistance(sigma: string[], ballot: Map<string, number>): number {
  let inversions = 0;
  const n = sigma.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const posA_ballot = ballot.get(sigma[i]);
      const posB_ballot = ballot.get(sigma[j]);
      // In sigma: sigma[i] is ranked above sigma[j] (i < j)
      // If in the ballot sigma[j] is ranked above sigma[i], that's an inversion
      if (posA_ballot !== undefined && posB_ballot !== undefined) {
        if (posB_ballot < posA_ballot) {
          inversions++;
        }
      }
    }
  }
  return inversions;
}

/**
 * Computes the Kemeny-Young collective ranking with exact brute-force.
 * When multiple optimal permutations exist, applies symmetric rank fusion
 * (averages the ranks of tied items across all optimal permutations).
 *
 * @param ballots Array of individual Ballot maps (optionId -> position 1..n)
 * @param optionIds All option IDs in the room (n ≤ 8 enforced by spec)
 * @returns WeakOrder array with fractional mid-ranks (Weak Order preserved)
 */
export function kemenyYoung(
  ballots: Ballot[],
  optionIds: string[]
): WeakOrder[] {
  const n = optionIds.length;
  if (n === 0) return [];
  if (n > 8) {
    throw new Error(`Kemeny-Young exact method is only defined for n ≤ 8 (got n=${n})`);
  }
  if (ballots.length === 0) {
    // No ballots → all permutations have equal cost (0). Apply full symmetric fusion.
    // For n items all equally optimal, every item appears in each rank 1..n exactly (n-1)! times.
    // Average rank for each item = (1 + 2 + ... + n) / n = (n+1)/2
    const avgRank = (n + 1) / 2;
    return optionIds.map(id => ({ id, midRank: avgRank, score: 0 }));
  }

  let minCost = Infinity;
  const optimalPermutations: string[][] = [];

  // Evaluate all n! permutations
  for (const perm of permutations(optionIds)) {
    let totalCost = 0;
    for (const ballot of ballots) {
      totalCost += kendallDistance(perm, ballot);
    }
    if (totalCost < minCost) {
      minCost = totalCost;
      optimalPermutations.length = 0;
      optimalPermutations.push([...perm]);
    } else if (totalCost === minCost) {
      optimalPermutations.push([...perm]);
    }
  }

  // Symmetric mid-rank fusion across all optimal permutations
  // For each item, compute average rank across all optimal permutations
  const rankSums = new Map<string, number>(optionIds.map(id => [id, 0]));

  for (const perm of optimalPermutations) {
    perm.forEach((id, index) => {
      rankSums.set(id, rankSums.get(id)! + (index + 1)); // 1-based rank
    });
  }

  const K = optimalPermutations.length;
  const items = optionIds.map(id => {
    const avgRank = rankSums.get(id)! / K;
    // Score is negated avgRank so that assignMidRanks (descending sort) works correctly
    // (lower avg rank = better = higher score)
    return { id, score: -avgRank };
  });

  // Assign mid-ranks from the fused average ranks
  // Items with the same avgRank will get the same mid-rank
  const sortedAsc = optionIds
    .map(id => ({ id, avgRank: rankSums.get(id)! / K }))
    .sort((a, b) => a.avgRank - b.avgRank);

  const result: WeakOrder[] = [];
  let i = 0;
  while (i < sortedAsc.length) {
    let j = i;
    while (j < sortedAsc.length && sortedAsc[j].avgRank === sortedAsc[i].avgRank) {
      j++;
    }
    const midRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      result.push({
        id: sortedAsc[k].id,
        midRank,
        score: -sortedAsc[k].avgRank, // store negated avg rank as "score" for auditability
      });
    }
    i = j;
  }

  return result;
}
