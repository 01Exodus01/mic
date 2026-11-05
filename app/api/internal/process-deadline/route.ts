/**
 * app/api/internal/process-deadline/route.ts
 * Internal route invoked by the background worker to safely trigger round consensus.
 * Protected by secret token header.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { processRoundConsensus } from '@/lib/round-processor';
import { env } from '@/lib/env';

const ProcessDeadlineSchema = z.object({
  roomId: z.string().min(1, 'El identificador de sala es obligatorio.'),
});

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('x-worker-secret');
    const expectedSecret = env.WORKER_SECRET;

    if (!authHeader) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    }

    // Constant-time comparison using SHA-256 digests to prevent timing attacks and avoid leaking secret length
    const authHash = crypto.createHash('sha256').update(authHeader).digest();
    const expectedHash = crypto.createHash('sha256').update(expectedSecret).digest();

    if (!crypto.timingSafeEqual(authHash, expectedHash)) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'El cuerpo de la solicitud no es un JSON válido.' }, { status: 422 });
    }

    const payload =
      typeof rawBody === 'object' && rawBody !== null
        ? {
            roomId:
              (rawBody as Record<string, unknown>).roomId ??
              (rawBody as Record<string, unknown>).salaId,
          }
        : rawBody;

    const validation = ProcessDeadlineSchema.safeParse(payload);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.errors[0]?.message || 'Parámetros inválidos.' },
        { status: 422 }
      );
    }

    const { roomId } = validation.data;

    // Verify room state and deadline expiration before processing
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, status: true, deadline: true },
    });

    if (!room) {
      return NextResponse.json({ error: 'Sala no encontrada.' }, { status: 404 });
    }

    if (room.status !== 'ROUND_OPEN') {
      return NextResponse.json({ error: 'La sala no está en votación abierta.' }, { status: 409 });
    }

    if (!room.deadline || new Date() < room.deadline) {
      return NextResponse.json(
        { error: 'La hora límite de la ronda no está definida o aún no ha vencido.' },
        { status: 400 }
      );
    }

    const result = await processRoundConsensus(roomId, { actor: 'SYSTEM', reason: 'TIMEOUT' });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('Error in process-deadline route:', err);
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
