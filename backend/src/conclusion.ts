/**
 * backend/src/conclusion.ts
 * Why a finished process ended, stated once for every screen: the group
 * reached the required agreement, or the maximum number of rounds was used up.
 * Same criterion as the engine (engine.ts: τ* ≥ threshold or last round) and
 * as stop_reason in round_metrics.csv.
 */

export type ConclusionReason = 'CONSENSUS' | 'MAX_ROUNDS';

export function conclusionReason(
  status: string,
  tauThreshold: number,
  latestReport: { obtained_tau: number } | null | undefined
): ConclusionReason | null {
  if (status !== 'CONCLUDED' || !latestReport) return null;
  return latestReport.obtained_tau >= tauThreshold ? 'CONSENSUS' : 'MAX_ROUNDS';
}
