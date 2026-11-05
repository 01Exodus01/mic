/**
 * backend/src/services/http/process-deadline.ts
 * Service behind app/api/internal/process-deadline: returns a protocol-neutral
 * ServiceResponse; the route only turns it into an HTTP response.
 * Internal route invoked by the background worker to safely trigger round consensus.
 * Protected by secret token header.
 */

import type { RequestContext, ServiceResponse } from '../context';
import crypto from 'crypto';
import { z } from 'zod';
import prisma from '@mic/backend/db';
import { processRoundConsensus } from '@mic/backend/round-processor';
import { env } from '@mic/backend/env';

const ProcessDeadlineSchema = z.object({
  roomId: z.string().min(1, 'El identificador de sala es obligatorio.'),
});

export async function processDeadline(ctx: RequestContext, input: { workerSecret: string | null; bodyText: string }): Promise<ServiceResponse> {
  try {
    const authHeader = input.workerSecret;
    const expectedSecret = env.WORKER_SECRET;

    if (!authHeader) {
      return { status: 401, body: { error: 'No autorizado.' } };
    }

    // Constant-time comparison using SHA-256 digests to prevent timing attacks and avoid leaking secret length
    const authHash = crypto.createHash('sha256').update(authHeader).digest();
    const expectedHash = crypto.createHash('sha256').update(expectedSecret).digest();

    if (!crypto.timingSafeEqual(authHash, expectedHash)) {
      return { status: 401, body: { error: 'No autorizado.' } };
    }

    let rawBody: unknown;
    try {
      rawBody = JSON.parse(input.bodyText);
    } catch {
      return { status: 422, body: { error: 'El cuerpo de la solicitud no es un JSON válido.' } };
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
      return { status: 422, body: { error: validation.error.errors[0]?.message || 'Parámetros inválidos.' } };
    }

    const { roomId } = validation.data;

    // Verify room state and deadline expiration before processing
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, status: true, deadline: true },
    });

    if (!room) {
      return { status: 404, body: { error: 'Sala no encontrada.' } };
    }

    if (room.status !== 'ROUND_OPEN') {
      return { status: 409, body: { error: 'La sala no está en votación abierta.' } };
    }

    if (!room.deadline || new Date() < room.deadline) {
      return { status: 400, body: { error: 'La hora límite de la ronda no está definida o aún no ha vencido.' } };
    }

    const result = await processRoundConsensus(roomId, { actor: 'SYSTEM', reason: 'TIMEOUT' });

    if (!result.success) {
      return { status: 422, body: { error: result.error } };
    }

    return { status: 200, body: result };
  } catch (err: unknown) {
    console.error('Error in process-deadline route:', err);
    const message = err instanceof Error ? err.message : 'Error interno';
    return { status: 500, body: { error: message } };
  }
}
