/**
 * backend/src/services/moderation.ts
 * Host moderation of reasons (team request 2026-11-24). The host reads the
 * reasons of a round without their authors and hides the inappropriate ones;
 * hidden reasons leave the participants' feedback and only their author is
 * told. The selection keeps counting. Web adapter: frontend/app/actions/moderation.ts.
 */

import type { RequestContext } from './context';
import prisma from '@mic/backend/db';
import { Errors, toApiError } from '@mic/backend/errors';
import { recordRoomEvent } from '@mic/backend/room-events';
import { moderatedKeys, moderationKey } from '@mic/backend/reason-moderation';
import type { ActionResult } from '@mic/backend/shared/actions';

export interface ModerationReasonItem {
  /** Opaque reference to the reason (never the author) */
  id: string;
  side: 'FOR' | 'AGAINST';
  text: string;
  hidden: boolean;
}

export interface ModerationOptionItem {
  id: string;
  title: string;
  reasons: ModerationReasonItem[];
}

export interface ModerationData {
  /** Rounds whose reasons can be moderated (the open one and those with a report) */
  rounds: number[];
  round: number | null;
  options: ModerationOptionItem[];
  hiddenCount: number;
}

async function requireOwnedRoom(ctx: RequestContext, roomId: string) {
  const hostId = await ctx.hostUserId();
  if (!hostId) throw Errors.UNAUTHORIZED();
  const room = await prisma.room.findFirst({
    where: { id: roomId, host_id: hostId },
    include: {
      options: { orderBy: { order_index: 'asc' }, select: { id: true, title: true } },
      reports: { select: { round: true, arguments_json: true } },
    },
  });
  if (!room) throw Errors.ROOM_NOT_FOUND();
  return room;
}

/** Round whose ballots are still open to changes (its reasons are listed live). */
function liveRound(room: { status: string; current_round: number; reports: Array<{ round: number }> }): number | null {
  if (!['ROUND_OPEN', 'INSUFFICIENT_VOTES', 'PROCESSING'].includes(room.status)) return null;
  return room.reports.some((r) => r.round === room.current_round) ? null : room.current_round;
}

/** Participants whose reasons a round shows: the counted ones of its report, or everyone still in for a live round. */
function countedIn(report: { arguments_json: unknown } | undefined): Set<string> | null {
  if (!report) return null;
  const json = report.arguments_json as { __metrics?: { voters?: Array<{ participantId?: string }> } } | null;
  return new Set((json?.__metrics?.voters ?? []).map((v) => v.participantId ?? ''));
}

export async function getReasonsForModeration(ctx: RequestContext, roomId: string, round?: number): Promise<ActionResult<ModerationData>> {
  try {
    const room = await requireOwnedRoom(ctx, roomId);
    const live = liveRound(room);
    const rounds = [...new Set([...room.reports.map((r) => r.round), ...(live ? [live] : [])])].sort((a, b) => a - b);
    const chosen = round && rounds.includes(round) ? round : rounds[rounds.length - 1] ?? null;
    if (chosen === null) return { success: true, data: { rounds, round: null, options: [], hiddenCount: 0 } };

    const counted = countedIn(room.reports.find((r) => r.round === chosen));
    const votes = await prisma.vote.findMany({
      where: { round: chosen, option: { room_id: roomId }, ...(counted ? {} : { participant: { is_retired: false } }) },
      select: { participant_id: true, option_id: true, reasons: { select: { id: true, side: true, text: true } } },
    });
    const hidden = await moderatedKeys(roomId, chosen);
    const byOption = new Map<string, ModerationReasonItem[]>(room.options.map((o) => [o.id, []]));
    let hiddenCount = 0;
    for (const v of votes) {
      if (counted && !counted.has(v.participant_id)) continue;
      for (const r of v.reasons) {
        if (!r.text.trim()) continue;
        const isHidden = hidden.has(moderationKey(v.participant_id, v.option_id, r.side, r.text));
        if (isHidden) hiddenCount++;
        byOption.get(v.option_id)?.push({ id: r.id, side: r.side, text: r.text, hidden: isHidden });
      }
    }
    // Sorted by side and text: the order says nothing about who wrote what or when
    const options = room.options.map((o) => ({
      id: o.id,
      title: o.title,
      reasons: (byOption.get(o.id) ?? []).sort((a, b) => a.side.localeCompare(b.side) || a.text.localeCompare(b.text, 'es')),
    }));
    return { success: true, data: { rounds, round: chosen, options, hiddenCount } };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}

/** Hides a reason (hidden = true) or shows it again. */
export async function setReasonHidden(ctx: RequestContext, roomId: string, reasonId: string, hidden: boolean): Promise<ActionResult> {
  try {
    await requireOwnedRoom(ctx, roomId);
    const reason = await prisma.voteReason.findUnique({
      where: { id: reasonId },
      select: { side: true, text: true, vote: { select: { round: true, participant_id: true, option_id: true, option: { select: { room_id: true } } } } },
    });
    if (!reason || reason.vote.option.room_id !== roomId) throw Errors.INVALID_BALLOT('No se encontró esa razón.');
    const key = {
      room_id: roomId,
      round: reason.vote.round,
      participant_id: reason.vote.participant_id,
      option_id: reason.vote.option_id,
      side: reason.side,
      text: reason.text,
    };
    await prisma.$transaction(async (tx) => {
      if (hidden) {
        await tx.reasonModeration.upsert({
          where: { room_id_round_participant_id_option_id_side_text: key },
          create: key,
          update: {},
        });
      } else {
        await tx.reasonModeration.deleteMany({ where: key });
      }
      // The log never holds reason text (ballot content)
      await recordRoomEvent(tx, {
        roomId,
        type: hidden ? 'reason_hidden' : 'reason_shown',
        actor: 'HOST',
        round: key.round,
        participantId: key.participant_id,
        data: { option_id: key.option_id, side: key.side },
      });
    });
    ctx.revalidate(`/dashboard/grupos/${roomId}`);
    return { success: true };
  } catch (err) {
    const e = toApiError(err);
    return { success: false, error: e.error, code: e.code };
  }
}
