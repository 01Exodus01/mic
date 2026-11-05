/**
 * app/api/rooms/[id]/export/reasons/route.ts
 * reasons.csv (PT-26): reasons for and against, verbatim.
 * Web adapter: the logic is in @mic/backend/services/http/export-reasons.
 */

import type { NextRequest } from 'next/server';
import { exportReasonsCsv } from '@mic/backend/services/http/export-reasons';
import { requestContext } from '@/lib/request-context';
import { toHttpResponse } from '@/lib/service-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return toHttpResponse(await exportReasonsCsv(requestContext(), params));
}
