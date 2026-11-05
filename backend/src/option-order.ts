/**
 * lib/option-order.ts
 * Order in which the options are first shown to a participant in a round
 * (plan de mejora P1.4). Randomized per participant and round, so list
 * position does not bias the ranking; deterministic, so reloading the page
 * shows the same order and the server can record it with the ballot.
 */

import { createHash } from 'crypto';

export function displayOrderFor(participantId: string, round: number, optionIds: string[]): string[] {
  const key = (id: string) => createHash('sha256').update(`${participantId}:${round}:${id}`).digest('hex');
  return [...optionIds].sort((a, b) => key(a).localeCompare(key(b)) || a.localeCompare(b));
}

/** option id → 1-based position in which it was shown */
export function displayedPositions(participantId: string, round: number, optionIds: string[]): Map<string, number> {
  return new Map(displayOrderFor(participantId, round, optionIds).map((id, i) => [id, i + 1]));
}
