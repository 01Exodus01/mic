/**
 * lib/request-context.ts
 * Builds the backend RequestContext from the current Next.js request: client
 * IP from the headers, participant session from its signed cookie, host from
 * NextAuth, and revalidatePath for cached pages. Server only.
 */

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  clearParticipantSession,
  createParticipantSession,
  getParticipantSession,
} from '@/lib/participant-session';
import { getClientIp } from '@mic/backend/rate-limit';
import type { RequestContext } from '@mic/backend/services/context';

export function requestContext(): RequestContext {
  return {
    clientIp: async () => getClientIp(await headers()),
    participantSession: () => getParticipantSession(),
    startParticipantSession: (session) => createParticipantSession(session),
    endParticipantSession: () => clearParticipantSession(),
    hostUserId: async () => {
      const session = await getServerSession(authOptions);
      return session?.user?.id ?? null;
    },
    revalidate: (path) => revalidatePath(path),
  };
}
