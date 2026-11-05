/**
 * backend/src/services/http/export-table.ts
 * Service behind frontend/app/api/rooms/[id]/export/v2/[file]: returns a protocol-neutral
 * ServiceResponse; the route only turns it into an HTTP response.
 * One file of the normalized export (plan de mejora de los reportes), e.g.
 * /api/rooms/<id>/export/v2/round_metrics.csv. Host of the room only.
 * Accepts the same ?mode / ?include_text as the ZIP (lib/export/request.ts).
 * The legacy matrix_long / matrix_wide_metrics exports remain during the transition.
 */

import type { RequestContext, ServiceResponse } from '../context';
import prisma from '@mic/backend/db';
import { csvResponseHeaders } from '@mic/backend/shared/csv';
import { loadExportDataset } from '@mic/backend/export/dataset';
import { exportTables } from '@mic/backend/export/bundle';
import { tableToCsv } from '@mic/backend/export/format';
import { exportOptionsFrom } from '@mic/backend/export/request';

export async function exportTableCsv(ctx: RequestContext, params: { id: string; file: string }, input: { searchParams: URLSearchParams }): Promise<ServiceResponse> {
  try {
    const hostId = await ctx.hostUserId();
    if (!hostId) return { status: 401, body: 'No autorizado' };

    const owned = await prisma.room.findFirst({ where: { id: params.id, host_id: hostId }, select: { id: true, pin: true } });
    if (!owned) return { status: 404, body: 'Sala no encontrada' };

    const dataset = await loadExportDataset(prisma, owned.id);
    if (!dataset) return { status: 404, body: 'Sala no encontrada' };

    const table = exportTables(dataset, exportOptionsFrom(input.searchParams)).find((t) => t.name === params.file);
    if (!table) return { status: 404, body: 'Archivo no encontrado' };

    const base = table.name.replace(/\.csv$/, '');
    return { status: 200, body: tableToCsv(table), headers: csvResponseHeaders(`${base}_${owned.pin}.csv`) };
  } catch (err: unknown) {
    console.error('Error exporting normalized table:', err);
    return { status: 500, body: 'Error generando archivo CSV' };
  }
}
