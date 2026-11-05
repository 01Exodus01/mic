/**
 * backend/src/services/http/export-events.ts
 * Service behind frontend/app/api/rooms/[id]/export/events: returns a protocol-neutral
 * ServiceResponse; the route only turns it into an HTTP response.
 * events.csv (PT-26): the room activity log (RoomEvent).
 *
 * Headers: room_id, created_at, round, type, actor, blind_code, data
 *   data: the event's flat metadata as JSON. Events never hold ballot content.
 *
 * Zero-PII: participants appear by blind code only, never nickname or roster label.
 */

import type { RequestContext, ServiceResponse } from '../context';
import prisma from '@mic/backend/db';
import { buildCsv, csvResponseHeaders } from '@mic/backend/shared/csv';

const EVENTS_CSV_HEADERS = ['room_id', 'created_at', 'round', 'type', 'actor', 'blind_code', 'data'];

export async function exportEventsCsv(ctx: RequestContext, params: { id: string }): Promise<ServiceResponse> {
  try {
    const hostId = await ctx.hostUserId();
    if (!hostId) return { status: 401, body: 'No autorizado' };

    const room = await prisma.room.findFirst({ where: { id: params.id, host_id: hostId }, select: { id: true, pin: true } });
    if (!room) return { status: 404, body: 'Sala no encontrada' };

    const events = await prisma.roomEvent.findMany({
      where: { room_id: room.id },
      select: {
        created_at: true,
        round: true,
        type: true,
        actor: true,
        data: true,
        participant: { select: { blind_code: true } },
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });

    const rows = events.map((e) => [
      room.id,
      e.created_at.toISOString(),
      e.round ?? '',
      e.type,
      e.actor,
      e.participant?.blind_code ?? '',
      e.data === null ? '' : JSON.stringify(e.data),
    ]);

    return {
      status: 200,
      body: buildCsv(EVENTS_CSV_HEADERS, rows),
      headers: csvResponseHeaders(`events_${room.pin}.csv`),
    };
  } catch (err: unknown) {
    console.error('Error exporting events.csv:', err);
    return { status: 500, body: 'Error generando archivo CSV' };
  }
}
