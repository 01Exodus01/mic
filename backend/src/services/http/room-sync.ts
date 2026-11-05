/**
 * backend/src/services/http/room-sync.ts
 * Service behind frontend/app/api/rooms/[id]/sync: returns a protocol-neutral
 * ServiceResponse; the route only turns it into an HTTP response.
 * Lightweight real-time synchronization endpoint for room state.
 * Supports ETag / 304 Not Modified to minimize bandwidth and processing.
 */

import type { RequestContext, ServiceResponse } from '../context';
import prisma from '@mic/backend/db';
import crypto from 'crypto';

export async function roomSync(ctx: RequestContext, params: { id: string }, input: { ifNoneMatch: string | null }): Promise<ServiceResponse> {
  try {
    const roomId = params.id;
    if (!roomId) {
      return { status: 400, body: { error: 'ID de sala requerido.' } };
    }

    // 1. Authorization: either Host or Participant
    let hostUserId: string | null = null;
    try {
      hostUserId = await ctx.hostUserId();
    } catch {
      hostUserId = null;
    }

    let participantSession = null;
    try {
      participantSession = await ctx.participantSession();
    } catch {
      participantSession = null;
    }

    let isHost = false;
    let participantId: string | null = null;

    if (hostUserId) {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { host_id: true },
      });
      if (room && room.host_id === hostUserId) {
        isHost = true;
      }
    }

    if (!isHost && participantSession) {
      const pRoomId = participantSession.roomId;
      if (pRoomId === roomId) {
        participantId = participantSession.participantId;
      }
    }

    if (!isHost && !participantId) {
      return { status: 401, body: { error: 'No autorizado.' } };
    }

    // 2. Fetch room lightweight state
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        status: true,
        current_round: true,
        deadline: true,
        max_rounds: true,
        tau_threshold: true,
      },
    });

    if (!room) {
      return { status: 404, body: { error: 'Sala no encontrada.' } };
    }

    // Check participant active status (if participant request)
    let isRetired = false;
    if (participantId) {
      const part = await prisma.participant.findUnique({
        where: { id: participantId },
        select: { id: true, is_retired: true, session_version: true },
      });
      if (part && part.session_version !== (participantSession?.sessionVersion ?? 0)) {
        // Session opened before a PIN reset / code regeneration
        return { status: 401, body: { error: 'No autorizado.' } };
      }
      if (!part || part.is_retired) {
        isRetired = true;
      }
    }

    // Count votes for current round
    const voteAgg = await prisma.vote.groupBy({
      by: ['participant_id'],
      where: {
        round: room.current_round,
        option: { room_id: roomId },
        participant: { is_retired: false },
      },
    });
    const voterCount = voteAgg.length;

    // Count participants
    const totalParticipants = await prisma.participant.count({
      where: { room_id: roomId },
    });

    const nowIso = new Date().toISOString();
    const deadlineIso = room.deadline ? room.deadline.toISOString() : null;

    // Generate ETag representing state
    const stateString = `${room.status}:${room.current_round}:${deadlineIso}:${voterCount}:${totalParticipants}:${isRetired}`;
    const etag = `"${crypto.createHash('sha1').update(stateString).digest('hex')}"`;

    const clientEtag = input.ifNoneMatch;
    const normalizeEtag = (tag: string | null) => tag?.replace(/^W\//, '') ?? '';
    if (clientEtag && normalizeEtag(clientEtag) === normalizeEtag(etag)) {
      return {
        status: 304,
        body: null,
        headers: {
          ETag: etag,
          'Cache-Control': 'no-cache, private',
        },
      };
    }

    return {
      status: 200,
      body: {
        roomId: room.id,
        status: room.status,
        currentRound: room.current_round,
        maxRounds: room.max_rounds,
        deadline: deadlineIso,
        voterCount,
        totalParticipants,
        isRetired,
        serverTime: nowIso,
      },
      headers: {
        ETag: etag,
        'Cache-Control': 'no-cache, private',
      },
    };
  } catch (err) {
    console.error('Sync route error:', err);
    return { status: 500, body: { error: 'Error interno de sincronización.' } };
  }
}
