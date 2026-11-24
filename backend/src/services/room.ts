/**
 * backend/src/services/room.ts
 * Room lifecycle for the host (create, start, close, extend, cancel, roster, participation).
 * Web-agnostic: the request (IP, sessions, page revalidation) comes as a
 * RequestContext; the frontend exposes these as server actions (frontend/app/actions/room.ts).
 * Services for room lifecycle management.
 *
 * All mutations are atomic and use Prisma transactions where needed.
 * State transitions are validated against the finite state machine.
 */

import type { RequestContext } from './context';
import prisma from '@mic/backend/db';
import { generateRoomPin } from '@mic/backend/pin';
import { isValidTransition, isTerminalState } from '@mic/backend/state-machine';
import { AppError, Errors, toApiError } from '@mic/backend/errors';
import { AggregationMethod, RoomStatus } from '@prisma/client';
import { processRoundConsensus, checkAndProcessExpiredDeadline } from '@mic/backend/round-processor';
import { recordRoomEvent } from '@mic/backend/room-events';
import { generateMemberCode, hashMemberCode, parseRosterText } from '@mic/backend/shared/member-codes';

import {
  CreateRoomSchema,
  ResetPinSchema,
  MIN_PARTICIPANTS,
  RoomSettingsSchema,
  RoomMemberLabelSchema,
  FIXED_TIE_BREAK_RULE,
  FIXED_CONCORDANCE_VARIANT,
  MAX_ROUND_MINUTES,
  type RoomSettingsInput,
} from '@mic/backend/shared/validations';
import type { ActionResult } from '@mic/backend/shared/actions';
import { conclusionReason, type ConclusionReason } from '@mic/backend/conclusion';
import { resolveRoundEnd, type ResolvedRoundEnd, type RoundTiming } from '@mic/backend/shared/round-timing';
import { SCHEDULABLE_STATUSES } from '@mic/backend/round-schedule';
import type { RankingEntry } from '@mic/backend/shared/report';

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
  /** `id` only when editing: keeps that option (and its id) instead of creating a new one */
  options?: { id?: string; title?: string; description?: string }[];
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
  /** Which options were tied before the tie-break and how it was resolved (host only) */
  tieBreak: { rule: string; applied: boolean; tiedGroups: string[][]; fallbackUsed: boolean } | null;
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
  /** Next round scheduled by the host: opens and closes by itself */
  scheduled_open_at: Date | null;
  scheduled_deadline: Date | null;
  created_at: Date;
  updated_at: Date;
  options: Array<{ id: string; room_id: string; title: string; description: string; order_index: number }>;
  participants: MappedParticipantItem[];
  /** Removed participants of rooms that use names, with the name they had (for "Reincorporar") */
  removedParticipants: Array<{ id: string; nickname: string }>;
  reports: MappedReportItem[];
}

export interface RoomStatusData {
  room: MappedRoomDetails;
  votesThisRound: number;
  voterIds: string[];
  isExpired: boolean;
  serverTime: string;
  /** Why the process ended (only when CONCLUDED) */
  conclusion: ConclusionReason | null;
}

// ─────────────────────────────────────────────
// Helpers
/** Same rules for creating a room and for editing it before round 1. */
function validateRoomInput(input: CreateRoomInput) {
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
    const firstError = validation.error.errors[0]?.message || 'Datos de configuración de grupo inválidos.';
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

  return { valid, settings };
}

// ─────────────────────────────────────────────

/** Tie-break summary for the host panel: tied option groups and whether the title decided. */
function hostTieBreakView(raw: unknown): MappedReportItem['tieBreak'] {
  const tb = (raw as { __tieBreak?: Record<string, unknown> } | null)?.__tieBreak;
  if (!tb || typeof tb !== 'object') return null;
  const groups = Array.isArray(tb.tiedGroups) ? (tb.tiedGroups as unknown[]).filter(Array.isArray) as string[][] : [];
  return {
    rule: typeof tb.rule === 'string' ? tb.rule : 'NONE',
    applied: tb.applied === true,
    tiedGroups: groups,
    fallbackUsed: tb.fallbackUsed === true,
  };
}

/** Deadline of a round from minutes or a closing date; a clear message when out of range. */
function roundEndOrThrow(timing: unknown, base: Date, baseLabel: 'ahora' | 'la hora límite actual' = 'ahora'): ResolvedRoundEnd {
  const res = resolveRoundEnd(timing, base, baseLabel);
  if (!res.ok) throw Errors.INVALID_BALLOT(res.error);
  return res.value;
}

async function requireHost(ctx: RequestContext): Promise<string> {
  const hostId = await ctx.hostUserId();
  if (!hostId) throw Errors.UNAUTHORIZED();
  return hostId;
}


// ─────────────────────────────────────────────
// Create Room
// ─────────────────────────────────────────────

export async function createRoom(ctx: RequestContext, input: CreateRoomInput): Promise<ActionResult<{ salaId: string; pin: string }>> {
  try {
    const hostId = await requireHost(ctx);

    const { valid, settings } = validateRoomInput(input);

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
        // E-12: fixed for every new room, never taken from the request
        tie_break_rule: FIXED_TIE_BREAK_RULE,
        concordance_variant: FIXED_CONCORDANCE_VARIANT,
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
// Edit the room before round 1 (DRAFT only)
// ─────────────────────────────────────────────

/**
 * Title, options, method, seats, required agreement, rounds and advanced
 * settings can change until round 1 opens. The access mode cannot: people may
 * already be waiting in the lobby with a name or a personal code.
 * Options sent with their `id` are kept (title, description, order updated);
 * new ones are created and missing ones deleted (no selections exist yet).
 * A changed consent text gets a new version, so whoever accepted the old one
 * accepts it again.
 */
export async function updateRoom(ctx: RequestContext, salaId: string, input: CreateRoomInput): Promise<ActionResult> {
  try {
    const hostId = await requireHost(ctx);
    const { valid, settings } = validateRoomInput(input);

    const room = await prisma.room.findUnique({
      where: { id: salaId },
      include: { options: true, participants: { where: { is_retired: false }, select: { id: true } }, members: { where: { is_removed: false }, select: { id: true } } },
    });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();
    if (room.status !== 'DRAFT') {
      throw new AppError('ROOM_STARTED', 'La configuración solo se puede cambiar antes de abrir la Ronda 1.', 409);
    }
    if (settings.accessMode !== room.access_mode) {
      throw Errors.INVALID_BALLOT('La forma de ingreso no se puede cambiar después de crear el grupo.');
    }
    const seated = room.access_mode === 'ROSTER' ? room.members.length : room.participants.length;
    if (valid.maxMembers < seated) {
      throw Errors.INVALID_BALLOT(
        `Ya hay ${seated} ${room.access_mode === 'ROSTER' ? 'personas en la lista' : 'participantes en la sala de espera'}: el número de participantes no puede ser menor.`
      );
    }

    const existingIds = new Set(room.options.map((o) => o.id));
    const sentIds = (input.options ?? []).map((o) => (typeof o.id === 'string' && existingIds.has(o.id) ? o.id : null));
    const keep = new Set(sentIds.filter((id): id is string => id !== null));
    const consentText = settings.consentRequired ? settings.consentText : null;
    const consentChanged = settings.consentRequired && (!room.consent_required || consentText !== room.consent_text);

    await prisma.$transaction(async (tx) => {
      const locked = await tx.room.updateMany({
        where: { id: salaId, status: 'DRAFT' },
        data: {
          title: valid.title,
          method: valid.method,
          max_members: valid.maxMembers,
          tau_threshold: valid.tauThreshold,
          max_rounds: valid.maxRounds,
          allow_late_join: settings.allowLateJoin,
          close_when_all_voted: settings.closeWhenAllVoted,
          consent_required: settings.consentRequired,
          consent_text: consentText,
          ...(consentChanged ? { consent_version: room.consent_version + 1 } : {}),
        },
      });
      if (locked.count !== 1) {
        throw new AppError('ROOM_STARTED', 'La configuración solo se puede cambiar antes de abrir la Ronda 1.', 409);
      }
      await tx.option.deleteMany({ where: { room_id: salaId, id: { notIn: [...keep] } } });
      // Free the order slots first: (room_id, order_index) is unique
      await tx.option.updateMany({ where: { room_id: salaId }, data: { order_index: { increment: 1000 } } });
      for (let i = 0; i < valid.options.length; i++) {
        const o = valid.options[i];
        const id = sentIds[i];
        if (id) {
          await tx.option.update({ where: { id }, data: { title: o.title, description: o.description || '', order_index: i } });
        } else {
          await tx.option.create({ data: { room_id: salaId, title: o.title, description: o.description || '', order_index: i } });
        }
      }
    });

    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Start Round 1 (DRAFT → ROUND_OPEN)
// ─────────────────────────────────────────────

export async function startRoom(
  ctx: RequestContext,
  salaId: string,
  timing: RoundTiming
): Promise<ActionResult> {
  try {
    // A duration in minutes, or the exact closing date and time
    const end = roundEndOrThrow(timing, new Date());

    const hostId = await requireHost(ctx);
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();
    if (!isValidTransition(room.status, 'ROUND_OPEN')) {
      throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
    }

    const { deadline } = end;
    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: salaId },
        data: { status: 'ROUND_OPEN', deadline, current_round: 1, scheduled_open_at: null, scheduled_deadline: null },
      });
      await recordRoomEvent(tx, {
        roomId: salaId,
        type: 'room_started',
        actor: 'HOST',
        round: 1,
        data: { minutes: end.minutes, timing: end.timing },
      });
    });

    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    ctx.revalidate('/participant/vote');

    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Close Round Manually (host trigger before deadline)
// ─────────────────────────────────────────────

export async function closeRoundManually(ctx: RequestContext, salaId: string): Promise<ActionResult<{ state: string; mEfectivo: number }>> {
  try {
    const hostId = await requireHost(ctx);
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

    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    ctx.revalidate('/participant/vote');

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
  ctx: RequestContext,
  salaId: string,
  timing: RoundTiming
): Promise<ActionResult> {
  try {
    // Shape first (before any database access); the deadline is resolved below
    roundEndOrThrow(timing, new Date());

    const hostId = await requireHost(ctx);
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();

    // Extender el plazo en ROUND_OPEN no es una transición de estado: solo actualiza el plazo
    if (room.status === 'ROUND_OPEN') {
      // A round without deadline gets one from now; "no deadline" removes the current one
      const extendsCurrent = Boolean(room.deadline && room.deadline.getTime() > Date.now());
      const base = extendsCurrent ? room.deadline! : new Date();
      // Minutes are added to the current deadline; a date must come after it
      const end = roundEndOrThrow(timing, base, extendsCurrent ? 'la hora límite actual' : 'ahora');
      const { deadline } = end;
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
          data: { minutes: end.minutes, reopened: false, timing: end.timing },
        });
      });
    } else if (room.status === 'INSUFFICIENT_VOTES') {
      if (!isValidTransition(room.status, 'ROUND_OPEN')) {
        throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
      }
      const end = roundEndOrThrow(timing, new Date());
      const { deadline } = end;
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
          data: { minutes: end.minutes, reopened: true, timing: end.timing },
        });
      });
    } else {
      throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
    }

    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    ctx.revalidate('/participant/vote');

    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Cancel Room (→ CANCELLED)
// ─────────────────────────────────────────────

export async function cancelRoom(ctx: RequestContext, salaId: string): Promise<ActionResult> {
  try {
    const hostId = await requireHost(ctx);
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

    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    ctx.revalidate('/participant/vote');

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
  ctx: RequestContext,
  salaId: string,
  timing: RoundTiming
): Promise<ActionResult> {
  try {
    const end = roundEndOrThrow(timing, new Date());

    const hostId = await requireHost(ctx);
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();
    if (!isValidTransition(room.status, 'ROUND_OPEN')) {
      throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
    }

    const { deadline } = end;
    await prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: salaId },
        data: {
          status: 'ROUND_OPEN',
          deadline,
          current_round: room.current_round + 1,
          // Opening by hand replaces any schedule
          scheduled_open_at: null,
          scheduled_deadline: null,
        },
      });
      await recordRoomEvent(tx, {
        roomId: salaId,
        type: 'round_opened',
        actor: 'HOST',
        round: room.current_round + 1,
        data: { minutes: end.minutes, timing: end.timing },
      });
    });

    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    ctx.revalidate('/participant/vote');

    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Schedule the next round (DRAFT: round 1; ROUND_FEEDBACK: the next one)
// ─────────────────────────────────────────────

const MAX_SCHEDULE_AHEAD_MS = MAX_ROUND_MINUTES * 60 * 1000;

/**
 * The round opens by itself at `opensAt` (lib/round-schedule.ts) and closes
 * after `timing`, counted from `opensAt`. Replaces an earlier schedule.
 */
export async function scheduleRound(
  ctx: RequestContext,
  salaId: string,
  input: { opensAt: unknown; timing: RoundTiming }
): Promise<ActionResult<{ opensAt: string; deadline: string | null }>> {
  try {
    const hostId = await requireHost(ctx);
    const opensAt = typeof input.opensAt === 'string' ? new Date(input.opensAt) : null;
    const now = new Date();
    if (!opensAt || Number.isNaN(opensAt.getTime())) throw Errors.INVALID_BALLOT('Elige la fecha y hora de inicio.');
    if (opensAt.getTime() - now.getTime() < 60 * 1000) {
      throw Errors.INVALID_BALLOT('La hora de inicio tiene que ser al menos un minuto después de ahora.');
    }
    if (opensAt.getTime() - now.getTime() > MAX_SCHEDULE_AHEAD_MS) {
      throw Errors.INVALID_BALLOT('Se puede programar hasta 30 días antes.');
    }
    const res = resolveRoundEnd(input.timing, opensAt, 'la hora de inicio');
    if (!res.ok) throw Errors.INVALID_BALLOT(res.error);
    const { deadline, minutes, timing } = res.value;

    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();
    if (!(SCHEDULABLE_STATUSES as readonly string[]).includes(room.status)) {
      throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
    }
    const round = room.status === 'DRAFT' ? 1 : room.current_round + 1;

    await prisma.$transaction(async (tx) => {
      const updated = await tx.room.updateMany({
        where: { id: salaId, status: room.status },
        data: { scheduled_open_at: opensAt, scheduled_deadline: deadline },
      });
      if (updated.count !== 1) throw Errors.INVALID_STATE(room.status, 'ROUND_OPEN');
      await recordRoomEvent(tx, {
        roomId: salaId,
        type: 'round_scheduled',
        actor: 'HOST',
        round,
        data: { opens_at: opensAt.toISOString(), closes_at: deadline ? deadline.toISOString() : null, minutes, timing },
      });
    });

    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    return { success: true, data: { opensAt: opensAt.toISOString(), deadline: deadline ? deadline.toISOString() : null } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

export async function cancelScheduledRound(ctx: RequestContext, salaId: string): Promise<ActionResult> {
  try {
    const hostId = await requireHost(ctx);
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();
    if (!room.scheduled_open_at) return { success: true };
    await prisma.$transaction(async (tx) => {
      const updated = await tx.room.updateMany({
        where: { id: salaId, scheduled_open_at: room.scheduled_open_at },
        data: { scheduled_open_at: null, scheduled_deadline: null },
      });
      if (updated.count !== 1) return;
      await recordRoomEvent(tx, {
        roomId: salaId,
        type: 'round_schedule_cancelled',
        actor: 'HOST',
        round: room.status === 'DRAFT' ? 1 : room.current_round + 1,
      });
    });
    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

// ─────────────────────────────────────────────
// Get Room Status (for live dashboard polling)
// ─────────────────────────────────────────────

export async function getRoomStatus(ctx: RequestContext, salaId: string): Promise<ActionResult<RoomStatusData>> {
  try {
    const hostId = await requireHost(ctx);

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

    // Roster rooms: no per-person submission state, and no internal nickname
    // (it carries the roster entry id): only counts reach the host
    const isRoster = room.access_mode === 'ROSTER';
    const voterIds = isRoster ? [] : votesThisRound.map((v) => v.participant_id);

    // Map room object to expose both English and legacy fields for compatibility
    // Removed participants of rooms that use names, shown so the host can reinstate them
    const removedParticipants =
      room.access_mode === 'OPEN_PIN'
        ? (
            await prisma.participant.findMany({
              where: { room_id: room.id, is_retired: true },
              select: { id: true, nickname: true, retired_nickname: true },
              orderBy: { created_at: 'asc' },
            })
          ).map((p) => ({ id: p.id, nickname: p.retired_nickname ?? p.nickname }))
        : [];

    const mappedRoom: MappedRoomDetails = {
      ...room,
      participants: isRoster ? room.participants.map((p) => ({ ...p, nickname: '' })) : room.participants,
      removedParticipants,
      // PT-25: the host gets group results only. arguments_json carries per-voter
      // metrics (participant id + cix) and blind-signed reasons; the panel does not
      // use it and it must not let the host link a named person to a cix.
      reports: room.reports.map((r) => ({
        ...r,
        collective_ranking: r.collective_ranking as unknown as RankingEntry[],
        arguments_json: {},
        tieBreak: hostTieBreakView(r.arguments_json),
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
        conclusion: conclusionReason(room.status, room.tau_threshold, room.reports[room.reports.length - 1]),
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
  ctx: RequestContext,
  salaId: string,
  participantId: string,
  newPin: string
): Promise<ActionResult> {
  try {
    const pinVal = ResetPinSchema.safeParse({ newPin });
    if (!pinVal.success) {
      throw Errors.INVALID_BALLOT(pinVal.error.errors[0]?.message || 'El PIN personal debe tener exactamente 4 dígitos.');
    }

    const hostId = await requireHost(ctx);
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();

    // Verify participant belongs strictly to this room (BOLA protection)
    const participant = await prisma.participant.findFirst({
      where: { id: participantId, room_id: salaId },
    });
    if (!participant) throw Errors.PARTICIPANT_NOT_FOUND();

    const { hashParticipantPin } = await import('@mic/backend/pin');
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

    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    ctx.revalidate('/participant/vote');

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
  ctx: RequestContext,
  salaId: string,
  participantId: string
): Promise<ActionResult<{ activeCount: number }>> {
  try {
    const hostId = await requireHost(ctx);
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
          data: {
            is_retired: true,
            // Open PIN rooms: free the name (someone else, e.g. the real person when
            // a troll used it, can join with it). '~' cannot be typed in a name.
            ...(room.access_mode === 'OPEN_PIN' && !targetParticipant.retired_nickname
              ? { retired_nickname: targetParticipant.nickname, nickname: `~${targetParticipant.id}`.slice(0, 30) }
              : {}),
          },
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

    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    ctx.revalidate('/participant/vote');

    return { success: true, data: { activeCount: remainingActive } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

/**
 * Brings back a removed participant (same blind code, same history) in a room
 * that uses names. Only while the activity runs, with a free seat, and if
 * nobody took their name in the meantime. They log in again with their name
 * and their PIN. Their selection of the current round counts again.
 */
export async function reinstateParticipant(
  ctx: RequestContext,
  salaId: string,
  participantId: string
): Promise<ActionResult<{ activeCount: number }>> {
  try {
    const hostId = await requireHost(ctx);
    const room = await prisma.room.findUnique({ where: { id: salaId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (room.host_id !== hostId) throw Errors.UNAUTHORIZED();
    if (isTerminalState(room.status)) {
      throw Errors.INVALID_BALLOT('La actividad ya terminó; no se puede reincorporar a nadie.');
    }
    if (room.access_mode !== 'OPEN_PIN') {
      throw Errors.INVALID_BALLOT('En grupos con lista, vuelve a agregar a la persona desde la lista.');
    }

    await prisma.$transaction(async (tx) => {
      // Serialize with joins and other reinstatements of the room (seats, names)
      await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${salaId} FOR UPDATE`;
      const target = await tx.participant.findFirst({ where: { id: participantId, room_id: salaId } });
      if (!target) throw Errors.PARTICIPANT_NOT_FOUND();
      if (!target.is_retired) return;

      const active = await tx.participant.findMany({
        where: { room_id: salaId, is_retired: false },
        select: { nickname: true },
      });
      if (active.length >= room.max_members) {
        throw Errors.INVALID_BALLOT('No hay cupos libres en el grupo para reincorporar a esta persona.');
      }
      const name = target.retired_nickname ?? target.nickname;
      if (active.some((p) => p.nickname.toLowerCase() === name.toLowerCase())) {
        throw Errors.INVALID_BALLOT(`El nombre ${name} ya lo usa otra persona en el grupo; no se puede reincorporar.`);
      }

      await tx.participant.update({
        where: { id: participantId },
        data: { is_retired: false, nickname: name, retired_nickname: null },
      });
      await recordRoomEvent(tx, {
        roomId: salaId,
        type: 'participant_reinstated',
        actor: 'HOST',
        round: room.current_round,
        participantId,
      });
    });

    const activeCount = await prisma.participant.count({ where: { room_id: salaId, is_retired: false } });
    ctx.revalidate(`/dashboard/grupos/${salaId}`);
    ctx.revalidate('/participant/vote');
    return { success: true, data: { activeCount } };
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

async function requireRosterRoom(ctx: RequestContext, roomId: string) {
  const hostId = await requireHost(ctx);
  const room = await prisma.room.findFirst({ where: { id: roomId, host_id: hostId } });
  if (!room) throw Errors.ROOM_NOT_FOUND();
  if (room.access_mode !== 'ROSTER') {
    throw Errors.INVALID_BALLOT('Este grupo no usa una lista de participantes.');
  }
  if (isTerminalState(room.status)) {
    throw Errors.INVALID_BALLOT('El grupo ya terminó; no se puede cambiar la lista.');
  }
  return room;
}

async function addMembers(ctx: RequestContext, roomId: string, rawLabels: string[]): Promise<IssuedMemberCode[]> {
  const room = await requireRosterRoom(ctx, roomId);

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

export async function addRoomMember(ctx: RequestContext, roomId: string, label: string): Promise<ActionResult<{ issued: IssuedMemberCode[] }>> {
  try {
    const issued = await addMembers(ctx, roomId, [label]);
    return { success: true, data: { issued } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

/** Pasted lines or the text of a CSV file: first field of each line is the label. */
export async function importRoomMembers(ctx: RequestContext, roomId: string, text: string): Promise<ActionResult<{ issued: IssuedMemberCode[] }>> {
  try {
    if (typeof text !== 'string' || text.length > 200_000) {
      throw Errors.INVALID_BALLOT('El texto de la lista no es válido.');
    }
    const issued = await addMembers(ctx, roomId, parseRosterText(text));
    return { success: true, data: { issued } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

export async function getRoomMembers(ctx: RequestContext, roomId: string): Promise<ActionResult<{ members: RoomMemberItem[] }>> {
  try {
    const hostId = await requireHost(ctx);
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
export async function removeRoomMember(ctx: RequestContext, roomId: string, memberId: string): Promise<ActionResult> {
  try {
    const room = await requireRosterRoom(ctx, roomId);
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

export async function regenerateMemberCode(ctx: RequestContext, roomId: string, memberId: string): Promise<ActionResult<{ issued: IssuedMemberCode }>> {
  try {
    const room = await requireRosterRoom(ctx, roomId);
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

export async function getRoomParticipation(ctx: RequestContext, roomId: string): Promise<ActionResult<ParticipationData>> {
  try {
    const hostId = await requireHost(ctx);
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

