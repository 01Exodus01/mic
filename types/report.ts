/**
 * types/report.ts
 * Strict TypeScript types for JSON payloads stored in Prisma RoundReport.
 */

export interface RankingEntry {
  id: string;
  midRank: number;
  score?: number;
  title?: string;
  titulo?: string;
}

export interface BlindArgumentEntry {
  blindCode: string;
  codigoCiego?: string;
  position: number;
  posicion?: number;
  justification: string;
  justificacion?: string;
}

export type BlindArgumentsMap = Record<string, BlindArgumentEntry[]>;

/** One reason in a round report (PT-15): verbatim text, signed with the blind code. */
export interface ReportReasonEntry {
  blindCode: string;
  /** Position this participant gave to the option */
  position: number;
  /** 0-based order of the reason within its side for this participant */
  order: number;
  text: string;
}

export interface ReportOptionReasons {
  reasonsFor: ReportReasonEntry[];
  reasonsAgainst: ReportReasonEntry[];
}

/** Stored under arguments_json.__reasons, keyed by option id. */
export type ReportReasonsMap = Record<string, ReportOptionReasons>;

export interface TypedRoundReport {
  id?: string;
  room_id?: string;
  round: number;
  ronda?: number;
  effective_voters: number;
  m_efectivo?: number;
  collective_ranking: RankingEntry[];
  ranking_colectivo?: RankingEntry[];
  obtained_tau: number;
  tau_obtenido?: number;
  arguments_json: BlindArgumentsMap;
  argumentos_json?: BlindArgumentsMap;
  created_at?: Date;
}
