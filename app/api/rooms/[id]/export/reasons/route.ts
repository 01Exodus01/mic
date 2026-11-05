/**
 * app/api/rooms/[id]/export/reasons/route.ts
 * reasons.csv (PT-26): one row per reason, verbatim.
 *
 * Headers: room_id, round, blind_code, option_id, side, order, text
 *   side: FOR, AGAINST, or LEGACY (single reason written before PT-13)
 *
 * Zero-PII: blind code only; never nickname or roster label.
 * UTF-8 BOM and formula-injection protection (lib/csv).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@mic/backend/db';
import { buildCsv, csvResponseHeaders } from '@mic/backend/shared/csv';

const REASONS_CSV_HEADERS = ['room_id', 'round', 'blind_code', 'option_id', 'side', 'order', 'text'];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new NextResponse('No autorizado', { status: 401 });
    const hostId = (session.user as { id: string }).id;

    const room = await prisma.room.findFirst({ where: { id: params.id, host_id: hostId }, select: { id: true, pin: true } });
    if (!room) return new NextResponse('Sala no encontrada', { status: 404 });

    const votes = await prisma.vote.findMany({
      where: { option: { room_id: room.id } },
      select: {
        round: true,
        option_id: true,
        justification: true,
        participant: { select: { blind_code: true } },
        reasons: { select: { side: true, order_index: true, text: true }, orderBy: [{ side: 'asc' }, { order_index: 'asc' }] },
      },
      orderBy: [{ round: 'asc' }, { participant: { blind_code: 'asc' } }, { position: 'asc' }],
    });

    const rows: Array<Array<string | number>> = [];
    for (const v of votes) {
      if (v.justification) {
        rows.push([room.id, v.round, v.participant.blind_code, v.option_id, 'LEGACY', 0, v.justification]);
      }
      for (const r of v.reasons) {
        rows.push([room.id, v.round, v.participant.blind_code, v.option_id, r.side, r.order_index, r.text]);
      }
    }

    return new NextResponse(buildCsv(REASONS_CSV_HEADERS, rows), {
      status: 200,
      headers: csvResponseHeaders(`reasons_${room.pin}.csv`),
    });
  } catch (err: unknown) {
    console.error('Error exporting reasons.csv:', err);
    return new NextResponse('Error generando archivo CSV', { status: 500 });
  }
}
