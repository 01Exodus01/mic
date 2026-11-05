/**
 * lib/telemetry/record.ts
 * Server side of the participant telemetry (plan de mejora P2): validates a batch
 * and writes it to RoomEvent with the participant's current round.
 */

import type { PrismaClient } from '@prisma/client';
import { recordRoomEvent, type RoomEventData } from '@mic/backend/room-events';
import { checkRateLimit } from '@mic/backend/rate-limit';
import { ClientEventBatchSchema, MAX_EVENT_AGE_MS } from '../shared/telemetry-events';

export type TelemetryOutcome = 'ok' | 'invalid' | 'unauthorized' | 'rate_limited';

export interface TelemetrySession {
  participantId: string;
  roomId: string;
  sessionVersion?: number;
}

/** Per participant: generous for a few minutes of active use, small enough to cap abuse. */
export const TELEMETRY_RATE_LIMIT = { max: 120, windowSec: 60 };

export async function recordClientEvents(
  prisma: PrismaClient,
  session: TelemetrySession | null,
  body: unknown
): Promise<TelemetryOutcome> {
  if (!session) return 'unauthorized';
  const parsed = ClientEventBatchSchema.safeParse(body);
  if (!parsed.success) return 'invalid';

  const participant = await prisma.participant.findFirst({
    where: { id: session.participantId, room_id: session.roomId },
    select: { id: true, is_retired: true, session_version: true, room: { select: { current_round: true } } },
  });
  if (!participant || participant.is_retired) return 'unauthorized';
  if (participant.session_version !== (session.sessionVersion ?? 0)) return 'unauthorized';

  const rl = checkRateLimit(`telemetry:${participant.id}`, TELEMETRY_RATE_LIMIT.max, TELEMETRY_RATE_LIMIT.windowSec);
  if (!rl.allowed) return 'rate_limited';

  const now = Date.now();
  const { events, ages_ms: ages } = parsed.data;
  await prisma.$transaction(async (tx) => {
    for (const [i, { type, ...data }] of events.entries()) {
      // Batched events keep the moment they happened (P2.2: time since the round opened)
      const age = Math.min(ages?.[i] ?? 0, MAX_EVENT_AGE_MS);
      await recordRoomEvent(tx, {
        createdAt: new Date(now - age),
        roomId: session.roomId,
        type,
        actor: 'PARTICIPANT',
        round: participant.room.current_round,
        participantId: participant.id,
        data: data as RoomEventData,
      });
    }
  });
  return 'ok';
}
