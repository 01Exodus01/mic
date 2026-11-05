/**
 * app/api/rooms/[id]/export/wide/route.ts
 * matrix_wide_metrics.csv (legacy export).
 * Web adapter: the logic is in @mic/backend/services/http/export-wide.
 */

import type { NextRequest } from 'next/server';
import { exportWideCsv } from '@mic/backend/services/http/export-wide';
import { requestContext } from '@/lib/request-context';
import { toHttpResponse } from '@/lib/service-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return toHttpResponse(await exportWideCsv(requestContext(), params));
}
