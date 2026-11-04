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
import { buildVoteSnapshot, isSameSnapshot } from '@/lib/vote-revision';
import { recordRoomEvent } from '@/lib/room-events';
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
  latestReport: ParticipantReportView | null;
  isExpired: boolean;
  serverTime: string;
}

export interface ParticipantRankingView {
  id: string;
  midRank: number;
  score?: number;
}

export interface ParticipantArgumentView {
  blindCode: string;
  codigoCiego: string;
  position: number;
  posicion: number;
  justification: string;
  justificacion: string;
}

/**
 * Report shape delivered to participants. Built field by field on the server so
 * that per-voter metrics (`__metrics`, participant ids, other voters' cix) never
 * leave it.
 */
export interface ParticipantReportView {
  round: number;
  ronda: number;
  effective_voters: number;
  m_efectivo: number;
  obtained_tau: number;
  tau_obtenido: number;
  collective_ranking: ParticipantRankingView[];
  ranking_colectivo: ParticipantRankingView[];
  arguments_json: Record<string, ParticipantArgumentView[]>;
  argumentos_json: Record<string, ParticipantArgumentView[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRankingView(raw: unknown): ParticipantRankingView[] {
  if (!Array.isArray(raw)) return [];
  const result: ParticipantRankingView[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.midRank !== 'number') continue;
    const entry: ParticipantRankingView = { id: item.id, midRank: item.midRank };
    if (typeof item.score === 'number') entry.score = item.score;
    result.push(entry);
  }
  return result;
}

function toArgumentsView(
  raw: unknown,
  optionIds: string[]
): Record<string, ParticipantArgumentView[]> {
  const source = isRecord(raw) ? raw : {};
  const result: Record<string, ParticipantArgumentView[]> = {};
  for (const optionId of optionIds) {
    const list = source[optionId];
    result[optionId] = [];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isRecord(item)) continue;
      const blindCode = typeof item.blindCode === 'string' ? item.blindCode : item.codigoCiego;
      const position = typeof item.position === 'number' ? item.position : item.posicion;
      const justification =
        typeof item.justification === 'string' ? item.justification : item.justificacion;
      if (typeof blindCode !== 'string' || typeof position !== 'number') continue;
      const text = typeof justification === 'string' ? justification : '';
      result[optionId].push({
        blindCode,
        codigoCiego: blindCode,
        position,
        posicion: position,
        justification: text,
        justificacion: text,
      });
    }
  }
  return result;
}

function toParticipantReportView(
  report: {
    round: number;
    effective_voters: number;
    obtained_tau: number;
    collective_ranking: unknown;
    arguments_json: unknown;
  },
  optionIds: string[]
): ParticipantReportView {
  const ranking = toRankingView(report.collective_ranking);
  const args = toArgumentsView(report.arguments_json, optionIds);
  return {
    round: report.round,
    ronda: report.round,
    effective_voters: report.effective_voters,
    m_efectivo: report.effective_voters,
    obtained_tau: report.obtained_tau,
    tau_obtenido: report.obtained_tau,
    collective_ranking: ranking,
    ranking_colectivo: ranking,
    arguments_json: args,
    argumentos_json: args,
  };
}

function isSerializationConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
}

const SERIALIZABLE_MAX_ATTEMPTS = 10;

/**
 * Runs a Serializable transaction, retrying on write conflicts (P2034) with a
 * random, growing pause. Any other error is thrown as is.
 */
async function runSerializableWithRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isSerializationConflict(err)) throw err;
      if (attempt >= SERIALIZABLE_MAX_ATTEMPTS) throw Errors.BUSY();
      const pauseMs = Math.floor(Math.random() * 40 * attempt) + 10;
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
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

      await recordRoomEvent(prisma, {
        roomId: room.id,
        type: 'participant_joined',
        actor: 'PARTICIPANT',
        round: room.current_round,
        participantId: existingParticipant.id,
        data: { returning: true },
      });

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

      const created = await tx.participant.create({
        data: {
          room_id: room.id,
          nickname: cleanNick,
          pin_hash: pinHash,
          blind_code: blindCode,
        },
      });

      await recordRoomEvent(tx, {
        roomId: room.id,
        type: 'participant_joined',
        actor: 'PARTICIPANT',
        round: room.current_round,
        participantId: created.id,
        data: { returning: false },
      });

      return created;
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

    // Transacción interactiva serializable para validar estado, plazo y persistir boleta atómicamente.
    // Votos simultáneos chocan en la fila de la sala (P2034): se reintenta la transacción completa.
    await runSerializableWithRetry(() => prisma.$transaction(
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
        } catch (lockErr) {
          if (isSerializationConflict(lockErr)) throw lockErr;
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

        // PT-09: append a revision only when the ballot content changed
        const snapshot = buildVoteSnapshot(validatedVotes);
        const lastRevision = await tx.voteRevision.findFirst({
          where: { participant_id: session.participantId, round: room.current_round },
          orderBy: { version: 'desc' },
        });
        const changed = !lastRevision || !isSameSnapshot(lastRevision.snapshot, snapshot);
        const version = changed ? (lastRevision?.version ?? 0) + 1 : lastRevision.version;
        if (changed) {
          await tx.voteRevision.create({
            data: {
              room_id: room.id,
              participant_id: session.participantId,
              round: room.current_round,
              version,
              snapshot: snapshot as unknown as Prisma.InputJsonValue,
            },
          });
        }

        // PT-10: log the submission without any ballot content
        await recordRoomEvent(tx, {
          roomId: room.id,
          type: 'vote_submitted',
          actor: 'PARTICIPANT',
          round: room.current_round,
          participantId: session.participantId,
          data: { version, changed },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    ));

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
      justification: v.justification ?? '',
      proyecto_id: v.option_id,
      posicion: v.position,
      justificacion: v.justification ?? '',
    }));

    // Get latest report for feedback
    const latestReport =
      room.status === 'ROUND_FEEDBACK' || room.status === 'CONCLUDED'
        ? room.reports[room.reports.length - 1] ?? null
        : null;

    const mappedReport = latestReport
      ? toParticipantReportView(
          latestReport,
          room.options.map((o) => o.id)
        )
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
