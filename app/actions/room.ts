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
import { recordRoomEvent } from '@/lib/room-events';
import { generateMemberCode, hashMemberCode, parseRosterText } from '@/lib/member-codes';

import {
  CreateRoomSchema,
  RoundDurationSchema,
  ResetPinSchema,
  MIN_PARTICIPANTS,
  RoomSettingsSchema,
  RoomMemberLabelSchema,
  type RoomSettingsInput,
} from '@/lib/validations';
import type { ActionResult } from '@/types/actions';
import type { RankingEntry } from '@/types/report';

export type { ActionResult };
export type EstadoSala = RoomStatus;

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CreateRoomInput {
  title?: string;
  method: AggregationMethod;
  minMembers?: number;
  maxMembers?: number;
  tauThreshold?: number;
  maxRounds?: number;
  options?: { title?: string; description?: string }[];
  /** Advanced settings (PT-18). Omitted fields take the defaults (previous behaviour). */
  settings?: RoomSettingsInput;
}

export interface MappedParticipantItem {
  id: string;
  nickname: string;
  blind_code?: string;
  is_retired?: boolean;
}

export interface MappedReportItem {
  id: string;
  room_id: string;
  round: number;
  effective_voters: number;
  obtained_tau: number;
  collective_ranking: RankingEntry[];
  /** Always {} for the host (PT-25): no per-voter metrics or signed reasons */
  arguments_json: Record<string, never>;
  created_at: Date;
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
  options: Array<{ id: string; room_id: string; title: string; description: string; order_index: number }>;
  participants: MappedParticipantItem[];
  reports: MappedReportItem[];
}

export interface RoomStatusData {
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
    const rawMaxMembers = input.maxMembers;
    if (rawMaxMembers === undefined || rawMaxMembers === null) {
      throw Errors.INVALID_BALLOT('El máximo de participantes es obligatorio.');
    }
    const rawMaxRounds = input.maxRounds;
    if (rawMaxRounds === undefined || rawMaxRounds === null) {
      throw Errors.INVALID_BALLOT('El máximo de rondas es obligatorio.');
    }
    let rawTau = input.tauThreshold;
    if (rawTau === undefined || rawTau === null) {
      throw Errors.INVALID_BALLOT('El acuerdo requerido es obligatorio.');
    }
    // Accept either percentage integer (e.g. 80) or decimal fraction (e.g. 0.8)
    if (rawTau > 0 && rawTau < 1) {
      rawTau = Math.round(rawTau * 100);
    }

    // minMembers in payload is ignored (fixed at 3 per methodology)
    const rawOptions = (input.options || []).map((o) => ({
      title: o.title,
      description: o.description,
    }));

    const validation = CreateRoomSchema.safeParse({
      title: input.title,
      method: input.method,
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

    const settingsValidation = RoomSettingsSchema.safeParse(input.settings ?? {});
    if (!settingsValidation.success) {
      throw Errors.INVALID_BALLOT(
        settingsValidation.error.errors[0]?.message || 'Opciones avanzadas no válidas.'
      );
    }
    const settings = settingsValidation.data;

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
        tie_break_rule: settings.tieBreakRule,
        concordance_variant: settings.concordanceVariant,
        access_mode: settings.accessMode,
        allow_late_join: settings.allowLateJoin,
        close_when_all_voted: settings.closeWhenAllVoted,
        consent_required: settings.consentRequired,
        consent_text: settings.consentRequired ? settings.consentText : null,
        consent_version: 1,
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
    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: salaId },
        data: { status: 'ROUND_OPEN', deadline, current_round: 1 },
      });
      await recordRoomEvent(tx, {
        roomId: salaId,
        type: 'room_started',
        actor: 'HOST',
        round: 1,
        data: { minutes: durVal.data },
      });
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

    const result = await processRoundConsensus(salaId, { actor: 'HOST', reason: 'HOST' });

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
      await prisma.$transaction(async (tx) => {
        await tx.room.update({
          where: { id: salaId },
          data: { deadline },
        });
        await recordRoomEvent(tx, {
          roomId: salaId,
          type: 'deadline_extended',
          actor: 'HOST',
          round: room.current_round,
          data: { minutes: durVal.data, reopened: false },
        });
      });
    } else if (room.status === 'INSUFFICIENT_VOTES') {
      if (!isValidTransition(room.status, 'ROUND_OPEN')) {
        throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
      }
      const deadline = new Date(Date.now() + durVal.data * 60 * 1000);
      await prisma.$transaction(async (tx) => {
        await tx.room.update({
          where: { id: salaId },
          data: { status: 'ROUND_OPEN', deadline },
        });
        await recordRoomEvent(tx, {
          roomId: salaId,
          type: 'deadline_extended',
          actor: 'HOST',
          round: room.current_round,
          data: { minutes: durVal.data, reopened: true },
        });
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

    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: salaId },
        data: { status: 'CANCELLED', deadline: null },
      });
      await recordRoomEvent(tx, {
        roomId: salaId,
        type: 'room_cancelled',
        actor: 'HOST',
        round: room.current_round,
        data: { fromStatus: room.status },
      });
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
    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: salaId },
        data: {
          status: 'ROUND_OPEN',
          deadline,
          current_round: room.current_round + 1,
        },
      });
      await recordRoomEvent(tx, {
        roomId: salaId,
        type: 'round_opened',
        actor: 'HOST',
        round: room.current_round + 1,
        data: { minutes: durVal.data },
      });
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
        participant: { is_retired: false },
      },
    });

    const voterIds = votesThisRound.map((v) => v.participant_id);

    // Map room object to expose both English and legacy fields for compatibility
    const mappedRoom: MappedRoomDetails = {
      ...room,
      // PT-25: the host gets group results only. arguments_json carries per-voter
      // metrics (participant id + cix) and blind-signed reasons; the panel does not
      // use it and it must not let the host link a named person to a cix.
      reports: room.reports.map((r) => ({
        ...r,
        collective_ranking: r.collective_ranking as unknown as RankingEntry[],
        arguments_json: {},
      })),
    };

    return {
      success: true,
      data: {
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
    await prisma.$transaction(async (tx) => {
      await tx.participant.update({
        where: { id: participantId },
        // Raising session_version signs out sessions opened with the old PIN
        data: { pin_hash: pinHash, session_version: { increment: 1 } },
      });
      await recordRoomEvent(tx, {
        roomId: salaId,
        type: 'pin_reset',
        actor: 'HOST',
        round: room.current_round,
        participantId,
      });
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
      // PT-11: borrado lógico. Los votos se conservan en la base (también los de la
      // ronda activa); round-processor los excluye del cálculo y del conteo.
      await prisma.$transaction(async (tx) => {
        await tx.participant.update({
          where: { id: participantId },
          data: { is_retired: true },
        });

        await recordRoomEvent(tx, {
          roomId: salaId,
          type: 'participant_expelled',
          actor: 'HOST',
          round: room.current_round,
          participantId,
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

// ─────────────────────────────────────────────
// Course roster (PT-21): members with personal access codes
// ─────────────────────────────────────────────

export interface RoomMemberItem {
  id: string;
  label: string;
  joined: boolean;
  isRemoved: boolean;
  addedRound: number;
}

export interface IssuedMemberCode {
  memberId: string;
  label: string;
  /** Shown once; only its hash is stored */
  code: string;
}

async function requireRosterRoom(roomId: string) {
  const hostId = await requireHost();
  const room = await prisma.room.findFirst({ where: { id: roomId, host_id: hostId } });
  if (!room) throw Errors.ROOM_NOT_FOUND();
  if (room.access_mode !== 'ROSTER') {
    throw Errors.INVALID_BALLOT('Esta sala no usa una lista de participantes.');
  }
  if (isTerminalState(room.status)) {
    throw Errors.INVALID_BALLOT('La sala ya terminó; no se puede cambiar la lista.');
  }
  return room;
}

async function addMembers(roomId: string, rawLabels: string[]): Promise<IssuedMemberCode[]> {
  const room = await requireRosterRoom(roomId);

  const labels: string[] = [];
  for (const raw of rawLabels) {
    const parsed = RoomMemberLabelSchema.safeParse(raw);
    if (!parsed.success) {
      throw Errors.INVALID_BALLOT(parsed.error.errors[0]?.message || 'Etiqueta no válida.');
    }
    labels.push(parsed.data);
  }
  if (labels.length === 0) throw Errors.INVALID_BALLOT('No hay etiquetas para agregar.');

  const seen = new Set<string>();
  const repeatedInBatch = labels.filter((l) => {
    const key = l.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (repeatedInBatch.length > 0) {
    throw Errors.INVALID_BALLOT(`Etiquetas repetidas: ${[...new Set(repeatedInBatch)].join(', ')}.`);
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.roomMember.findMany({ where: { room_id: roomId }, select: { label: true, is_removed: true } });
    const existingKeys = new Set(existing.map((m) => m.label.toLowerCase()));
    const alreadyListed = labels.filter((l) => existingKeys.has(l.toLowerCase()));
    if (alreadyListed.length > 0) {
      throw Errors.INVALID_BALLOT(`Ya están en la lista: ${alreadyListed.join(', ')}.`);
    }
    const active = existing.filter((m) => !m.is_removed).length;
    if (active + labels.length > room.max_members) {
      throw Errors.ROOM_FULL(room.max_members);
    }

    const issued = labels.map((label) => ({ label, code: generateMemberCode() }));
    const created = await tx.roomMember.createManyAndReturn({
      data: issued.map(({ label, code }) => ({
        room_id: roomId,
        label,
        access_code_hash: hashMemberCode(code),
        added_round: room.current_round,
      })),
      select: { id: true, label: true },
    });
    await recordRoomEvent(tx, {
      roomId,
      type: 'member_added',
      actor: 'HOST',
      round: room.current_round,
      data: { count: created.length },
    });
    const idByLabel = new Map(created.map((c) => [c.label, c.id]));
    return issued.map(({ label, code }) => ({ memberId: idByLabel.get(label)!, label, code }));
  });
}

export async function addRoomMember(roomId: string, label: string): Promise<ActionResult<{ issued: IssuedMemberCode[] }>> {
  try {
    const issued = await addMembers(roomId, [label]);
    return { success: true, data: { issued } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

/** Pasted lines or the text of a CSV file: first field of each line is the label. */
export async function importRoomMembers(roomId: string, text: string): Promise<ActionResult<{ issued: IssuedMemberCode[] }>> {
  try {
    if (typeof text !== 'string' || text.length > 200_000) {
      throw Errors.INVALID_BALLOT('El texto de la lista no es válido.');
    }
    const issued = await addMembers(roomId, parseRosterText(text));
    return { success: true, data: { issued } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

export async function getRoomMembers(roomId: string): Promise<ActionResult<{ members: RoomMemberItem[] }>> {
  try {
    const hostId = await requireHost();
    const room = await prisma.room.findFirst({ where: { id: roomId, host_id: hostId }, select: { id: true } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    const members = await prisma.roomMember.findMany({
      where: { room_id: roomId },
      select: { id: true, label: true, participant_id: true, is_removed: true, added_round: true },
      orderBy: { label: 'asc' },
    });
    return {
      success: true,
      data: {
        members: members.map((m) => ({
          id: m.id,
          label: m.label,
          joined: m.participant_id !== null,
          isRemoved: m.is_removed,
          addedRound: m.added_round,
        })),
      },
    };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

/**
 * Removes a member from the roster: the code stops working and, if they had
 * already joined, they are retired like an expelled participant (their votes
 * are kept and excluded from later computations).
 */
export async function removeRoomMember(roomId: string, memberId: string): Promise<ActionResult> {
  try {
    const room = await requireRosterRoom(roomId);
    const member = await prisma.roomMember.findFirst({ where: { id: memberId, room_id: roomId } });
    if (!member) throw Errors.PARTICIPANT_NOT_FOUND();
    if (!member.is_removed) {
      await prisma.$transaction(async (tx) => {
        await tx.roomMember.update({ where: { id: memberId }, data: { is_removed: true } });
        if (member.participant_id) {
          await tx.participant.update({ where: { id: member.participant_id }, data: { is_retired: true } });
        }
        await recordRoomEvent(tx, {
          roomId,
          type: 'member_removed',
          actor: 'HOST',
          round: room.current_round,
          participantId: member.participant_id,
          data: { hadJoined: member.participant_id !== null },
        });
      });
    }
    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

export async function regenerateMemberCode(roomId: string, memberId: string): Promise<ActionResult<{ issued: IssuedMemberCode }>> {
  try {
    const room = await requireRosterRoom(roomId);
    const member = await prisma.roomMember.findFirst({ where: { id: memberId, room_id: roomId, is_removed: false } });
    if (!member) throw Errors.PARTICIPANT_NOT_FOUND();
    const code = generateMemberCode();
    await prisma.$transaction(async (tx) => {
      await tx.roomMember.update({ where: { id: memberId }, data: { access_code_hash: hashMemberCode(code) } });
      if (member.participant_id) {
        // Sessions opened with the old code stop working
        await tx.participant.update({ where: { id: member.participant_id }, data: { session_version: { increment: 1 } } });
      }
      await recordRoomEvent(tx, {
        roomId,
        type: 'member_code_regenerated',
        actor: 'HOST',
        round: room.current_round,
        participantId: member.participant_id,
      });
    });
    return { success: true, data: { issued: { memberId, label: member.label, code } } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Participation by round (PT-25): states only, never ballot content
// ─────────────────────────────────────────────

export type ParticipationState = 'not_joined' | 'joined' | 'voted' | 'not_voted' | 'retired' | 'removed';

export interface ParticipationRow {
  key: string;
  /** Roster label (roster rooms) or nickname (open rooms); never the blind code */
  name: string;
  states: ParticipationState[];
}

export interface ParticipationData {
  rounds: number[];
  rows: ParticipationRow[];
}

export async function getRoomParticipation(roomId: string): Promise<ActionResult<ParticipationData>> {
  try {
    const hostId = await requireHost();
    const room = await prisma.room.findFirst({
      where: { id: roomId, host_id: hostId },
      include: { options: { select: { id: true } }, reports: { select: { round: true } } },
    });
    if (!room) throw Errors.ROOM_NOT_FOUND();

    const lastRound = room.status === 'DRAFT' ? 0 : room.current_round;
    const rounds = Array.from({ length: lastRound }, (_, i) => i + 1);
    const optionCount = room.options.length;

    const participants = await prisma.participant.findMany({
      where: { room_id: roomId },
      select: { id: true, nickname: true, is_retired: true, joined_round: true },
      orderBy: { created_at: 'asc' },
    });
    const voteCounts = await prisma.vote.groupBy({
      by: ['participant_id', 'round'],
      where: { option: { room_id: roomId } },
      _count: { _all: true },
    });
    const complete = new Set(
      voteCounts.filter((v) => v._count._all === optionCount).map((v) => `${v.participant_id}:${v.round}`)
    );
    const retiredEvents = await prisma.roomEvent.findMany({
      where: { room_id: roomId, type: { in: ['participant_expelled', 'member_removed'] }, participant_id: { not: null } },
      select: { participant_id: true, round: true },
    });
    const retiredRound = new Map(retiredEvents.map((e) => [e.participant_id!, e.round ?? lastRound]));

    const roundIsOpen = (r: number) => r === room.current_round && !room.reports.some((rep) => rep.round === r)
      && ['ROUND_OPEN', 'INSUFFICIENT_VOTES'].includes(room.status);

    const statesFor = (p: (typeof participants)[number] | undefined, removed: boolean): ParticipationState[] =>
      rounds.map((r) => {
        if (!p) return removed ? 'removed' : 'not_joined';
        if (p.is_retired && r >= (retiredRound.get(p.id) ?? lastRound)) return 'retired';
        if (complete.has(`${p.id}:${r}`)) return 'voted';
        if (r < p.joined_round) return 'not_joined';
        return roundIsOpen(r) ? 'joined' : 'not_voted';
      });

    let rows: ParticipationRow[];
    if (room.access_mode === 'ROSTER') {
      const members = await prisma.roomMember.findMany({
        where: { room_id: roomId },
        select: { id: true, label: true, participant_id: true, is_removed: true },
        orderBy: { label: 'asc' },
      });
      const byId = new Map(participants.map((p) => [p.id, p]));
      rows = members.map((m) => ({
        key: m.id,
        name: m.label,
        states: statesFor(m.participant_id ? byId.get(m.participant_id) : undefined, m.is_removed),
      }));
    } else {
      rows = participants.map((p) => ({ key: p.id, name: p.nickname, states: statesFor(p, false) }));
    }

    return { success: true, data: { rounds, rows } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

