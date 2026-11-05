/**
 * lib/state-machine.ts
 * r-FAST-CR Room State Machine transitions.
 *
 * Valid state transitions:
 *   DRAFT              → ROUND_OPEN          (host starts activity)
 *   DRAFT              → CANCELLED           (host cancels)
 *   ROUND_OPEN         → PROCESSING          (deadline expired, effective_voters ≥ min)
 *   ROUND_OPEN         → INSUFFICIENT_VOTES  (deadline expired, effective_voters < min)
 *   ROUND_OPEN         → CANCELLED           (host cancels)
 *   INSUFFICIENT_VOTES → ROUND_OPEN          (host extends deadline)
 *   INSUFFICIENT_VOTES → CANCELLED           (host cancels)
 *   PROCESSING         → CONCLUDED           (τ* ≥ τ OR r = η)
 *   PROCESSING         → ROUND_FEEDBACK      (τ* < τ AND r < η)
 *   ROUND_FEEDBACK     → ROUND_OPEN          (host opens next round)
 *   ROUND_FEEDBACK     → CANCELLED           (host cancels)
 */

import { RoomStatus } from '@prisma/client';

export type EstadoSala = RoomStatus;

type Transition = {
  from: RoomStatus;
  to: RoomStatus;
  action: string;
};

const VALID_TRANSITIONS: Transition[] = [
  { from: 'DRAFT',              to: 'ROUND_OPEN',         action: 'START' },
  { from: 'DRAFT',              to: 'CANCELLED',          action: 'CANCEL' },
  { from: 'ROUND_OPEN',         to: 'PROCESSING',         action: 'CLOSE_ROUND' },
  { from: 'ROUND_OPEN',         to: 'INSUFFICIENT_VOTES', action: 'QUORUM_FAILED' },
  { from: 'ROUND_OPEN',         to: 'CANCELLED',          action: 'CANCEL' },
  { from: 'INSUFFICIENT_VOTES', to: 'ROUND_OPEN',         action: 'EXTEND_DEADLINE' },
  { from: 'INSUFFICIENT_VOTES', to: 'CANCELLED',          action: 'CANCEL' },
  { from: 'PROCESSING',         to: 'CONCLUDED',          action: 'CONCLUDE' },
  { from: 'PROCESSING',         to: 'ROUND_FEEDBACK',     action: 'ADVANCE' },
  { from: 'ROUND_FEEDBACK',     to: 'ROUND_OPEN',         action: 'NEXT_ROUND' },
  { from: 'ROUND_FEEDBACK',     to: 'CANCELLED',          action: 'CANCEL' },
];

export const STATE_TRANSITIONS = VALID_TRANSITIONS;

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  DRAFT: 'Borrador',
  ROUND_OPEN: 'Ronda abierta',
  INSUFFICIENT_VOTES: 'Faltan selecciones',
  PROCESSING: 'Calculando resultados',
  ROUND_FEEDBACK: 'Revisión de argumentos',
  CONCLUDED: 'Finalizada',
  CANCELLED: 'Cancelada',
};

/**
 * Validates whether a state transition is allowed.
 */
export function isValidTransition(from: RoomStatus, to: RoomStatus): boolean {
  return VALID_TRANSITIONS.some(t => t.from === from && t.to === to);
}

/**
 * Returns all valid target states from a given state.
 */
export function getValidTransitions(from: RoomStatus): RoomStatus[] {
  return VALID_TRANSITIONS.filter(t => t.from === from).map(t => t.to);
}

/**
 * Returns true if the room is in a terminal state (no more transitions allowed).
 */
export function isTerminalState(state: RoomStatus): boolean {
  return state === 'CONCLUDED' || state === 'CANCELLED';
}

/**
 * Returns true if voting is open in this state.
 */
export function isVotingOpen(state: RoomStatus): boolean {
  return state === 'ROUND_OPEN';
}
