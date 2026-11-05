/**
 * backend/src/services/http/export-zip.ts
 * Service behind frontend/app/api/rooms/[id]/export/v2: returns a protocol-neutral
 * ServiceResponse; the route only turns it into an HTTP response.
 * The whole normalized export as a ZIP (plan de mejora P3.1): every CSV,
 * README_data_dictionary.md and manifest.json. Host of the room only.
 * ?mode=publication gives the anonymized version (see backend/src/export/request.ts).
 */

import type { RequestContext, ServiceResponse } from '../context';
import prisma from '@mic/backend/db';
import { loadExportDataset } from '@mic/backend/export/dataset';
import { buildExportZip } from '@mic/backend/export/bundle';
import { exportOptionsFrom } from '@mic/backend/export/request';

export async function exportZip(ctx: RequestContext, params: { id: string }, input: { searchParams: URLSearchParams }): Promise<ServiceResponse> {
  try {
    const hostId = await ctx.hostUserId();
    if (!hostId) return { status: 401, body: 'No autorizado' };

    const owned = await prisma.room.findFirst({ where: { id: params.id, host_id: hostId }, select: { id: true, pin: true } });
    if (!owned) return { status: 404, body: 'Sala no encontrada' };

    const dataset = await loadExportDataset(prisma, owned.id);
    if (!dataset) return { status: 404, body: 'Sala no encontrada' };

    const opts = exportOptionsFrom(input.searchParams);
    const { zip } = buildExportZip(dataset, opts);
    const name = `r-fast-cr_${owned.pin}_${opts.mode === 'publication' ? 'publicacion' : 'investigacion'}.zip`;
    return {
      status: 200,
      body: new Uint8Array(zip),
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    };
  } catch (err: unknown) {
    console.error('Error exporting ZIP:', err);
    return { status: 500, body: 'Error generando el archivo ZIP' };
  }
}
