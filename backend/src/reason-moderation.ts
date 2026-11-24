/**
 * backend/src/reason-moderation.ts
 * Reasons hidden by the host (team request 2026-11-24). The reason stays in the
 * votes and in the immutable round report; it is left out wherever
 * participants see reasons, and only its author is told which one and why.
 * The selection itself always counts, and no calculation changes: reasons do
 * not enter the ranking, the concordance or the tie-break of current groups.
 */

import prisma from '@mic/backend/db';

export type ReasonSideValue = 'FOR' | 'AGAINST';

/** Identity of a reason for moderation: who, in which round, on which option, which side, which text. */
export function moderationKey(participantId: string, optionId: string, side: ReasonSideValue, text: string): string {
  return [participantId, optionId, side, text].join('\u0000');
}

/** Keys of the hidden reasons of a round. */
export async function moderatedKeys(roomId: string, round: number): Promise<Set<string>> {
  const rows = await prisma.reasonModeration.findMany({
    where: { room_id: roomId, round },
    select: { participant_id: true, option_id: true, side: true, text: true },
  });
  return new Set(rows.map((r) => moderationKey(r.participant_id, r.option_id, r.side, r.text)));
}
