/**
 * app/api/rooms/[id]/export/events/route.ts
 * events.csv (PT-26): the room activity log (RoomEvent).
 *
 * Headers: room_id, created_at, round, type, actor, blind_code, data
 *   data: the event's flat metadata as JSON. Events never hold ballot content.
 *
 * Zero-PII: participants appear by blind code only, never nickname or roster label.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@mic/backend/db';
import { buildCsv, csvResponseHeaders } from '@mic/backend/shared/csv';

const EVENTS_CSV_HEADERS = ['room_id', 'created_at', 'round', 'type', 'actor', 'blind_code', 'data'];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new NextResponse('No autorizado', { status: 401 });
    const hostId = (session.user as { id: string }).id;

    const room = await prisma.room.findFirst({ where: { id: params.id, host_id: hostId }, select: { id: true, pin: true } });
    if (!room) return new NextResponse('Sala no encontrada', { status: 404 });

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

    return new NextResponse(buildCsv(EVENTS_CSV_HEADERS, rows), {
      status: 200,
      headers: csvResponseHeaders(`events_${room.pin}.csv`),
    });
  } catch (err: unknown) {
    console.error('Error exporting events.csv:', err);
    return new NextResponse('Error generando archivo CSV', { status: 500 });
  }
}
