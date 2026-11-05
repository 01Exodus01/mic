/**
 * app/api/rooms/[id]/sync/route.ts
 * Lightweight real-time synchronization endpoint for room state.
 * Supports ETag / 304 Not Modified to minimize bandwidth and processing.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@mic/backend/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getParticipantSession } from '@/lib/participant-session';
import crypto from 'crypto';

interface RouteContext {
  params: { id: string };
}

export async function GET(
  req: NextRequest,
  { params }: RouteContext
) {
  try {
    const roomId = params.id;
    if (!roomId) {
      return NextResponse.json({ error: 'ID de sala requerido.' }, { status: 400 });
    }

    // 1. Authorization: either Host or Participant
    let hostSession = null;
    try {
      hostSession = await getServerSession(authOptions);
    } catch {
      hostSession = null;
    }

    let participantSession = null;
    try {
      participantSession = await getParticipantSession();
    } catch {
      participantSession = null;
    }

    let isHost = false;
    let participantId: string | null = null;

    if (hostSession?.user?.id) {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { host_id: true },
      });
      if (room && room.host_id === hostSession.user.id) {
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
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
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
      return NextResponse.json({ error: 'Sala no encontrada.' }, { status: 404 });
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
        return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
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

    const clientEtag = req.headers.get('if-none-match');
    const normalizeEtag = (tag: string | null) => tag?.replace(/^W\//, '') ?? '';
    if (clientEtag && normalizeEtag(clientEtag) === normalizeEtag(etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': 'no-cache, private',
        },
      });
    }

    return NextResponse.json(
      {
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
      {
        headers: {
          ETag: etag,
          'Cache-Control': 'no-cache, private',
        },
      }
    );
  } catch (err) {
    console.error('Sync route error:', err);
    return NextResponse.json({ error: 'Error interno de sincronización.' }, { status: 500 });
  }
}
