/**
 * app/api/rooms/[id]/export/v2/route.ts
 * The whole normalized export as a ZIP (?mode=publication, &include_text=1).
 * Web adapter: the logic is in @mic/backend/services/http/export-zip.
 */

import type { NextRequest } from 'next/server';
import { exportZip } from '@mic/backend/services/http/export-zip';
import { requestContext } from '@/lib/request-context';
import { toHttpResponse } from '@/lib/service-response';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return toHttpResponse(
    await exportZip(
      requestContext(),
      params,
      { searchParams: req.nextUrl.searchParams },
    )
  );
}
