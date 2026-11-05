/**
 * app/api/rooms/[id]/sync/route.ts
 * Lightweight room state for polling, with ETag / 304.
 * Web adapter: the logic is in @mic/backend/services/http/room-sync.
 */

import type { NextRequest } from 'next/server';
import { roomSync } from '@mic/backend/services/http/room-sync';
import { requestContext } from '@/lib/request-context';
import { toHttpResponse } from '@/lib/service-response';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return toHttpResponse(
    await roomSync(
      requestContext(),
      params,
      { ifNoneMatch: req.headers.get('if-none-match') },
    )
  );
}
