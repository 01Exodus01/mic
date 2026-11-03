/**
 * types.ts
 * Shared domain types for the r-FAST-CR mathematical engine.
 */

/** Individual ballot: maps optionId -> strict rank position (1..n, no ties allowed from voter) */
export type Ballot = Map<string, number>;

/** Intermediate ranked result with mid-rank support for ties */
export interface RankedItem {
  id: string;
  score: number;     // Raw aggregate score (Borda sum, Schulze beatpath strength, Kemeny penalty)
  rank: number;      // Mid-rank (fractional if tied, e.g. 1.5)
}

/** Collective Weak Order: final output preserving ties as equal mid-ranks */
export interface WeakOrder {
  id: string;
  midRank: number;   // Fractional rank, equal for ties
  score: number;     // Raw score for auditability
}

/** Per-voter CIX (Kendall Tau-b normalized concordance index, with sensitivity metrics) */
export interface VoterCIX {
  participantId: string;
  cix: number;   // Primary CIX (based on Kendall Tau-b) ∈ [0, 1]
  concordant: number;
  discordant: number;
  tied?: number; // Pairs tied in collective ranking
  tauB?: number; // Kendall Tau-b ∈ [-1, 1]
  stuartTauC?: number; // Stuart Tau-c ∈ [-1, 1]
  stuartCix?: number;  // CIX based on Stuart Tau-c ∈ [0, 1]
  gamma?: number;      // Goodman & Kruskal's Gamma ∈ [-1, 1]
  gammaCix?: number;   // CIX based on Gamma ∈ [0, 1]
}

/** Full round computation result */
export interface RoundResult {
  method: 'BORDA' | 'SCHULZE' | 'KEMENY_YOUNG';
  ranking: WeakOrder[];         // Collective weak order with mid-ranks
  effectiveVoters: number;      // Number of voters who actually cast ballots
  mEfectivo: number;            // Alias for effectiveVoters
  voterCIX: VoterCIX[];         // Individual concordance metrics for each voter
  tauStar: number;              // Group consensus τ* ∈ [0, 1] (average of Kendall tau-b CIX)
  stuartTauStar?: number;       // Sensitivity: Group consensus based on Stuart tau-c
  gammaTauStar?: number;        // Sensitivity: Group consensus based on Gamma
  quorumMet: boolean;           // effectiveVoters >= minMembers
}
