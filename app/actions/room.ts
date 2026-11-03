/**
 * app/actions/room.ts
 * Server Actions for room lifecycle management.
 *
 * All mutations are atomic and use Prisma transactions where needed.
 * State transitions are validated against the finite state machine.
 */

'use server';

import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { generateRoomPin } from '@/lib/pin';
import { isValidTransition, isTerminalState } from '@/lib/state-machine';
import { Errors, toApiError } from '@/lib/errors';
import { AggregationMethod, RoomStatus } from '@prisma/client';
import { processRoundConsensus, checkAndProcessExpiredDeadline } from '@/lib/round-processor';

import { CreateRoomSchema, RoundDurationSchema, ResetPinSchema, MIN_PARTICIPANTS } from '@/lib/validations';
import type { ActionResult } from '@/types/actions';
import type { RankingEntry, BlindArgumentsMap } from '@/types/report';

export type { ActionResult };
export type EstadoSala = RoomStatus;

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CreateRoomInput {
  title?: string;
  titulo?: string;
  method: AggregationMethod;
  metodo?: AggregationMethod;
  minMembers?: number;
  minMiembros?: number;
  maxMembers?: number;
  maxMiembros?: number;
  tauThreshold?: number;
  tauUmbral?: number;
  maxRounds?: number;
  maxRondas?: number;
  options?: { title?: string; titulo?: string; description?: string; descripcion?: string }[];
  proyectos?: { titulo?: string; title?: string; descripcion?: string; description?: string }[];
}

export interface MappedProjectItem {
  id: string;
  room_id: string;
  title: string;
  description: string;
  order_index: number;
  titulo: string;
  descripcion: string;
  orden_idx: number;
}

export interface MappedParticipantItem {
  id: string;
  nickname: string;
  blind_code?: string;
  codigo_ciego?: string;
  is_retired?: boolean;
}

export interface MappedReportItem {
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
  ranking_colectivo: RankingEntry[];
  tau_obtenido: number;
  argumentos_json: BlindArgumentsMap;
}

export interface MappedRoomDetails {
  id: string;
  pin: string;
  title: string;
  host_id: string;
  method: AggregationMethod;
  max_members: number;
  tau_threshold: number;
  max_rounds: number;
  current_round: number;
  status: RoomStatus;
  deadline: Date | null;
  created_at: Date;
  updated_at: Date;
  titulo: string;
  metodo: AggregationMethod;
  min_miembros: number;
  max_miembros: number;
  tau_umbral: number;
  max_rondas: number;
  ronda_actual: number;
  estado: RoomStatus;
  options: Array<{ id: string; room_id: string; title: string; description: string; order_index: number }>;
  proyectos: MappedProjectItem[];
  participantes: MappedParticipantItem[];
  reports: Array<unknown>;
  reportes: MappedReportItem[];
}

export interface RoomStatusData {
  sala: MappedRoomDetails;
  room: MappedRoomDetails;
  votesThisRound: number;
  voterIds: string[];
  isExpired: boolean;
  serverTime: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function requireHost(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw Errors.UNAUTHORIZED();
  return session.user.id;
}


// ─────────────────────────────────────────────
// Create Room
// ─────────────────────────────────────────────

export async function createRoom(input: CreateRoomInput): Promise<ActionResult<{ salaId: string; pin: string }>> {
  try {
    const hostId = await requireHost();

    // Explicit rejection of missing numeric fields (no hidden fallbacks)
    const rawMaxMembers = input.maxMembers !== undefined ? input.maxMembers : input.maxMiembros;
    if (rawMaxMembers === undefined || rawMaxMembers === null) {
      throw Errors.INVALID_BALLOT('El máximo de participantes es obligatorio.');
    }
    const rawMaxRounds = input.maxRounds !== undefined ? input.maxRounds : input.maxRondas;
    if (rawMaxRounds === undefined || rawMaxRounds === null) {
      throw Errors.INVALID_BALLOT('El máximo de rondas es obligatorio.');
    }
    let rawTau = input.tauThreshold !== undefined ? input.tauThreshold : input.tauUmbral;
    if (rawTau === undefined || rawTau === null) {
      throw Errors.INVALID_BALLOT('El acuerdo requerido es obligatorio.');
    }
    // Accept either percentage integer (e.g. 80) or decimal fraction (e.g. 0.8)
    if (rawTau > 0 && rawTau < 1) {
      rawTau = Math.round(rawTau * 100);
    }

    // minMembers in payload is ignored (fixed at 3 per methodology)
    const rawOptions = (input.options || input.proyectos || []).map((o) => ({
      title: o.title || o.titulo,
      description: o.description || o.descripcion,
    }));

    const validation = CreateRoomSchema.safeParse({
      title: input.title || input.titulo,
      method: input.method || input.metodo,
      maxMembers: rawMaxMembers,
      tauThreshold: rawTau,
      maxRounds: rawMaxRounds,
      options: rawOptions,
    });

    if (!validation.success) {
      const firstError = validation.error.errors[0]?.message || 'Datos de configuración de sala inválidos.';
      throw Errors.INVALID_BALLOT(firstError);
    }

    const valid = validation.data;

    // Generate unique room PIN
    let pin = generateRoomPin();
    let attempts = 0;
    while (await prisma.room.findUnique({ where: { pin } })) {
      pin = generateRoomPin();
      if (++attempts > 20) throw new Error('No se pudo generar un PIN único.');
    }

    const room = await prisma.room.create({
      data: {
        pin,
        title: valid.title,
        host_id: hostId,
        method: valid.method,
        max_members: valid.maxMembers,
        tau_threshold: valid.tauThreshold,
        max_rounds: valid.maxRounds,
        options: {
          create: valid.options.map((p, i) => ({
            title: p.title,
            description: p.description || '',
            order_index: i,
          })),
        },
      },
    });

    return { success: true, data: { salaId: room.id, pin: room.pin } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Start Round 1 (DRAFT → ROUND_OPEN)
// ─────────────────────────────────────────────

export async function startRoom(
  salaId: string,
  deadlineMinutes: number
): Promise<ActionResult> {
  try {
    const durVal = RoundDurationSchema.safeParse(deadlineMinutes);
    if (!durVal.success) {
      throw Errors.INVALID_BALLOT(durVal.error.errors[0]?.message || 'Duración inválida.');
    }

    const hostId = await requireHost();
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();
    if (!isValidTransition(room.status, 'ROUND_OPEN')) {
      throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
    }

    const deadline = new Date(Date.now() + durVal.data * 60 * 1000);
    await prisma.room.update({
      where: { id: salaId },
      data: { status: 'ROUND_OPEN', deadline, current_round: 1 },
    });

    revalidatePath(`/dashboard/rooms/${salaId}`);
    revalidatePath('/participant/vote');

    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Close Round Manually (host trigger before deadline)
// ─────────────────────────────────────────────

export async function closeRoundManually(salaId: string): Promise<ActionResult<{ state: string; mEfectivo: number }>> {
  try {
    const hostId = await requireHost();
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();
    if (room.status !== 'ROUND_OPEN') {
      throw Errors.INVALID_STATE(room.status, 'PROCESSING');
    }

    const result = await processRoundConsensus(salaId);

    if (!result.success) {
      return { success: false, error: result.error ?? 'Error procesando consenso.' };
    }

    revalidatePath(`/dashboard/rooms/${salaId}`);
    revalidatePath('/participant/vote');

    return {
      success: true,
      data: { state: result.state, mEfectivo: result.effectiveVoters ?? result.mEfectivo ?? 0 },
    };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Extend Deadline (ROUND_OPEN deadline update or INSUFFICIENT_VOTES → ROUND_OPEN)
// ─────────────────────────────────────────────

export async function extendDeadline(
  salaId: string,
  extraMinutes: number
): Promise<ActionResult> {
  try {
    const durVal = RoundDurationSchema.safeParse(extraMinutes);
    if (!durVal.success) {
      throw Errors.INVALID_BALLOT(durVal.error.errors[0]?.message || 'Duración inválida.');
    }

    const hostId = await requireHost();
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();

    // Extender el plazo en ROUND_OPEN no es una transición de estado: solo actualiza el plazo
    if (room.status === 'ROUND_OPEN') {
      const baseTime = room.deadline && room.deadline.getTime() > Date.now() ? room.deadline.getTime() : Date.now();
      const deadline = new Date(baseTime + durVal.data * 60 * 1000);
      await prisma.room.update({
        where: { id: salaId },
        data: { deadline },
      });
    } else if (room.status === 'INSUFFICIENT_VOTES') {
      if (!isValidTransition(room.status, 'ROUND_OPEN')) {
        throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
      }
      const deadline = new Date(Date.now() + durVal.data * 60 * 1000);
      await prisma.room.update({
        where: { id: salaId },
        data: { status: 'ROUND_OPEN', deadline },
      });
    } else {
      throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
    }

    revalidatePath(`/dashboard/rooms/${salaId}`);
    revalidatePath('/participant/vote');

    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Cancel Room (→ CANCELLED)
// ─────────────────────────────────────────────

export async function cancelRoom(salaId: string): Promise<ActionResult> {
  try {
    const hostId = await requireHost();
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();
    if (!isValidTransition(room.status, 'CANCELLED')) {
      throw Errors.INVALID_STATE(room.status, 'CANCELLED');
    }

    await prisma.room.update({
      where: { id: salaId },
      data: { status: 'CANCELLED', deadline: null },
    });

    revalidatePath(`/dashboard/rooms/${salaId}`);
    revalidatePath('/participant/vote');

    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Open Next Round (ROUND_FEEDBACK → ROUND_OPEN)
// ─────────────────────────────────────────────

export async function openNextRound(
  salaId: string,
  deadlineMinutes: number
): Promise<ActionResult> {
  try {
    const durVal = RoundDurationSchema.safeParse(deadlineMinutes);
    if (!durVal.success) {
      throw Errors.INVALID_BALLOT(durVal.error.errors[0]?.message || 'Duración inválida.');
    }

    const hostId = await requireHost();
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();
    if (!isValidTransition(room.status, 'ROUND_OPEN')) {
      throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
    }

    const deadline = new Date(Date.now() + durVal.data * 60 * 1000);
    await prisma.room.update({
      where: { id: salaId },
      data: {
        status: 'ROUND_OPEN',
        deadline,
        current_round: room.current_round + 1,
      },
    });

    revalidatePath(`/dashboard/rooms/${salaId}`);
    revalidatePath('/participant/vote');

    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Get Room Status (for live dashboard polling)
// ─────────────────────────────────────────────

export async function getRoomStatus(salaId: string): Promise<ActionResult<RoomStatusData>> {
  try {
    const hostId = await requireHost();

    // Verify room existence and host authorization BEFORE triggering any mutations
    const roomCheck = await prisma.room.findUnique({
      where: { id: salaId },
      select: { host_id: true },
    });
    if (!roomCheck) throw Errors.ROOM_NOT_FOUND();
    if (roomCheck.host_id !== hostId) throw Errors.UNAUTHORIZED();

    // Lazy evaluation of expired deadline only for authorized host
    await checkAndProcessExpiredDeadline(salaId);

    const room = await prisma.room.findFirst({
      where: { id: salaId, host_id: hostId },
      include: {
        options: { orderBy: { order_index: 'asc' } },
        participants: {
          where: { is_retired: false },
          select: { id: true, nickname: true, is_retired: true },
          orderBy: { created_at: 'asc' },
        }, // AUD-03: No exponer blind_code al anfitrión. AUD-13: Solo participantes activos
        reports: { orderBy: { round: 'asc' } },
      },
    });

    if (!room) throw Errors.ROOM_NOT_FOUND();

    // Count votes for current round
    const votesThisRound = await prisma.vote.groupBy({
      by: ['participant_id'],
      where: {
        option: { room_id: salaId },
        round: room.current_round,
      },
    });

    const voterIds = votesThisRound.map((v) => v.participant_id);

    // Map room object to expose both English and legacy fields for compatibility
    const mappedRoom: MappedRoomDetails = {
      ...room,
      titulo: room.title,
      metodo: room.method,
      min_miembros: MIN_PARTICIPANTS,
      max_miembros: room.max_members,
      tau_umbral: room.tau_threshold,
      max_rondas: room.max_rounds,
      ronda_actual: room.current_round,
      estado: room.status,
      proyectos: room.options.map((o) => ({
        ...o,
        titulo: o.title,
        descripcion: o.description,
        orden_idx: o.order_index,
      })),
      participantes: room.participants.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        is_retired: p.is_retired,
      })),
      reportes: room.reports.map((r) => ({
        ...r,
        ronda: r.round,
        m_efectivo: r.effective_voters,
        ranking_colectivo: r.collective_ranking as unknown as RankingEntry[],
        tau_obtenido: r.obtained_tau,
        argumentos_json: r.arguments_json as unknown as BlindArgumentsMap,
      })),
    };

    return {
      success: true,
      data: {
        sala: mappedRoom,
        room: mappedRoom,
        votesThisRound: votesThisRound.length,
        voterIds,
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
// Reset Participant PIN (host rescue)
// ─────────────────────────────────────────────

export async function resetParticipantPin(
  salaId: string,
  participantId: string,
  newPin: string
): Promise<ActionResult> {
  try {
    const pinVal = ResetPinSchema.safeParse({ newPin });
    if (!pinVal.success) {
      throw Errors.INVALID_BALLOT(pinVal.error.errors[0]?.message || 'El PIN personal debe tener exactamente 4 dígitos.');
    }

    const hostId = await requireHost();
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();

    // Verify participant belongs strictly to this room (BOLA protection)
    const participant = await prisma.participant.findFirst({
      where: { id: participantId, room_id: salaId },
    });
    if (!participant) throw Errors.PARTICIPANT_NOT_FOUND();

    const { hashParticipantPin } = await import('@/lib/pin');
    const pinHash = await hashParticipantPin(pinVal.data.newPin);
    await prisma.participant.update({
      where: { id: participantId },
      data: { pin_hash: pinHash },
    });

    revalidatePath(`/dashboard/rooms/${salaId}`);
    revalidatePath('/participant/vote');

    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Expel Participant (Host logical delete - AUD-13, D2, D3)
// ─────────────────────────────────────────────

export async function expelParticipant(
  salaId: string,
  participantId: string
): Promise<ActionResult<{ activeCount: number }>> {
  try {
    const hostId = await requireHost();
    const room = await prisma.room.findUnique({
      where: { id: salaId },
    });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();

    const targetParticipant = await prisma.participant.findFirst({
      where: { id: participantId, room_id: salaId },
    });
    if (!targetParticipant) throw Errors.PARTICIPANT_NOT_FOUND();

    if (!targetParticipant.is_retired) {
      // D2: Transacción atómica: borrado lógico y purga EXCLUSIVAMENTE de los votos de la ronda activa
      await prisma.$transaction(async (tx) => {
        await tx.participant.update({
          where: { id: participantId },
          data: { is_retired: true },
        });

        // Purga solo votos de la ronda actual (rondas cerradas se conservan)
        await tx.vote.deleteMany({
          where: {
            participant_id: participantId,
            round: room.current_round,
          },
        });
      });
    }

    const remainingActive = await prisma.participant.count({
      where: { room_id: salaId, is_retired: false },
    });

    revalidatePath(`/dashboard/rooms/${salaId}`);
    revalidatePath('/participant/vote');

    return { success: true, data: { activeCount: remainingActive } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}
