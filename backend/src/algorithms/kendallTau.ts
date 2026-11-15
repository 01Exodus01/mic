/**
 * kendallTau.ts
 * Primary consensus metric (since r-fast-cr-5, AGENTS.md E-14): CIX based on
 * Stuart's Tau-c. Kendall's Tau-b (primary up to r-fast-cr-4) and Goodman &
 * Kruskal's Gamma are still computed for sensitivity analysis.
 *
 * Formulas (Decision D1 / AGENTS.md):
 *
 * 1. Kendall Tau-b (sensibilidad; métrica principal hasta r-fast-cr-4):
 *    tau_b = (C - D) / sqrt((T - t_boleta) * (T - t_grupo))
 *    con T = n(n-1)/2, t_boleta = 0 (boleta estricta 1..n),
 *    t_grupo = pares empatados en el orden colectivo del grupo.
 *    CIX = (tau_b + 1) / 2
 *    Convención de empate total (T = t_grupo): tau_b = 0, CIX = 0.50
 *
 * 2. Stuart Tau-c (Métrica principal desde r-fast-cr-5):
 *    tau_c = (2 * m * (C - D)) / (n² * (m - 1))
 *    con m = min(valores distintos boleta, valores distintos grupo) = min(n, k_grupo)
 *    CIX_stuart = (tau_c + 1) / 2
 *    Convención de empate total (m <= 1): tau_c = 0, CIX_stuart = 0.50
 *
 * 3. Gamma decided pairs (Análisis de sensibilidad):
 *    gamma = (C - D) / (C + D)
 *    CIX_gamma = (gamma + 1) / 2
 *    Convención de empate total (C + D = 0): gamma = 0, CIX_gamma = 0.50
 *
 * Índice de concordancia individual (cix): el de la métrica principal,
 *    CIX = (tau_c + 1) / 2 desde r-fast-cr-5; (tau_b + 1) / 2 en versiones anteriores.
 *
 * Nivel de acuerdo de la ronda (tau*):
 *    tau* = (1 / m_efectivo) * sum(CIX_j)
 */

import type { Ballot, VoterCIX, WeakOrder } from './types';

/** Coefficient the primary CIX (and tau*) is based on. */
export type ConcordanceIndex = 'TAU_B' | 'TAU_C';

/** Primary coefficient of the current procedure (AGENTS.md E-14). */
export const PRIMARY_CONCORDANCE_INDEX: ConcordanceIndex = 'TAU_C';

/**
 * Computes concordance metrics (Kendall tau-b, Stuart tau-c, Gamma)
 * for an individual voter's ballot relative to the collective weak order.
 * `cix` is based on `index` (tau-c by default; tau-b only to reproduce
 * reports computed before r-fast-cr-5).
 */
export function computeVoterCIX(
  ballot: Ballot,
  collectiveRanking: WeakOrder[],
  participantId: string,
  index: ConcordanceIndex = PRIMARY_CONCORDANCE_INDEX
): VoterCIX {
  const n = collectiveRanking.length;
  const T = (n * (n - 1)) / 2;

  if (T === 0) {
    return {
      participantId,
      cix: 0.5,
      concordant: 0,
      discordant: 0,
      tied: 0,
      tauB: 0,
      stuartTauC: 0,
      stuartCix: 0.5,
      gamma: 0,
      gammaCix: 0.5,
    };
  }

  // Build collective rank lookup and compute distinct rank count k
  const collectiveRankOf = new Map<string, number>(
    collectiveRanking.map((item) => [item.id, item.midRank])
  );
  const distinctRanks = new Set(collectiveRanking.map((item) => item.midRank));
  const k = distinctRanks.size;

  const ids = collectiveRanking.map((r) => r.id);
  let C = 0; // Concordant pairs
  let D = 0; // Discordant pairs
  let t_grupo = 0; // Tied pairs in group

  for (let i = 0; i < ids.length - 1; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];

      const collectiveA = collectiveRankOf.get(a);
      const collectiveB = collectiveRankOf.get(b);
      const ballotA = ballot.get(a);
      const ballotB = ballot.get(b);

      if (
        collectiveA === undefined ||
        collectiveB === undefined ||
        ballotA === undefined ||
        ballotB === undefined
      ) {
        continue;
      }

      if (collectiveA === collectiveB) {
        t_grupo++;
        continue;
      }

      const collectivePrefersA = collectiveA < collectiveB; // lower midRank = higher preference
      const voterPrefersA = ballotA < ballotB;

      if (collectivePrefersA === voterPrefersA) {
        C++;
      } else {
        D++;
      }
    }
  }

  // 1. Kendall tau-b (sensitivity; primary up to r-fast-cr-4)
  let tauB = 0;
  let tauBCix = 0.5;

  if (T === t_grupo) {
    // Total tie in group ranking
    tauB = 0;
    tauBCix = 0.5;
  } else {
    const denom = Math.sqrt(T * (T - t_grupo));
    tauB = denom > 0 ? (C - D) / denom : 0;
    tauBCix = (tauB + 1) / 2;
  }

  // 2. Primary metric: Stuart tau-c
  const m = Math.min(n, k);
  let stuartTauC = 0;
  let stuartCix = 0.5;

  if (m <= 1) {
    stuartTauC = 0;
    stuartCix = 0.5;
  } else {
    stuartTauC = (2 * m * (C - D)) / (n * n * (m - 1));
    stuartCix = (stuartTauC + 1) / 2;
  }

  // 3. Sensitivity metric: Goodman & Kruskal's Gamma (decided pairs)
  let gammaVal = 0;
  let gammaCix = 0.5;

  if (C + D === 0) {
    gammaVal = 0;
    gammaCix = 0.5;
  } else {
    gammaVal = (C - D) / (C + D);
    gammaCix = (gammaVal + 1) / 2;
  }

  return {
    participantId,
    cix: index === 'TAU_C' ? stuartCix : tauBCix,
    concordant: C,
    discordant: D,
    tied: t_grupo,
    tauB,
    stuartTauC,
    stuartCix,
    gamma: gammaVal,
    gammaCix,
  };
}

export type ConcordanceVariant = 'WITH_TIES' | 'WITHOUT_TIES';

/** True when every option has a distinct integer rank 1..n (no ties). */
export function isStrictRanking(collectiveRanking: WeakOrder[]): boolean {
  const ranks = collectiveRanking.map((r) => r.midRank).sort((a, b) => a - b);
  return ranks.every((r, i) => r === i + 1);
}

/**
 * Group consensus for a declared concordance variant (PT-17, AGENTS.md E-2).
 * WITH_TIES: computeGroupConsensus on the order with ties.
 * WITHOUT_TIES: only defined on a strict collective order, which is checked
 * here; then computeGroupConsensus is reused as is. The coefficient (tau-c or
 * tau-b) is chosen by `index`, independently of the variant.
 */
export function computeGroupConsensusForVariant(
  ballots: Map<string, Ballot>,
  collectiveRanking: WeakOrder[],
  variant: ConcordanceVariant,
  index: ConcordanceIndex = PRIMARY_CONCORDANCE_INDEX
): ReturnType<typeof computeGroupConsensus> {
  if (variant === 'WITHOUT_TIES' && !isStrictRanking(collectiveRanking)) {
    throw new Error('WITHOUT_TIES concordance requires a strict collective ranking (declare a tie-break rule).');
  }
  return computeGroupConsensus(ballots, collectiveRanking, index);
}

/**
 * Computes group consensus for all voters in a round.
 * tau* is the average of the primary CIX (Stuart tau-c since r-fast-cr-5).
 * stuartTauStar and gammaTauStar average the tau-c and Gamma CIX.
 */
export function computeGroupConsensus(
  ballots: Map<string, Ballot>,
  collectiveRanking: WeakOrder[],
  index: ConcordanceIndex = PRIMARY_CONCORDANCE_INDEX
): {
  voterCIX: VoterCIX[];
  tauStar: number;
  stuartTauStar: number;
  gammaTauStar: number;
} {
  const voterCIX: VoterCIX[] = [];

  for (const [participantId, ballot] of ballots.entries()) {
    const res = computeVoterCIX(ballot, collectiveRanking, participantId, index);
    voterCIX.push(res);
  }

  const mEfectivo = voterCIX.length;
  if (mEfectivo === 0) {
    return {
      voterCIX: [],
      tauStar: 0.5,
      stuartTauStar: 0.5,
      gammaTauStar: 0.5,
    };
  }

  const tauStar = voterCIX.reduce((sum, v) => sum + v.cix, 0) / mEfectivo;
  const stuartTauStar = voterCIX.reduce((sum, v) => sum + (v.stuartCix ?? 0.5), 0) / mEfectivo;
  const gammaTauStar = voterCIX.reduce((sum, v) => sum + (v.gammaCix ?? 0.5), 0) / mEfectivo;

  return {
    voterCIX,
    tauStar,
    stuartTauStar,
    gammaTauStar,
  };
}
