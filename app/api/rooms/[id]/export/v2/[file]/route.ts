/**
 * app/api/rooms/[id]/export/v2/[file]/route.ts
 * One file of the normalized export (plan de mejora de los reportes), e.g.
 * /api/rooms/<id>/export/v2/round_metrics.csv. Host of the room only.
 * The legacy matrix_long / matrix_wide_metrics exports remain during the transition.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { csvResponseHeaders } from '@/lib/csv';
import { loadExportDataset } from '@/lib/export/dataset';
import { buildExportTables } from '@/lib/export/tables';
import { tableToCsv } from '@/lib/export/format';

export async function GET(_req: NextRequest, { params }: { params: { id: string; file: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new NextResponse('No autorizado', { status: 401 });
    const hostId = (session.user as { id: string }).id;

    const owned = await prisma.room.findFirst({ where: { id: params.id, host_id: hostId }, select: { id: true, pin: true } });
    if (!owned) return new NextResponse('Sala no encontrada', { status: 404 });

    const dataset = await loadExportDataset(prisma, owned.id);
    if (!dataset) return new NextResponse('Sala no encontrada', { status: 404 });

    const table = buildExportTables(dataset).find((t) => t.name === params.file);
    if (!table) return new NextResponse('Archivo no encontrado', { status: 404 });

    const base = table.name.replace(/\.csv$/, '');
    return new NextResponse(tableToCsv(table), { status: 200, headers: csvResponseHeaders(`${base}_${owned.pin}.csv`) });
  } catch (err: unknown) {
    console.error('Error exporting normalized table:', err);
    return new NextResponse('Error generando archivo CSV', { status: 500 });
  }
}
