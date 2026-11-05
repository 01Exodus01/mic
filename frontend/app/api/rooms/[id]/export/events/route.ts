/**
 * app/api/rooms/[id]/export/events/route.ts
 * events.csv (PT-26): the room activity log.
 * Web adapter: the logic is in @mic/backend/services/http/export-events.
 */

import type { NextRequest } from 'next/server';
import { exportEventsCsv } from '@mic/backend/services/http/export-events';
import { requestContext } from '@/lib/request-context';
import { toHttpResponse } from '@/lib/service-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return toHttpResponse(await exportEventsCsv(requestContext(), params));
}
