/**
 * app/actions/participant.ts
 * Server Actions for participant Zero-PII session lifecycle.
 *
 * - joinRoom: Registers or re-authenticates a participant in a room with Zod validation and lockout.
 * - submitVote: UPSERT ballot (idempotent). Validates strict ordering, justifications 25..200 chars.
 * - logoutParticipant: Clears participant session cookie and allows re-entry.
 */

'use server';

import { createHash } from 'crypto';
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
import { displayOrderFor, displayedPositions } from '@/lib/option-order';
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
    closeWhenAllVoted: boolean;
  };
  options: Array<{
    id: string;
    room_id: string;
    title: string;
    description: string;
    order_index: number;
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

/** Legacy single reason (before PT-13): text only, never who wrote it. */
export interface ParticipantArgumentView {
  justification: string;
}

/**
 * Report shape delivered to participants. Built field by field on the server so
 * that per-voter metrics (`__metrics`, participant ids, other voters' cix) never
 * leave it.
 */
/** A reason as participants see it: text only, not grouped or signed by author. */
export interface ParticipantReasonView {
  text: string;
}

export interface ParticipantOptionReasonsView {
  reasonsFor: ParticipantReasonView[];
  reasonsAgainst: ParticipantReasonView[];
}

export interface ParticipantReportView {
  round: number;
  effective_voters: number;
  obtained_tau: number;
  collective_ranking: ParticipantRankingView[];
  arguments_json: Record<string, ParticipantArgumentView[]>;
  /** PT-19: all reasons for and against per option, verbatim, with blind codes */
  reasonsByOption: Record<string, ParticipantOptionReasonsView>;
  /** PT-19: declared tie-break rule and whether it resolved a tie in this round */
  tieBreak: { rule: string; applied: boolean; fallbackUsed: boolean };
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

/**
 * Order for reasons shown to participants: a hash of the report id and the
 * reason's internal position, so reasons by the same person do not appear
 * together and the order says nothing about authorship or content. Stable for
 * a given report (no reshuffling on every poll).
 */
function mixedOrderKey(reportId: string, ...parts: Array<string | number>): string {
  return createHash('sha256').update([reportId, ...parts].join('|')).digest('hex');
}

function toArgumentsView(
  raw: unknown,
  optionIds: string[],
  reportId: string
): Record<string, ParticipantArgumentView[]> {
  const source = isRecord(raw) ? raw : {};
  const result: Record<string, ParticipantArgumentView[]> = {};
  for (const optionId of optionIds) {
    const list = source[optionId];
    const keyed: Array<{ key: string; view: ParticipantArgumentView }> = [];
    if (Array.isArray(list)) {
      list.forEach((item, i) => {
        if (!isRecord(item)) return;
        const justification =
          typeof item.justification === 'string' ? item.justification : item.justificacion;
        if (typeof justification !== 'string' || justification.length === 0) return;
        keyed.push({ key: mixedOrderKey(reportId, optionId, 'legacy', i), view: { justification } });
      });
    }
    result[optionId] = keyed.sort((a, b) => a.key.localeCompare(b.key)).map((k) => k.view);
  }
  return result;
}

function toReasonsView(
  raw: unknown,
  optionIds: string[],
  reportId: string
): Record<string, ParticipantOptionReasonsView> {
  const source = isRecord(raw) && isRecord(raw.__reasons) ? raw.__reasons : {};
  const pick = (optionId: string, side: string, list: unknown): ParticipantReasonView[] =>
    Array.isArray(list)
      ? list
          .flatMap((r, i) =>
            isRecord(r) && typeof r.text === 'string'
              ? [{ key: mixedOrderKey(reportId, optionId, side, i), view: { text: r.text } }]
              : []
          )
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((k) => k.view)
      : [];
  const result: Record<string, ParticipantOptionReasonsView> = {};
  for (const id of optionIds) {
    const entry = isRecord(source[id]) ? (source[id] as Record<string, unknown>) : {};
    result[id] = { reasonsFor: pick(id, 'for', entry.reasonsFor), reasonsAgainst: pick(id, 'against', entry.reasonsAgainst) };
  }
  return result;
}

function toTieBreakView(raw: unknown): { rule: string; applied: boolean; fallbackUsed: boolean } {
  const tb = isRecord(raw) && isRecord(raw.__tieBreak) ? raw.__tieBreak : {};
  return {
    rule: typeof tb.rule === 'string' ? tb.rule : 'NONE',
    applied: tb.applied === true,
    fallbackUsed: tb.fallbackUsed === true,
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
    id: string;
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
  const args = toArgumentsView(report.arguments_json, optionIds, report.id);
  return {
    round: report.round,
    effective_voters: report.effective_voters,
    obtained_tau: report.obtained_tau,
    collective_ranking: ranking,
    arguments_json: args,
    reasonsByOption: toReasonsView(report.arguments_json, optionIds, report.id),
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
    const roomId = session.roomId;
    const participant = await prisma.participant.findFirst({ where: { id: session.participantId, room_id: roomId } });
    if (!participant) throw Errors.UNAUTHORIZED();
    if (participant.is_retired) throw Errors.RETIRED();
    if (participant.session_version !== (session.sessionVersion ?? 0)) throw Errors.SESSION_EXPIRED();
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
  // P2034: write conflict; P2002: a concurrent ballot of the same participant
  // inserted the same unique row first (two tabs). Both succeed on retry.
  if (err.code === 'P2034' || err.code === 'P2002') return true;
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

/** P2.4: random, non-identifying tag the browser keeps to count retries per device. */
function cleanDeviceTag(tag: unknown): string | null {
  return typeof tag === 'string' && /^[a-f0-9]{12}$/.test(tag) ? tag : null;
}

type JoinFailureReason =
  | 'room_unavailable'
  | 'retired'
  | 'locked_out'
  | 'wrong_pin'
  | 'late_join_closed'
  | 'room_full'
  | 'invalid_code'
  | 'removed_member';

/**
 * P2.4: logs a refused join to an existing room (never the PIN or code typed).
 * The participant is known only when the name matched; otherwise the device tag
 * groups the retries. Logging never changes the answer the person gets.
 */
async function recordJoinFailure(
  room: { id: string; current_round: number },
  reason: JoinFailureReason,
  opts: { participantId?: string | null; deviceTag: string | null; mode: 'pin' | 'roster' }
): Promise<void> {
  try {
    await recordRoomEvent(prisma, {
      roomId: room.id,
      type: 'join_failed',
      actor: 'PARTICIPANT',
      round: room.current_round,
      participantId: opts.participantId ?? null,
      data: { reason, mode: opts.mode, device_tag: opts.deviceTag },
    });
  } catch {
    // the refusal itself is what matters to the person
  }
}

export async function joinRoom(
  roomPin: string,
  nickname: string,
  pin4: string,
  deviceTagInput?: string
): Promise<ActionResult<{ blindCode: string; participantId: string }>> {
  const deviceTag = cleanDeviceTag(deviceTagInput);
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
      include: { participants: { select: { id: true, nickname: true, pin_hash: true, blind_code: true, is_retired: true, session_version: true } } },
    });

    // Unified generic message according to D4 and AGENTS.md (no disclosure of room state).
    // Roster rooms (PT-22) only accept a personal code.
    if (!room || room.status === 'CONCLUDED' || room.status === 'CANCELLED' || room.status === 'DRAFT' || room.access_mode === 'ROSTER') {
      if (room) await recordJoinFailure(room, 'room_unavailable', { deviceTag, mode: 'pin' });
      throw Errors.CANNOT_JOIN();
    }
    const failJoin = async (reason: JoinFailureReason, participantId?: string) =>
      recordJoinFailure(room, reason, { participantId, deviceTag, mode: 'pin' });

    // 4. Check if nickname already exists in this room (re-authentication)
    const existingParticipant = room.participants.find(
      (p) => p.nickname.toLowerCase() === cleanNick.toLowerCase()
    );

    if (existingParticipant?.is_retired) {
      await failJoin('retired', existingParticipant.id);
      throw Errors.CANNOT_JOIN();
    }

    const lockoutKey = `pin:${room.id}:${cleanNick.toLowerCase()}`;

    if (existingParticipant) {
      // Check temporal lockout
      const lockout = checkLockout(lockoutKey);
      if (lockout.isLocked) {
        await failJoin('locked_out', existingParticipant.id);
        throw Errors.LOCKED_OUT(lockout.remainingSec);
      }

      // Re-authentication: verify PIN
      const valid = await verifyParticipantPin(validPin4, existingParticipant.pin_hash);
      if (!valid) {
        const attempt = recordFailedAttempt(lockoutKey, 5, 900);
        await failJoin(attempt.isLocked ? 'locked_out' : 'wrong_pin', existingParticipant.id);
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
        data: { returning: true, device_tag: deviceTag },
      });

      await createParticipantSession({
        participantId: existingParticipant.id,
        sessionVersion: existingParticipant.session_version,
        roomId: room.id,
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
      await failJoin('late_join_closed');
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
        await failJoin('room_full');
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
        data: { returning: false, device_tag: deviceTag },
      });

      return created;
    });

    await createParticipantSession({
      participantId: participant.id,
      sessionVersion: participant.session_version,
      roomId: room.id,
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
  accessCode: string,
  deviceTagInput?: string
): Promise<ActionResult<{ blindCode: string; participantId: string }>> {
  const deviceTag = cleanDeviceTag(deviceTagInput);
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

    let room: Awaited<ReturnType<typeof prisma.room.findUnique>> = null;
    const fail = async (reason?: JoinFailureReason, participantId?: string): Promise<never> => {
      const attempt = recordFailedAttempt(lockoutKey, 30, 900);
      // P2.4: logged only when the room exists; the code typed is never stored
      if (room && reason) {
        await recordJoinFailure(room, attempt.isLocked ? 'locked_out' : reason, { participantId, deviceTag, mode: 'roster' });
      }
      if (attempt.isLocked) throw Errors.LOCKED_OUT(attempt.remainingSec);
      throw new AppError('CANNOT_JOIN', ROSTER_JOIN_ERROR, 400);
    };

    const pinVal = RoomPinSchema.safeParse(roomPin);
    if (pinVal.success) room = await prisma.room.findUnique({ where: { pin: pinVal.data } });
    if (!pinVal.success || !room) await fail();
    if (room!.access_mode !== 'ROSTER' || ['CONCLUDED', 'CANCELLED', 'DRAFT'].includes(room!.status)) {
      await fail('room_unavailable');
    }
    if (typeof accessCode !== 'string' || !isWellFormedMemberCode(accessCode)) await fail('invalid_code');

    const member = await prisma.roomMember.findUnique({
      where: { room_id_access_code_hash: { room_id: room!.id, access_code_hash: hashMemberCode(accessCode) } },
    });
    if (!member) await fail('invalid_code');
    if (member!.is_removed) await fail('removed_member');

    const result = await prisma.$transaction(async (tx) => {
      // Serialize first logins of the same member (two devices at once share one identity)
      await tx.$queryRaw`SELECT "id" FROM "RoomMember" WHERE "id" = ${member!.id} FOR UPDATE`;
      const fresh = await tx.roomMember.findUniqueOrThrow({ where: { id: member!.id } });

      if (fresh.participant_id) {
        const existing = await tx.participant.findUniqueOrThrow({ where: { id: fresh.participant_id } });
        if (existing.is_retired) return { refused: 'retired' as const, participantId: existing.id };
        await recordRoomEvent(tx, {
          roomId: room!.id,
          type: 'participant_joined',
          actor: 'PARTICIPANT',
          round: room!.current_round,
          participantId: existing.id,
          data: { returning: true, roster: true, device_tag: deviceTag },
        });
        return existing;
      }

      // Closed cohort: new identities only in round 1, unless late participants are allowed (PT-23)
      if (room!.current_round > 1 && !room!.allow_late_join) return { refused: 'late_join_closed' as const, participantId: undefined };

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
        data: { returning: false, roster: true, device_tag: deviceTag },
      });
      return created;
    });
    if ('refused' in result) await fail(result.refused, result.participantId);
    const participant = result as Exclude<typeof result, { refused: string }>;

    resetFailedAttempts(lockoutKey);
    await createParticipantSession({
      participantId: participant!.id,
      sessionVersion: participant!.session_version,
      roomId: room!.id,
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
  optionId?: string;
  position?: number;
  justification?: string;
  /** Optional reasons for and against the option (PT-13) */
  reasonsFor?: string[];
  reasonsAgainst?: string[];
}

export async function submitVote(votes: VoteEntry[]): Promise<ActionResult> {
  try {
    const session = await getParticipantSession();
    if (!session) throw Errors.UNAUTHORIZED();

    const targetRoomId = session.roomId;

    // Verify in DB that participant exists and belongs to this room
    const participant = await prisma.participant.findFirst({
      where: { id: session.participantId, room_id: targetRoomId },
    });
    if (!participant) throw Errors.UNAUTHORIZED();
    if (participant.is_retired) throw Errors.RETIRED();
    if (participant.session_version !== (session.sessionVersion ?? 0)) throw Errors.SESSION_EXPIRED();

    const { checkAndProcessExpiredDeadline } = await import('@/lib/round-processor');
    await checkAndProcessExpiredDeadline(targetRoomId);

    // Rate limit per participant
    const rl = checkRateLimit(`vote:${session.participantId}`, 10, 60);
    if (!rl.allowed) throw Errors.RATE_LIMITED(rl.resetIn);

    // Validate each vote entry with Zod and collect parsed items
    const validatedVotes = votes.map((v) => {
      const optId = v.optionId;
      const pos = v.position;
      const just = v.justification;

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

        // The same participant voting from two tabs: their ballots go one after
        // the other (the second waits, then retries on the fresh state)
        await tx.$queryRaw`SELECT "id" FROM "Participant" WHERE "id" = ${session.participantId} FOR UPDATE`;

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

        // P1.4: where each option was first shown to this participant, computed on the server
        const shown = displayedPositions(session.participantId, room.current_round, room.options.map((o) => o.id));
        const createdVotes = await tx.vote.createManyAndReturn({
          data: validatedVotes.map((vote) => ({
            participant_id: session.participantId,
            round: room.current_round,
            option_id: vote.optionId,
            position: vote.position,
            displayed_position: shown.get(vote.optionId) ?? null,
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
          // P2.3: how many reasons were sent (counts only, never the text)
          data: {
            version,
            changed,
            reasons_for: validatedVotes.reduce((n, v) => n + (v.reasonsFor?.length ?? 0), 0),
            reasons_against: validatedVotes.reduce((n, v) => n + (v.reasonsAgainst?.length ?? 0), 0),
          },
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

    const targetRoomId = session.roomId;

    // Verify in DB that participant exists and belongs to this room
    const participant = await prisma.participant.findFirst({
      where: { id: session.participantId, room_id: targetRoomId },
    });
    if (!participant) throw Errors.UNAUTHORIZED();
    if (participant.is_retired) throw Errors.RETIRED();
    if (participant.session_version !== (session.sessionVersion ?? 0)) throw Errors.SESSION_EXPIRED();

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

    // P1.4: each participant sees the options in their own random order for this round
    const shownOrder = displayOrderFor(session.participantId, room.current_round, room.options.map((o) => o.id));
    const optionById = new Map(room.options.map((o) => [o.id, o]));
    const mappedOptions = shownOrder.map((id) => ({ ...optionById.get(id)! }));

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
          closeWhenAllVoted: room.close_when_all_voted,
        },
        options: mappedOptions,
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
