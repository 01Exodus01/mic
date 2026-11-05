/**
 * backend/src/services/host-dashboard.ts
 * Data of the host's room list (frontend/app/dashboard/page.tsx, a server
 * component). Not exposed as a server action.
 */

import prisma from '@mic/backend/db';
import { Errors } from '@mic/backend/errors';
import type { RequestContext } from './context';

/** Rooms of the signed-in host, newest first, with what the list shows. */
export async function listHostRooms(ctx: RequestContext) {
  const hostId = await ctx.hostUserId();
  if (!hostId) throw Errors.UNAUTHORIZED();
  return prisma.room.findMany({
    where: { host_id: hostId },
    include: {
      options: { select: { id: true } },
      participants: { select: { id: true } },
      reports: {
        orderBy: { round: 'desc' },
        take: 1,
        select: { round: true, obtained_tau: true },
      },
    },
    orderBy: { created_at: 'desc' },
  });
}
