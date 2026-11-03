/**
 * app/actions/participant.ts
 * Server Actions for participant Zero-PII session lifecycle.
 *
 * - joinRoom: Registers or re-authenticates a participant in a room with Zod validation and lockout.
 * - submitVote: UPSERT ballot (idempotent). Validates strict ordering, justifications 25..200 chars.
 * - logoutParticipant: Clears participant session cookie and allows re-entry.
 */

'use server';

import prisma from '@/lib/prisma';
import { Prisma, AggregationMethod, RoomStatus } from '@prisma/client';
import {
  hashParticipantPin,
  verifyParticipantPin,
  generateBlindCode,
} from '@/lib/pin';
import {
  createParticipantSession,
  getParticipantSession,
  clearParticipantSession,
} from '@/lib/participant-session';
import { checkRateLimit, checkLockout, recordFailedAttempt, resetFailedAttempts, getClientIp } from '@/lib/rate-limit';
import { Errors, toApiError } from '@/lib/errors';
import { isVotingOpen } from '@/lib/state-machine';
import {
  ParticipantJoinSchema,
  RoomPinSchema,
  ParticipantNicknameSchema,
  SingleVoteEntrySchema,
  sanitizeText,
} from '@/lib/validations';
import type { ActionResult } from '@/types/actions';
import type { ParticipantSessionPayload } from '@/lib/participant-session';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

export interface ParticipantRoomViewData {
  sala: {
    id: string;
    title: string;
    titulo: string;
    status: RoomStatus;
    estado: RoomStatus;
    currentRound: number;
    rondaActual: number;
    maxRounds: number;
    maxRondas: number;
    deadline: Date | null;
    method: AggregationMethod;
    metodo: AggregationMethod;
    tauThreshold: number;
    tauUmbral: number;
  };
  options: Array<{
    id: string;
    room_id: string;
    title: string;
    description: string;
    order_index: number;
    titulo: string;
    descripcion: string;
    orden_idx: number;
  }>;
  proyectos: Array<{
    id: string;
    room_id: string;
    title: string;
    description: string;
    order_index: number;
    titulo: string;
    descripcion: string;
    orden_idx: number;
  }>;
  session: ParticipantSessionPayload;
  myVotes: Array<{
    id: string;
    participant_id: string;
    round: number;
    option_id: string;
    position: number;
    justification: string;
    created_at: Date;
    proyecto_id: string;
    posicion: number;
    justificacion: string;
  }>;
  latestReport: {
    id: string;
    room_id: string;
    round: number;
    effective_voters: number;
    obtained_tau: number;
    collective_ranking: unknown;
    arguments_json: unknown;
    created_at: Date;
    ronda: number;
    m_efectivo: number;
    ranking_colectivo: unknown;
    tau_obtenido: number;
    argumentos_json: unknown;
  } | null;
  isExpired: boolean;
  serverTime: string;
}

// ─────────────────────────────────────────────
// Verify Room PIN (Anti-enumeration & Rate limited)
// ─────────────────────────────────────────────

export async function verifyRoomPin(roomPin: string): Promise<ActionResult<{ pin: string; title: string }>> {
  try {
    const hdrs = await headers();
    const ip = getClientIp(hdrs);
    const rl = checkRateLimit(`room_query:${ip}`, 30, 60);
    if (!rl.allowed) throw Errors.RATE_LIMITED(rl.resetIn);

    const validation = RoomPinSchema.safeParse(roomPin);
    if (!validation.success) {
      return {
        success: false,
        error: validation.error.errors[0]?.message || 'El PIN de la sala debe tener 6 caracteres alfanuméricos.',
      };
    }

    const pin = validation.data;
    const room = await prisma.room.findUnique({
      where: { pin },
      select: { pin: true, title: true, status: true },
    });

    // Unified message: does not disclose whether room exists or is in an invalid state
    if (!room || room.status === 'CONCLUDED' || room.status === 'CANCELLED' || room.status === 'DRAFT') {
      return { success: false, error: 'No se puede ingresar a esa sala. Revisa el PIN.' };
    }

    return { success: true, data: { pin: room.pin, title: room.title } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Check Nickname In Room (For dynamic Step 3 instructions)
// ─────────────────────────────────────────────

export async function checkNicknameInRoom(
  roomPin: string,
  nickname: string
): Promise<ActionResult<{ exists: boolean }>> {
  try {
    const hdrs = await headers();
    const ip = getClientIp(hdrs);
    const rl = checkRateLimit(`nick_query:${ip}`, 30, 60);
    if (!rl.allowed) throw Errors.RATE_LIMITED(rl.resetIn);

    const pinVal = RoomPinSchema.safeParse(roomPin);
    const nickVal = ParticipantNicknameSchema.safeParse(nickname);
    if (!pinVal.success || !nickVal.success) {
      return { success: false, error: 'Datos no válidos.' };
    }

    const room = await prisma.room.findUnique({
      where: { pin: pinVal.data },
      include: { participants: { select: { nickname: true, is_retired: true } } },
    });

    if (!room || room.status === 'CONCLUDED' || room.status === 'CANCELLED' || room.status === 'DRAFT') {
      return { success: false, error: 'No se puede ingresar a esa sala. Revisa tus datos.' };
    }

    const retired = room.participants.some(
      (p) => p.is_retired && p.nickname.toLowerCase() === nickVal.data.toLowerCase()
    );
    if (retired) {
      return { success: false, error: 'No se puede ingresar a esa sala. Revisa tus datos.' };
    }

    const exists = room.participants.some(
      (p) => !p.is_retired && p.nickname.toLowerCase() === nickVal.data.toLowerCase()
    );

    return { success: true, data: { exists } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Join Room
// ─────────────────────────────────────────────

export async function joinRoom(
  roomPin: string,
  nickname: string,
  pin4: string
): Promise<ActionResult<{ blindCode: string; participantId: string }>> {
  try {
    // 1. Rate limit by IP
    const hdrs = await headers();
    const ip = getClientIp(hdrs);
    const rl = checkRateLimit(`join:${ip}`, 30, 60);
    if (!rl.allowed) throw Errors.RATE_LIMITED(rl.resetIn);

    // 2. Validate inputs with Zod
    const validation = ParticipantJoinSchema.safeParse({ roomPin, nickname, pin4 });
    if (!validation.success) {
      const firstError = validation.error.errors[0]?.message || 'Datos de ingreso inválidos.';
      throw Errors.INVALID_BALLOT(firstError);
    }

    const { roomPin: validPin, nickname: cleanNick, pin4: validPin4 } = validation.data;

    // 3. Find room
    const room = await prisma.room.findUnique({
      where: { pin: validPin },
      include: { participants: { select: { id: true, nickname: true, pin_hash: true, blind_code: true, is_retired: true } } },
    });

    // Unified generic message according to D4 and AGENTS.md (no disclosure of room state)
    if (!room || room.status === 'CONCLUDED' || room.status === 'CANCELLED' || room.status === 'DRAFT') {
      throw Errors.CANNOT_JOIN();
    }

    // 4. Check if nickname already exists in this room (re-authentication)
    const existingParticipant = room.participants.find(
      (p) => p.nickname.toLowerCase() === cleanNick.toLowerCase()
    );

    if (existingParticipant?.is_retired) {
      throw Errors.CANNOT_JOIN();
    }

    const lockoutKey = `pin:${room.id}:${cleanNick.toLowerCase()}`;

    if (existingParticipant) {
      // Check temporal lockout
      const lockout = checkLockout(lockoutKey);
      if (lockout.isLocked) {
        throw Errors.LOCKED_OUT(lockout.remainingSec);
      }

      // Re-authentication: verify PIN
      const valid = await verifyParticipantPin(validPin4, existingParticipant.pin_hash);
      if (!valid) {
        const attempt = recordFailedAttempt(lockoutKey, 5, 900);
        if (attempt.isLocked) {
          throw Errors.LOCKED_OUT(attempt.remainingSec);
        }
        throw Errors.WRONG_PIN();
      }

      // Successful PIN authentication: clear failed attempt tracking
      resetFailedAttempts(lockoutKey);

      await createParticipantSession({
        participantId: existingParticipant.id,
        roomId: room.id,
        salaId: room.id,
        nickname: existingParticipant.nickname,
        blindCode: existingParticipant.blind_code,
      });

      return {
        success: true,
        data: { blindCode: existingParticipant.blind_code, participantId: existingParticipant.id },
      };
    }

    // 5. New registration
    if (room.current_round > 1) {
      throw Errors.CANNOT_JOIN();
    }

    const pinHash = await hashParticipantPin(validPin4);
    const { generateRandomBlindCode } = await import('@/lib/pin');

    const participant = await prisma.$transaction(async (tx) => {
      const existing = await tx.participant.findMany({
        where: { room_id: room.id },
        select: { blind_code: true },
      });

      if (existing.length >= room.max_members) {
        throw Errors.ROOM_FULL(room.max_members);
      }

      const existingCodes = existing.map((p) => p.blind_code);
      const blindCode = generateRandomBlindCode(existingCodes, room.max_members);

      return tx.participant.create({
        data: {
          room_id: room.id,
          nickname: cleanNick,
          pin_hash: pinHash,
          blind_code: blindCode,
        },
      });
    });

    await createParticipantSession({
      participantId: participant.id,
      roomId: room.id,
      salaId: room.id,
      nickname: cleanNick,
      blindCode: participant.blind_code,
    });

    return { success: true, data: { blindCode: participant.blind_code, participantId: participant.id } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Submit Vote (UPSERT — idempotent)
// ─────────────────────────────────────────────

export interface VoteEntry {
  projectId?: string;
  optionId?: string;
  posicion?: number;
  position?: number;
  justificacion?: string;
  justification?: string;
}

export async function submitVote(votes: VoteEntry[]): Promise<ActionResult> {
  try {
    const session = await getParticipantSession();
    if (!session) throw Errors.UNAUTHORIZED();

    const targetRoomId = session.roomId || session.salaId!;

    // Verify in DB that participant exists and belongs to this room
    const participant = await prisma.participant.findFirst({
      where: { id: session.participantId, room_id: targetRoomId },
    });
    if (!participant || participant.is_retired) throw Errors.UNAUTHORIZED();

    const { checkAndProcessExpiredDeadline } = await import('@/lib/round-processor');
    await checkAndProcessExpiredDeadline(targetRoomId);

    // Rate limit per participant
    const rl = checkRateLimit(`vote:${session.participantId}`, 10, 60);
    if (!rl.allowed) throw Errors.RATE_LIMITED(rl.resetIn);

    // Validate each vote entry with Zod and collect parsed items
    const validatedVotes = votes.map((v) => {
      const optId = v.optionId || v.projectId;
      const pos = v.position !== undefined ? v.position : v.posicion;
      const just = v.justification !== undefined ? v.justification : v.justificacion;

      const result = SingleVoteEntrySchema.safeParse({
        optionId: optId,
        position: pos,
        justification: just,
      });

      if (!result.success) {
        const errorMsg = result.error.errors[0]?.message || 'Entrada de voto inválida.';
        throw Errors.INVALID_BALLOT(errorMsg);
      }

      return result.data;
    });

    // Positions uniqueness
    const positions = validatedVotes.map((v) => v.position);
    const uniquePositions = new Set(positions);
    if (uniquePositions.size !== validatedVotes.length) {
      throw Errors.INVALID_BALLOT('Cada opción debe tener una posición única (sin empates).');
    }

    // Transacción interactiva serializable para validar estado, plazo y persistir boleta atómicamente
    await prisma.$transaction(
      async (tx) => {
        const room = await tx.room.findUnique({
          where: { id: targetRoomId },
          include: { options: { orderBy: { order_index: 'asc' } } },
        });

        if (!room) throw Errors.ROOM_NOT_FOUND();
        if (room.status !== 'ROUND_OPEN') throw Errors.ROOM_CLOSED();

        // Deadline check dentro de la transacción
        if (room.deadline && new Date() > room.deadline) {
          throw Errors.ROOM_CLOSED();
        }

        // Bloqueo de fila para evitar colisión con el cierre de ronda concurrente
        try {
          await tx.room.update({
            where: { id: targetRoomId, status: 'ROUND_OPEN' },
            data: { updated_at: new Date() },
          });
        } catch {
          throw Errors.ROOM_CLOSED();
        }

        const n = room.options.length;
        const optionIds = new Set(room.options.map((p) => p.id));

        // Ballot count validation
        if (validatedVotes.length !== n) {
          throw Errors.INVALID_BALLOT(`La boleta debe contener exactamente ${n} opciones.`);
        }

        if (!positions.every((p) => p >= 1 && p <= n)) {
          throw Errors.INVALID_BALLOT(`Las posiciones deben estar en el rango [1, ${n}].`);
        }

        // Cohorte cerrada check for rounds > 1
        if (room.current_round > 1) {
          const round1Vote = await tx.vote.findFirst({
            where: { participant_id: session.participantId, round: 1 },
          });
          if (!round1Vote) throw Errors.NOT_ROUND1_VOTER();
        }

        // Option IDs validity
        for (const vote of validatedVotes) {
          if (!optionIds.has(vote.optionId)) {
            throw Errors.INVALID_BALLOT(`Opción desconocida: ${vote.optionId}`);
          }
        }

        // Reemplazo atómico de votos del participante para esta ronda
        // Evita colisiones de unicidad en (participant_id, round, position) al intercambiar posiciones
        await tx.vote.deleteMany({
          where: {
            participant_id: session.participantId,
            round: room.current_round,
          },
        });

        await tx.vote.createMany({
          data: validatedVotes.map((vote) => ({
            participant_id: session.participantId,
            round: room.current_round,
            option_id: vote.optionId,
            position: vote.position,
            justification: vote.justification,
          })),
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Get Participant Room View
// ─────────────────────────────────────────────

export async function getParticipantRoomView(): Promise<ActionResult<ParticipantRoomViewData>> {
  try {
    const session = await getParticipantSession();
    if (!session) throw Errors.UNAUTHORIZED();

    const targetRoomId = session.roomId || session.salaId!;

    // Verify in DB that participant exists and belongs to this room
    const participant = await prisma.participant.findFirst({
      where: { id: session.participantId, room_id: targetRoomId },
    });
    if (!participant || participant.is_retired) throw Errors.UNAUTHORIZED();

    const { checkAndProcessExpiredDeadline } = await import('@/lib/round-processor');
    await checkAndProcessExpiredDeadline(targetRoomId);

    const room = await prisma.room.findUnique({
      where: { id: targetRoomId },
      include: {
        options: { orderBy: { order_index: 'asc' } },
        reports: { orderBy: { round: 'asc' } },
      },
    });

    if (!room) throw Errors.ROOM_NOT_FOUND();

    // Fetch participant's existing votes for current round
    const myVotes = await prisma.vote.findMany({
      where: {
        participant_id: session.participantId,
        round: room.current_round,
      },
      orderBy: { position: 'asc' },
    });

    // Map votes to support both field naming styles
    const mappedVotes = myVotes.map((v) => ({
      ...v,
      proyecto_id: v.option_id,
      posicion: v.position,
      justificacion: v.justification,
    }));

    // Get latest report for feedback
    const latestReport =
      room.status === 'ROUND_FEEDBACK' || room.status === 'CONCLUDED'
        ? room.reports[room.reports.length - 1] ?? null
        : null;

    const mappedReport = latestReport
      ? {
          ...latestReport,
          ronda: latestReport.round,
          m_efectivo: latestReport.effective_voters,
          ranking_colectivo: latestReport.collective_ranking,
          tau_obtenido: latestReport.obtained_tau,
          argumentos_json: latestReport.arguments_json,
        }
      : null;

    const mappedOptions = room.options.map((o) => ({
      ...o,
      titulo: o.title,
      descripcion: o.description,
      orden_idx: o.order_index,
    }));

    return {
      success: true,
      data: {
        sala: {
          id: room.id,
          title: room.title,
          titulo: room.title,
          status: room.status,
          estado: room.status,
          currentRound: room.current_round,
          rondaActual: room.current_round,
          maxRounds: room.max_rounds,
          maxRondas: room.max_rounds,
          deadline: room.deadline,
          method: room.method,
          metodo: room.method,
          tauThreshold: room.tau_threshold,
          tauUmbral: room.tau_threshold,
        },
        options: mappedOptions,
        proyectos: mappedOptions,
        session,
        myVotes: mappedVotes,
        latestReport: mappedReport,
        isExpired: room.deadline ? new Date() > room.deadline : false,
        serverTime: new Date().toISOString(),
      },
    };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Logout Participant
// ─────────────────────────────────────────────

export async function logoutParticipant(): Promise<ActionResult> {
  try {
    await clearParticipantSession();
    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}
