/**
 * backend/src/round-schedule.ts
 * Opens a round the host scheduled (round 1 from DRAFT, or the next one from
 * ROUND_FEEDBACK) once its opening time has come. Called on every room read
 * (lazy, like the deadline check) and by the background worker, so it opens
 * within seconds while anyone has the room open and within the worker interval
 * otherwise.
 *
 * The opening is a compare-and-set on (status, scheduled_open_at): two callers
 * at the same time open the round once.
 */

import prisma from '@mic/backend/db';
import { recordRoomEvent } from '@mic/backend/room-events';

export const SCHEDULABLE_STATUSES = ['DRAFT', 'ROUND_FEEDBACK'] as const;

/**
 * Deadline of a scheduled round opened at `now`. Opening on time (or a little
 * late) keeps the planned closing time; if that already passed (for example the
 * server was down), the round keeps its planned length counted from now.
 */
export function scheduledDeadlineAt(openAt: Date, deadline: Date, now: Date): Date {
  if (deadline.getTime() - now.getTime() >= 60 * 1000) return deadline;
  return new Date(now.getTime() + (deadline.getTime() - openAt.getTime()));
}

/** Opens the scheduled round if it is due. Returns true when this call opened it. */
export async function openScheduledRoundIfDue(roomId: string, now: Date = new Date()): Promise<boolean> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { status: true, current_round: true, max_rounds: true, scheduled_open_at: true, scheduled_deadline: true },
  });
  if (!room || !room.scheduled_open_at || !room.scheduled_deadline) return false;
  if (!(SCHEDULABLE_STATUSES as readonly string[]).includes(room.status)) return false;
  if (room.scheduled_open_at.getTime() > now.getTime()) return false;

  const fromDraft = room.status === 'DRAFT';
  const round = fromDraft ? 1 : room.current_round + 1;
  if (round > room.max_rounds) return false;
  const deadline = scheduledDeadlineAt(room.scheduled_open_at, room.scheduled_deadline, now);
  const minutes = Math.round((deadline.getTime() - now.getTime()) / 60000);

  return prisma.$transaction(async (tx) => {
    const res = await tx.room.updateMany({
      where: { id: roomId, status: room.status, scheduled_open_at: room.scheduled_open_at },
      data: {
        status: 'ROUND_OPEN',
        current_round: round,
        deadline,
        scheduled_open_at: null,
        scheduled_deadline: null,
      },
    });
    if (res.count !== 1) return false;
    await recordRoomEvent(tx, {
      roomId,
      type: fromDraft ? 'room_started' : 'round_opened',
      actor: 'SYSTEM',
      round,
      data: { minutes, timing: 'date', scheduled: true },
    });
    return true;
  });
}

/** Rooms whose scheduled round is due (for the background worker). */
export async function dueScheduledRoomIds(now: Date = new Date()): Promise<string[]> {
  const rooms = await prisma.room.findMany({
    where: { status: { in: [...SCHEDULABLE_STATUSES] }, scheduled_open_at: { lte: now } },
    select: { id: true },
  });
  return rooms.map((r) => r.id);
}
