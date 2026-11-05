/**
 * app/api/participant/telemetry/route.ts
 * Usability events from the participant screens (sendBeacon).
 * Web adapter: the logic is in @mic/backend/services/http/telemetry.
 */

import type { NextRequest } from 'next/server';
import { receiveTelemetry } from '@mic/backend/services/http/telemetry';
import { requestContext } from '@/lib/request-context';
import { toHttpResponse } from '@/lib/service-response';

export async function POST(req: NextRequest) {
  return toHttpResponse(await receiveTelemetry(requestContext(), { bodyText: await req.text() }));
}
