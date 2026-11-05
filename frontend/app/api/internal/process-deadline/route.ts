/**
 * app/api/internal/process-deadline/route.ts
 * Closes an expired round; called by the worker with its secret.
 * Web adapter: the logic is in @mic/backend/services/http/process-deadline.
 */

import type { NextRequest } from 'next/server';
import { processDeadline } from '@mic/backend/services/http/process-deadline';
import { requestContext } from '@/lib/request-context';
import { toHttpResponse } from '@/lib/service-response';

export async function POST(req: NextRequest) {
  return toHttpResponse(
    await processDeadline(
      requestContext(),
      { workerSecret: req.headers.get('x-worker-secret'), bodyText: await req.text() },
    )
  );
}
