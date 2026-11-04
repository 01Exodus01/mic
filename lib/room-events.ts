/**
 * lib/room-events.ts
 * Single entry point to write the room activity log (RoomEvent, PT-10).
 *
 * Rules:
 *  - Call it inside the same transaction as the change it records, so a failed
 *    operation never leaves an event behind.
 *  - Never put ballot content (positions, reasons) in `data`.
 */

import type { EventActor, Prisma, PrismaClient } from '@prisma/client';

export const ROOM_EVENT_TYPES = [
  'room_started',
  'round_closed',
  'round_opened',
  'deadline_extended',
  'room_cancelled',
  'pin_reset',
  'participant_expelled',
  'participant_joined',
  'vote_submitted',
  'round_processed',
  'insufficient_votes',
  'report_viewed',
  'member_added',
  'member_removed',
  'member_code_regenerated',
  'consent_accepted',
] as const;

export type RoomEventType = (typeof ROOM_EVENT_TYPES)[number];

/** Flat metadata only: no nested objects, so ballot content cannot slip in. */
export type RoomEventData = Record<string, string | number | boolean | null>;

export interface RoomEventInput {
  roomId: string;
  type: RoomEventType;
  actor: EventActor;
  round?: number | null;
  participantId?: string | null;
  data?: RoomEventData;
}

type EventWriter = Pick<PrismaClient, 'roomEvent'> | Prisma.TransactionClient;

export async function recordRoomEvent(db: EventWriter, input: RoomEventInput): Promise<void> {
  await db.roomEvent.create({
    data: {
      room_id: input.roomId,
      type: input.type,
      actor: input.actor,
      round: input.round ?? null,
      participant_id: input.participantId ?? null,
      data: input.data ?? undefined,
    },
  });
}
