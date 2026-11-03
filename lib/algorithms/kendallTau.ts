/**
 * kendallTau.ts
 * Primary consensus metric: Kendall Tau-b concordance index (CIX).
 * Also computes Stuart's Tau-c and Goodman & Kruskal's Gamma for sensitivity analysis.
 *
 * Formulas (Decision D1 / AGENTS.md):
 *
 * 1. Kendall Tau-b (Métrica principal):
 *    tau_b = (C - D) / sqrt((T - t_boleta) * (T - t_grupo))
 *    con T = n(n-1)/2, t_boleta = 0 (boleta estricta 1..n),
 *    t_grupo = pares empatados en el orden colectivo del grupo.
 *    CIX = (tau_b + 1) / 2
 *    Convención de empate total (T = t_grupo): tau_b = 0, CIX = 0.50
 *
 * 2. Stuart Tau-c (Análisis de sensibilidad):
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
 * Nivel de acuerdo de la ronda (tau*):
 *    tau* = (1 / m_efectivo) * sum(CIX_j)
 */

import type { Ballot, VoterCIX, WeakOrder } from './types';

/**
 * Computes concordance metrics (Kendall tau-b, Stuart tau-c, Gamma)
 * for an individual voter's ballot relative to the collective weak order.
 */
export function computeVoterCIX(
  ballot: Ballot,
  collectiveRanking: WeakOrder[],
  participantId: string
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

  // 1. Primary metric: Kendall tau-b
  let tauB = 0;
  let cix = 0.5;

  if (T === t_grupo) {
    // Total tie in group ranking
    tauB = 0;
    cix = 0.5;
  } else {
    const denom = Math.sqrt(T * (T - t_grupo));
    tauB = denom > 0 ? (C - D) / denom : 0;
    cix = (tauB + 1) / 2;
  }

  // 2. Sensitivity metric: Stuart tau-c
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
    cix,
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

/**
 * Computes group consensus for all voters in a round.
 * Primary consensus metric is the average of Kendall tau-b CIX.
 * Sensitivity metrics (Stuart tau-c and Gamma) are also computed.
 */
export function computeGroupConsensus(
  ballots: Map<string, Ballot>,
  collectiveRanking: WeakOrder[]
): {
  voterCIX: VoterCIX[];
  tauStar: number;
  stuartTauStar: number;
  gammaTauStar: number;
} {
  const voterCIX: VoterCIX[] = [];

  for (const [participantId, ballot] of ballots.entries()) {
    const res = computeVoterCIX(ballot, collectiveRanking, participantId);
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
