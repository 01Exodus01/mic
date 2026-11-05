/**
 * app/api/rooms/[id]/export/long/route.ts
 * matrix_long.csv (legacy export).
 * Web adapter: the logic is in @mic/backend/services/http/export-long.
 */

import type { NextRequest } from 'next/server';
import { exportLongCsv } from '@mic/backend/services/http/export-long';
import { requestContext } from '@/lib/request-context';
import { toHttpResponse } from '@/lib/service-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return toHttpResponse(await exportLongCsv(requestContext(), params));
}
