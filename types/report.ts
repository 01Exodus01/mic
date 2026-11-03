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
