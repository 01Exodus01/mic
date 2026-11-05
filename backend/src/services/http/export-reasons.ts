/**
 * backend/src/services/http/export-reasons.ts
 * Service behind app/api/rooms/[id]/export/reasons: returns a protocol-neutral
 * ServiceResponse; the route only turns it into an HTTP response.
 * reasons.csv (PT-26): one row per reason, verbatim.
 *
 * Headers: room_id, round, blind_code, option_id, side, order, text
 *   side: FOR, AGAINST, or LEGACY (single reason written before PT-13)
 *
 * Zero-PII: blind code only; never nickname or roster label.
 * UTF-8 BOM and formula-injection protection (lib/csv).
 */

import type { RequestContext, ServiceResponse } from '../context';
import prisma from '@mic/backend/db';
import { buildCsv, csvResponseHeaders } from '@mic/backend/shared/csv';

const REASONS_CSV_HEADERS = ['room_id', 'round', 'blind_code', 'option_id', 'side', 'order', 'text'];

export async function exportReasonsCsv(ctx: RequestContext, params: { id: string }): Promise<ServiceResponse> {
  try {
    const hostId = await ctx.hostUserId();
    if (!hostId) return { status: 401, body: 'No autorizado' };

    const room = await prisma.room.findFirst({ where: { id: params.id, host_id: hostId }, select: { id: true, pin: true } });
    if (!room) return { status: 404, body: 'Sala no encontrada' };

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

    return {
      status: 200,
      body: buildCsv(REASONS_CSV_HEADERS, rows),
      headers: csvResponseHeaders(`reasons_${room.pin}.csv`),
    };
  } catch (err: unknown) {
    console.error('Error exporting reasons.csv:', err);
    return { status: 500, body: 'Error generando archivo CSV' };
  }
}
