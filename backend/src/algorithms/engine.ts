/**
 * engine.ts
 * r-FAST-CR Aggregation Engine — Strategy Pattern entry point.
 *
 * Orchestrates:
 *  1. Algorithm selection (Borda / Schulze / Kemeny-Young)
 *  2. Quorum guard (effectiveVoters < minMembers → INSUFFICIENT_VOTES)
 *  3. Collective ranking computation
 *  4. Kendall Tau-c CIX computation for all voters
 *  5. Group consensus τ* and stop criterion evaluation
 *
 * Reference: Specification §4 — Pipeline de Cómputo
 */

import type { Ballot, RoundResult, WeakOrder } from './types';
import { bordaCount } from './borda';
import { schulzeMethod } from './schulze';
import { kemenyYoung } from './kemenyYoung';
import { computeGroupConsensus, computeGroupConsensusForVariant, type ConcordanceVariant } from './kendallTau';
import { applyTieBreak, type TieBreakInput } from './tieBreak';

export type AggregationMethod = 'BORDA' | 'SCHULZE' | 'KEMENY_YOUNG';

export interface EngineInput {
  /** All option IDs in the room (n ∈ [3, 8]) */
  optionIds?: string[];
  projectIds?: string[];
  /** Ballots indexed by participantId. Only voters who cast in THIS round. */
  ballots: Map<string, Ballot>;
  /** Aggregation method configured for the room */
  method: AggregationMethod;
  /** Minimum members for quorum */
  minMembers: number;
  /** Consensus threshold τ */
  tauThreshold: number;
  /** Current round number */
  currentRound: number;
  /** Maximum rounds */
  maxRounds: number;
  /**
   * Declared tie-break rule (PT-16). Omitted or rule NONE: the weak order with
   * mid-ranks is kept exactly as before.
   */
  tieBreak?: TieBreakInput;
  /**
   * Concordance variant (PT-17). WITHOUT_TIES requires a tie-break rule other
   * than NONE. Omitted: tau-b as before.
   */
  concordanceVariant?: ConcordanceVariant;
}

export interface EngineOutput {
  result: RoundResult | null;
  quorumMet: boolean;
  /** If true, session should transition to CONCLUDED */
  shouldConclude: boolean;
  /** If true, session should advance to next round (ROUND_FEEDBACK) */
  shouldAdvance: boolean;
}

/**
 * Runs the full r-FAST-CR computation pipeline for a single round.
 */
export function runAggregationEngine(input: EngineInput): EngineOutput {
  const { ballots, method, minMembers, tauThreshold, currentRound, maxRounds } = input;

  if (input.concordanceVariant === 'WITHOUT_TIES' && (!input.tieBreak || input.tieBreak.rule === 'NONE')) {
    throw new Error('WITHOUT_TIES concordance requires a tie-break rule other than NONE.');
  }
  const optionIds = (input.optionIds || input.projectIds || []);

  const effectiveVoters = ballots.size;

  // Quorum guard: effectiveVoters < minMembers → INSUFFICIENT_VOTES
  if (effectiveVoters < minMembers) {
    return {
      result: null,
      quorumMet: false,
      shouldConclude: false,
      shouldAdvance: false,
    };
  }

  // Select aggregation strategy
  const ballotsArray = Array.from(ballots.values());
  let ranking: WeakOrder[];

  switch (method) {
    case 'BORDA':
      ranking = bordaCount(ballotsArray, optionIds);
      break;
    case 'SCHULZE':
      ranking = schulzeMethod(ballotsArray, optionIds);
      break;
    case 'KEMENY_YOUNG':
      ranking = kemenyYoung(ballotsArray, optionIds);
      break;
    default:
      throw new Error(`Unknown aggregation method: ${method}`);
  }

  // Declared tie-break (PT-16). Skipped entirely for NONE so the output is unchanged.
  let tieBreakReport: RoundResult['tieBreak'];
  if (input.tieBreak) {
    if (input.tieBreak.rule !== 'NONE') {
      const broken = applyTieBreak(ranking, input.tieBreak);
      ranking = broken.ranking;
      tieBreakReport = broken.report;
    } else {
      tieBreakReport = applyTieBreak(ranking, input.tieBreak).report;
    }
  }

  // Compute CIX and group consensus τ* (primary Kendall tau-b and sensitivity metrics)
  const { voterCIX, tauStar, stuartTauStar, gammaTauStar } = input.concordanceVariant
    ? computeGroupConsensusForVariant(ballots, ranking, input.concordanceVariant)
    : computeGroupConsensus(ballots, ranking);

  const result: RoundResult = {
    method,
    ranking,
    effectiveVoters,
    mEfectivo: effectiveVoters,
    voterCIX,
    tauStar,
    stuartTauStar,
    gammaTauStar,
    quorumMet: true,
  };
  if (tieBreakReport) result.tieBreak = tieBreakReport;
  if (input.concordanceVariant) result.concordanceVariant = input.concordanceVariant;

  // Stop criterion: τ* ≥ τ_threshold OR currentRound === maxRounds
  const shouldConclude = tauStar >= tauThreshold || currentRound >= maxRounds;
  const shouldAdvance = !shouldConclude;

  return {
    result,
    quorumMet: true,
    shouldConclude,
    shouldAdvance,
  };
}
