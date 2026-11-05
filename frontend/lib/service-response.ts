/**
 * lib/service-response.ts
 * Turns a backend ServiceResponse into the HTTP response of a route handler.
 */

import { NextResponse } from 'next/server';
import type { ServiceResponse } from '@mic/backend/services/context';

export function toHttpResponse(res: ServiceResponse): NextResponse {
  const init = { status: res.status, headers: res.headers };
  const { body } = res;
  if (body === null || typeof body === 'string' || body instanceof Uint8Array) {
    return new NextResponse(body, init);
  }
  return NextResponse.json(body, init);
}
