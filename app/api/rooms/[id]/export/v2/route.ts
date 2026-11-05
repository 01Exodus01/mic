/**
 * app/api/rooms/[id]/export/v2/route.ts
 * The whole normalized export as a ZIP (plan de mejora P3.1): every CSV,
 * README_data_dictionary.md and manifest.json. Host of the room only.
 * ?mode=publication gives the anonymized version (see lib/export/request.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@mic/backend/db';
import { loadExportDataset } from '@mic/backend/export/dataset';
import { buildExportZip } from '@mic/backend/export/bundle';
import { exportOptionsFrom } from '@mic/backend/export/request';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new NextResponse('No autorizado', { status: 401 });
    const hostId = (session.user as { id: string }).id;

    const owned = await prisma.room.findFirst({ where: { id: params.id, host_id: hostId }, select: { id: true, pin: true } });
    if (!owned) return new NextResponse('Sala no encontrada', { status: 404 });

    const dataset = await loadExportDataset(prisma, owned.id);
    if (!dataset) return new NextResponse('Sala no encontrada', { status: 404 });

    const opts = exportOptionsFrom(req.nextUrl.searchParams);
    const { zip } = buildExportZip(dataset, opts);
    const name = `r-fast-cr_${owned.pin}_${opts.mode === 'publication' ? 'publicacion' : 'investigacion'}.zip`;
    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    console.error('Error exporting ZIP:', err);
    return new NextResponse('Error generando el archivo ZIP', { status: 500 });
  }
}
