/**
 * schulze.ts
 * Schulze Method (Beatpath / Condorcet-consistent) using Floyd-Warshall.
 *
 * Algorithm:
 * 1. Build pairwise preference matrix d[x][y] = number of voters who prefer x over y.
 * 2. Compute strongest beatpath matrix p via Floyd-Warshall:
 *    p[x][y] = max_k≠x,y { min(p[x][k], p[k][y]) }
 * 3. Derive collective order: x defeats y iff p[x][y] > p[y][x].
 * 4. Score each candidate by counting how many others it defeats (Copeland-like).
 * 5. Apply mid-ranks for equal scores (Weak Orders — no arbitrary tiebreaking).
 *
 * Reference: Specification §2.2 — Método de Schulze
 */

import type { Ballot, WeakOrder } from './types';
import { assignMidRanks } from './midRanks';

/**
 * Computes the Schulze collective ranking.
 *
 * @param ballots Array of individual Ballot maps (optionId -> position 1..n)
 * @param optionIds Ordered list of all option IDs
 * @returns WeakOrder array with mid-ranks (ties preserved as Weak Orders)
 */
export function schulzeMethod(
  ballots: Ballot[],
  optionIds: string[]
): WeakOrder[] {
  const n = optionIds.length;
  if (n === 0) return [];
  // AUD-10: Con 0 boletas todas las opciones están empatadas con rango medio (n+1)/2 y score 0
  if (ballots.length === 0) return optionIds.map((id) => ({ id, midRank: (n + 1) / 2, score: 0 }));

  // Step 1: Build pairwise preference matrix d[i][j]
  // d[i][j] = number of voters who rank i above j (lower position number = better)
  const d: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (const ballot of ballots) {
    for (let i = 0; i < n; i++) {
      const xi = optionIds[i];
      const posI = ballot.get(xi);
      if (posI === undefined) continue;

      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const xj = optionIds[j];
        const posJ = ballot.get(xj);
        if (posJ === undefined) continue;
        // Voter prefers xi over xj if posI < posJ (rank 1 = best)
        if (posI < posJ) {
          d[i][j]++;
        }
      }
    }
  }

  // Step 2: Floyd-Warshall to find strongest beatpaths
  // p[i][j] = strength of the strongest beatpath from i to j
  // Initialize: p[i][j] = d[i][j] if d[i][j] > d[j][i], else 0
  const p: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        p[i][j] = d[i][j] > d[j][i] ? d[i][j] : 0;
      }
    }
  }

  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      for (let j = 0; j < n; j++) {
        if (j === i || j === k) continue;
        const candidate = Math.min(p[i][k], p[k][j]);
        if (candidate > p[i][j]) {
          p[i][j] = candidate;
        }
      }
    }
  }

  // Step 3 & 4: Score = number of options that x strictly defeats
  // x strictly defeats y iff p[x][y] > p[y][x]
  const items = optionIds.map((id, i) => {
    let score = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i && p[i][j] > p[j][i]) {
        score++;
      }
    }
    return { id, score };
  });

  // Step 5: Apply mid-ranks for equal scores
  return assignMidRanks(items);
}
