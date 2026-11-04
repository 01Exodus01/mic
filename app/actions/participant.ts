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
import { AppError, Errors, toApiError } from '@/lib/errors';
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
import { hashMemberCode, isWellFormedMemberCode } from '@/lib/member-codes';
import type { ParticipantSessionPayload } from '@/lib/participant-session';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

export interface ParticipantRoomViewData {
  sala: {
    id: string;
    title: string;
    status: RoomStatus;
    currentRound: number;
    maxRounds: number;
    deadline: Date | null;
    method: AggregationMethod;
    tauThreshold: number;
    tauUmbral: number;
    closeWhenAllVoted: boolean;
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
    reasonsFor: string[];
    reasonsAgainst: string[];
  }>;
  latestReport: ParticipantReportView | null;
  /** PT-24: informed consent of the room; text only when it is required */
  consent: { required: boolean; accepted: boolean; version: number; text: string | null };
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
export interface ParticipantReasonView {
  blindCode: string;
  position: number;
  text: string;
}

export interface ParticipantOptionReasonsView {
  reasonsFor: ParticipantReasonView[];
  reasonsAgainst: ParticipantReasonView[];
}

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
  /** PT-19: all reasons for and against per option, verbatim, with blind codes */
  reasonsByOption: Record<string, ParticipantOptionReasonsView>;
  /** PT-19: declared tie-break rule and whether it resolved a tie in this round */
  tieBreak: { rule: string; applied: boolean };
  /** PT-19: only the requesting participant's own concordance, never others' */
  myConcordance: { voted: boolean; cix: number | null };
  /** PT-19: positions this participant gave in the report's round */
  myPositions: Record<string, number>;
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

function toReasonsView(raw: unknown, optionIds: string[]): Record<string, ParticipantOptionReasonsView> {
  const source = isRecord(raw) && isRecord(raw.__reasons) ? raw.__reasons : {};
  const pick = (list: unknown): ParticipantReasonView[] =>
    Array.isArray(list)
      ? list.flatMap((r) =>
          isRecord(r) && typeof r.blindCode === 'string' && typeof r.position === 'number' && typeof r.text === 'string'
            ? [{ blindCode: r.blindCode, position: r.position, text: r.text }]
            : []
        )
      : [];
  const result: Record<string, ParticipantOptionReasonsView> = {};
  for (const id of optionIds) {
    const entry = isRecord(source[id]) ? (source[id] as Record<string, unknown>) : {};
    result[id] = { reasonsFor: pick(entry.reasonsFor), reasonsAgainst: pick(entry.reasonsAgainst) };
  }
  return result;
}

function toTieBreakView(raw: unknown): { rule: string; applied: boolean } {
  const tb = isRecord(raw) && isRecord(raw.__tieBreak) ? raw.__tieBreak : {};
  return {
    rule: typeof tb.rule === 'string' ? tb.rule : 'NONE',
    applied: tb.applied === true,
  };
}

/** Reads only the requesting participant's cix from the stored per-voter metrics. */
function toOwnConcordance(raw: unknown, participantId: string): { voted: boolean; cix: number | null } {
  const metrics = isRecord(raw) && isRecord(raw.__metrics) ? raw.__metrics : {};
  const voters = Array.isArray(metrics.voters) ? metrics.voters : [];
  const own = voters.find((v) => isRecord(v) && v.participantId === participantId);
  if (!isRecord(own) || typeof own.cix !== 'number') return { voted: false, cix: null };
  return { voted: true, cix: own.cix };
}

function toParticipantReportView(
  report: {
    round: number;
    effective_voters: number;
    obtained_tau: number;
    collective_ranking: unknown;
    arguments_json: unknown;
  },
  optionIds: string[],
  participantId: string,
  myPositions: Record<string, number>
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
    reasonsByOption: toReasonsView(report.arguments_json, optionIds),
    tieBreak: toTieBreakView(report.arguments_json),
    myConcordance: toOwnConcordance(report.arguments_json, participantId),
    myPositions,
  };
}

async function hasAcceptedConsent(participantId: string, version: number): Promise<boolean> {
  const record = await prisma.consentRecord.findUnique({
    where: { participant_id_text_version: { participant_id: participantId, text_version: version } },
    select: { id: true },
  });
  return record !== null;
}

/**
 * PT-24: records that the participant accepted the room's consent text
 * (current version), with time. Idempotent.
 */
export async function acceptConsent(): Promise<ActionResult> {
  try {
    const session = await getParticipantSession();
    if (!session) throw Errors.UNAUTHORIZED();
    const roomId = session.roomId || session.salaId!;
    const participant = await prisma.participant.findFirst({ where: { id: session.participantId, room_id: roomId } });
    if (!participant || participant.is_retired) throw Errors.UNAUTHORIZED();
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw Errors.ROOM_NOT_FOUND();
    if (!room.consent_required) return { success: true };

    await prisma.$transaction(async (tx) => {
      const existing = await tx.consentRecord.findUnique({
        where: { participant_id_text_version: { participant_id: participant.id, text_version: room.consent_version } },
      });
      if (existing) return;
      await tx.consentRecord.create({
        data: { participant_id: participant.id, room_id: room.id, text_version: room.consent_version },
      });
      await recordRoomEvent(tx, {
        roomId: room.id,
        type: 'consent_accepted',
        actor: 'PARTICIPANT',
        round: room.current_round,
        participantId: participant.id,
        data: { version: room.consent_version },
      });
    });
    return { success: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { success: true };
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

/**
 * PT-12: logs the first time a participant receives the report of a round.
 * Polling calls this every few seconds, so the check and the insert run under a
 * transaction-level advisory lock per participant and round.
 */
async function recordReportViewedOnce(roomId: string, participantId: string, round: number): Promise<void> {
  const already = await prisma.roomEvent.findFirst({
    where: { room_id: roomId, participant_id: participantId, type: 'report_viewed', round },
    select: { id: true },
  });
  if (already) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report_viewed:${participantId}:${round}`}))`;
    const existing = await tx.roomEvent.findFirst({
      where: { room_id: roomId, participant_id: participantId, type: 'report_viewed', round },
      select: { id: true },
    });
    if (existing) return;
    await recordRoomEvent(tx, {
      roomId,
      type: 'report_viewed',
      actor: 'PARTICIPANT',
      round,
      participantId,
    });
  });
}

function isSerializationConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2034') return true;
  // Raw queries report PostgreSQL serialization_failure (40001) as P2010
  const meta = err.meta as { code?: string } | undefined;
  return err.code === 'P2010' && (meta?.code === '40001' || /could not serialize/i.test(err.message));
}

const SERIALIZABLE_MAX_ATTEMPTS = 20;

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
      const pauseMs = Math.floor(Math.random() * 40 * Math.min(attempt, 8)) + 10;
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
}

// ─────────────────────────────────────────────
// Verify Room PIN (Anti-enumeration & Rate limited)
// ─────────────────────────────────────────────

export async function verifyRoomPin(
  roomPin: string
): Promise<ActionResult<{ pin: string; title: string; accessMode: 'OPEN_PIN' | 'ROSTER' }>> {
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
      select: { pin: true, title: true, status: true, access_mode: true },
    });

    // Unified message: does not disclose whether room exists or is in an invalid state
    if (!room || room.status === 'CONCLUDED' || room.status === 'CANCELLED' || room.status === 'DRAFT') {
      return { success: false, error: 'No se puede ingresar a esa sala. Revisa el PIN.' };
    }

    return { success: true, data: { pin: room.pin, title: room.title, accessMode: room.access_mode } };
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

    // Roster rooms (PT-22) do not use names: same generic message
    if (!room || room.status === 'CONCLUDED' || room.status === 'CANCELLED' || room.status === 'DRAFT' || room.access_mode === 'ROSTER') {
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

    // Unified generic message according to D4 and AGENTS.md (no disclosure of room state).
    // Roster rooms (PT-22) only accept a personal code.
    if (!room || room.status === 'CONCLUDED' || room.status === 'CANCELLED' || room.status === 'DRAFT' || room.access_mode === 'ROSTER') {
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

    // 5. New registration. Closed cohort by default: only in round 1, unless
    // the room allows late participants (PT-23)
    if (room.current_round > 1 && !room.allow_late_join) {
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
          joined_round: room.current_round,
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
// Join a roster room with a personal code (PT-22)
// ─────────────────────────────────────────────

const ROSTER_JOIN_ERROR = 'No se puede ingresar a esa sala. Revisa el PIN y tu código.';

/**
 * Roster rooms: room PIN + personal code, no name or 4-digit PIN. The first
 * time a code is used a participant with a random blind code is created and
 * linked to the member; later the same code resumes that identity (from any
 * device). Every failure returns the same message and counts toward a lockout.
 */
export async function joinRoomWithCode(
  roomPin: string,
  accessCode: string
): Promise<ActionResult<{ blindCode: string; participantId: string }>> {
  try {
    const hdrs = await headers();
    const ip = getClientIp(hdrs);
    // A whole class often shares one public IP: limits are generous, and a
    // 10-character random code (~2^50) makes guessing infeasible anyway.
    const rl = checkRateLimit(`join_code:${ip}`, 60, 60);
    if (!rl.allowed) throw Errors.RATE_LIMITED(rl.resetIn);

    const lockoutKey = `join_code_fail:${ip}:${String(roomPin).toUpperCase().slice(0, 6)}`;
    const lockout = checkLockout(lockoutKey);
    if (lockout.isLocked) throw Errors.LOCKED_OUT(lockout.remainingSec);

    const fail = (): never => {
      const attempt = recordFailedAttempt(lockoutKey, 30, 900);
      if (attempt.isLocked) throw Errors.LOCKED_OUT(attempt.remainingSec);
      throw new AppError('CANNOT_JOIN', ROSTER_JOIN_ERROR, 400);
    };

    const pinVal = RoomPinSchema.safeParse(roomPin);
    if (!pinVal.success || typeof accessCode !== 'string' || !isWellFormedMemberCode(accessCode)) fail();

    const room = await prisma.room.findUnique({ where: { pin: pinVal.data! } });
    if (!room || room.access_mode !== 'ROSTER' || ['CONCLUDED', 'CANCELLED', 'DRAFT'].includes(room.status)) fail();

    const member = await prisma.roomMember.findUnique({
      where: { room_id_access_code_hash: { room_id: room!.id, access_code_hash: hashMemberCode(accessCode) } },
    });
    if (!member || member.is_removed) fail();

    const participant = await prisma.$transaction(async (tx) => {
      // Serialize first logins of the same member (two devices at once share one identity)
      await tx.$queryRaw`SELECT "id" FROM "RoomMember" WHERE "id" = ${member!.id} FOR UPDATE`;
      const fresh = await tx.roomMember.findUniqueOrThrow({ where: { id: member!.id } });

      if (fresh.participant_id) {
        const existing = await tx.participant.findUniqueOrThrow({ where: { id: fresh.participant_id } });
        if (existing.is_retired) return null;
        await recordRoomEvent(tx, {
          roomId: room!.id,
          type: 'participant_joined',
          actor: 'PARTICIPANT',
          round: room!.current_round,
          participantId: existing.id,
          data: { returning: true, roster: true },
        });
        return existing;
      }

      // Closed cohort: new identities only in round 1, unless late participants are allowed (PT-23)
      if (room!.current_round > 1 && !room!.allow_late_join) return null;

      const taken = await tx.participant.findMany({ where: { room_id: room!.id }, select: { blind_code: true } });
      const { generateRandomBlindCode } = await import('@/lib/pin');
      const created = await tx.participant.create({
        data: {
          room_id: room!.id,
          // Internal, never typed or shown: roster participants have no name
          nickname: `m-${member!.id}`.slice(0, 30),
          pin_hash: '!roster-code',
          blind_code: generateRandomBlindCode(taken.map((t) => t.blind_code), room!.max_members),
          joined_round: room!.current_round,
        },
      });
      await tx.roomMember.update({ where: { id: member!.id }, data: { participant_id: created.id } });
      await recordRoomEvent(tx, {
        roomId: room!.id,
        type: 'participant_joined',
        actor: 'PARTICIPANT',
        round: room!.current_round,
        participantId: created.id,
        data: { returning: false, roster: true },
      });
      return created;
    });
    if (!participant) fail();

    resetFailedAttempts(lockoutKey);
    await createParticipantSession({
      participantId: participant!.id,
      roomId: room!.id,
      salaId: room!.id,
      // The session shows the blind code; the roster label never leaves RoomMember
      nickname: participant!.blind_code,
      blindCode: participant!.blind_code,
    });

    return { success: true, data: { blindCode: participant!.blind_code, participantId: participant!.id } };
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
  /** Optional reasons for and against the option (PT-13) */
  reasonsFor?: string[];
  reasonsAgainst?: string[];
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
        reasonsFor: v.reasonsFor,
        reasonsAgainst: v.reasonsAgainst,
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

        // Bloqueo compartido de la fila de la sala: los votantes no chocan entre sí,
        // y el cierre de ronda (CAS con UPDATE) espera a que terminen los votos en curso.
        // Si el cierre ya ocurrió, Serializable aborta y el reintento ve la sala cerrada.
        const locked = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT "status" FROM "Room" WHERE "id" = ${targetRoomId} FOR SHARE
        `;
        if (locked[0]?.status !== 'ROUND_OPEN') throw Errors.ROOM_CLOSED();

        const n = room.options.length;
        const optionIds = new Set(room.options.map((p) => p.id));

        // Ballot count validation
        if (validatedVotes.length !== n) {
          throw Errors.INVALID_BALLOT(`La boleta debe contener exactamente ${n} opciones.`);
        }

        if (!positions.every((p) => p >= 1 && p <= n)) {
          throw Errors.INVALID_BALLOT(`Las posiciones deben estar en el rango [1, ${n}].`);
        }

        // PT-24: the server, not only the screen, requires the consent when the room asks for it
        if (room.consent_required) {
          const accepted = await tx.consentRecord.findUnique({
            where: { participant_id_text_version: { participant_id: session.participantId, text_version: room.consent_version } },
            select: { id: true },
          });
          if (!accepted) throw Errors.CONSENT_REQUIRED();
        }

        // Cohorte cerrada check for rounds > 1 (skipped when late participants are allowed, PT-23)
        if (room.current_round > 1 && !room.allow_late_join) {
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

        const createdVotes = await tx.vote.createManyAndReturn({
          data: validatedVotes.map((vote) => ({
            participant_id: session.participantId,
            round: room.current_round,
            option_id: vote.optionId,
            position: vote.position,
            justification: vote.justification,
          })),
          select: { id: true, option_id: true },
        });

        // PT-13: one VoteReason row per non-empty reason, recreated with the votes
        const voteIdByOption = new Map(createdVotes.map((cv) => [cv.option_id, cv.id]));
        const reasonRows = validatedVotes.flatMap((vote) => {
          const voteId = voteIdByOption.get(vote.optionId)!;
          return [
            ...vote.reasonsFor.map((text, i) => ({ vote_id: voteId, side: 'FOR' as const, text, order_index: i })),
            ...vote.reasonsAgainst.map((text, i) => ({ vote_id: voteId, side: 'AGAINST' as const, text, order_index: i })),
          ];
        });
        if (reasonRows.length > 0) {
          await tx.voteReason.createMany({ data: reasonRows });
        }

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

    // PT-27: after the ballot is committed, close the round if everybody voted
    const { closeRoundIfAllVoted } = await import('@/lib/round-processor');
    await closeRoundIfAllVoted(targetRoomId);

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
      include: { reasons: { orderBy: [{ side: 'asc' }, { order_index: 'asc' }] } },
    });

    // Map votes to support both field naming styles
    const mappedVotes = myVotes.map(({ reasons, ...v }) => ({
      ...v,
      justification: v.justification ?? '',
      proyecto_id: v.option_id,
      posicion: v.position,
      justificacion: v.justification ?? '',
      reasonsFor: reasons.filter((r) => r.side === 'FOR').map((r) => r.text),
      reasonsAgainst: reasons.filter((r) => r.side === 'AGAINST').map((r) => r.text),
    }));

    // Get latest report for feedback. PT-20: while round r > 1 is open, the
    // report of round r - 1 stays available on the vote screen.
    const latestReport =
      room.status === 'ROUND_FEEDBACK' || room.status === 'CONCLUDED'
        ? room.reports[room.reports.length - 1] ?? null
        : room.status === 'ROUND_OPEN' && room.current_round > 1
          ? room.reports.find((r) => r.round === room.current_round - 1) ?? null
          : null;

    const reportVotes = latestReport
      ? latestReport.round === room.current_round
        ? myVotes
        : await prisma.vote.findMany({
            where: { participant_id: session.participantId, round: latestReport.round },
          })
      : [];
    const myPositions = Object.fromEntries(reportVotes.map((v) => [v.option_id, v.position]));

    const mappedReport = latestReport
      ? toParticipantReportView(
          latestReport,
          room.options.map((o) => o.id),
          session.participantId,
          myPositions
        )
      : null;

    // PT-30: own cix from RoundVoterMetric when the report has rows there
    if (mappedReport && latestReport) {
      const ownMetric = await prisma.roundVoterMetric.findUnique({
        where: { report_id_participant_id: { report_id: latestReport.id, participant_id: session.participantId } },
        select: { cix: true },
      });
      if (ownMetric) mappedReport.myConcordance = { voted: true, cix: ownMetric.cix };
    }

    if (latestReport) {
      await recordReportViewedOnce(room.id, session.participantId, latestReport.round);
    }

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
          status: room.status,
          currentRound: room.current_round,
          maxRounds: room.max_rounds,
          deadline: room.deadline,
          method: room.method,
          tauThreshold: room.tau_threshold,
          tauUmbral: room.tau_threshold,
          closeWhenAllVoted: room.close_when_all_voted,
        },
        options: mappedOptions,
        proyectos: mappedOptions,
        session,
        myVotes: mappedVotes,
        latestReport: mappedReport,
        consent: {
          required: room.consent_required,
          accepted: !room.consent_required || (await hasAcceptedConsent(session.participantId, room.consent_version)),
          version: room.consent_version,
          text: room.consent_required ? room.consent_text : null,
        },
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
