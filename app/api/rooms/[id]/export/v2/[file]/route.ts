/**
 * app/api/rooms/[id]/export/v2/[file]/route.ts
 * One file of the normalized export, e.g. round_metrics.csv.
 * Web adapter: the logic is in @mic/backend/services/http/export-table.
 */

import type { NextRequest } from 'next/server';
import { exportTableCsv } from '@mic/backend/services/http/export-table';
import { requestContext } from '@/lib/request-context';
import { toHttpResponse } from '@/lib/service-response';

export async function GET(req: NextRequest, { params }: { params: { id: string; file: string } }) {
  return toHttpResponse(
    await exportTableCsv(
      requestContext(),
      params,
      { searchParams: req.nextUrl.searchParams },
    )
  );
}
