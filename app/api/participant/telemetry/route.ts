/**
 * app/api/participant/telemetry/route.ts
 * Receives usability events from the participant screens (plan de mejora P2).
 * A route (not a server action) so the browser can send it with
 * navigator.sendBeacon when the page is hidden or closed.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getParticipantSession } from '@/lib/participant-session';
import { recordClientEvents } from '@/lib/telemetry/record';

const STATUS = { ok: 204, invalid: 400, unauthorized: 401, rate_limited: 429 } as const;
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: NextRequest) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return new NextResponse(null, { status: 400 });
    }
    const outcome = await recordClientEvents(prisma, await getParticipantSession(), body);
    return new NextResponse(null, { status: STATUS[outcome] });
  } catch {
    // Telemetry never breaks the participant flow
    return new NextResponse(null, { status: 500 });
  }
}
