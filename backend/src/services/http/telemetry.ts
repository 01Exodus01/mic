/**
 * backend/src/services/http/telemetry.ts
 * Service behind frontend/app/api/participant/telemetry: returns a protocol-neutral
 * ServiceResponse; the route only turns it into an HTTP response.
 * Receives usability events from the participant screens (plan de mejora P2).
 * A route (not a server action) so the browser can send it with
 * navigator.sendBeacon when the page is hidden or closed.
 */

import type { RequestContext, ServiceResponse } from '../context';
import prisma from '@mic/backend/db';
import { recordClientEvents } from '@mic/backend/telemetry/record';

const STATUS = { ok: 204, invalid: 400, unauthorized: 401, rate_limited: 429 } as const;
const MAX_BODY_BYTES = 16 * 1024;

export async function receiveTelemetry(ctx: RequestContext, input: { bodyText: string }): Promise<ServiceResponse> {
  try {
    const text = input.bodyText;
    if (text.length > MAX_BODY_BYTES) return { status: 413, body: null };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { status: 400, body: null };
    }
    const outcome = await recordClientEvents(prisma, await ctx.participantSession(), body);
    return { status: STATUS[outcome], body: null };
  } catch {
    // Telemetry never breaks the participant flow
    return { status: 500, body: null };
  }
}
