/**
 * lib/round-processor.ts
 * Core consensus processing logic for GDSS r-FAST-CR rounds.
 *
 * Handles:
 *  1. Quorum verification (effective_voters >= MIN_PARTICIPANTS = 3)
 *  2. Loading strict ballots for the current round
 *  3. Dispatching to r-FAST-CR mathematical engine (Borda, Schulze, Kemeny-Young)
 *  4. Computing Stuart Kendall Tau-c CIX and group consensus tau*
 *  5. Generating immutable RoundReport snapshot with blind feedback
 *  6. Transitioning room state (CONCLUDED or ROUND_FEEDBACK or INSUFFICIENT_VOTES)
 */

import { randomInt } from 'crypto';
import prisma from './prisma';
import { runAggregationEngine, Ballot, AggregationMethod, WeakOrder } from './algorithms';
import { RoomStatus, Prisma } from '@prisma/client';
import type { EventActor } from '@prisma/client';
import { recordRoomEvent } from './room-events';
import { MIN_PARTICIPANTS } from './validations';
import type { RankingEntry, BlindArgumentEntry, BlindArgumentsMap, ReportReasonsMap, ReportReasonEntry } from '@/types/report';

export type EstadoSala = RoomStatus;

/**
 * Version of the computation procedure stored in every round report (PT-29).
 * Raise it whenever the computation changes (lib/algorithms, what counts as a
 * ballot, tie-break or concordance handling). __tests__/integration/
 * procedureVersion.test.ts fails if lib/algorithms changes without a new version.
 *   r-fast-cr-1: reports before PT-29 (no __procedure key)
 *   r-fast-cr-2: declared tie-break, concordance variant, expelled ballots excluded
 *   r-fast-cr-3: REASON_BALANCE resolves remaining ties with a seeded random order
 *                (seed stored in __tieBreak.seed) instead of the host's list order
 */
export const PROCEDURE_VERSION = 'r-fast-cr-3';

export type BlindArgumentItem = BlindArgumentEntry;
export type BlindArgumentsByOption = BlindArgumentsMap;
export type BlindArgumentsByProject = BlindArgumentsByOption;

export interface ProcessRoundResult {
  success: boolean;
  quorumMet: boolean;
  state: RoomStatus;
  effectiveVoters?: number;
  mEfectivo?: number;
  tauStar?: number;
  error?: string;
}

/**
 * Processes the consensus for a room whose round has ended.
 * Can be triggered lazily on request, via manual host action, or via background worker.
 */
export interface CountableVote {
  participant_id: string;
  option_id: string;
  position: number;
  participant: { is_retired: boolean };
}

/**
 * Groups a round's votes into complete ballots, leaving out expelled (retired)
 * participants and incomplete ballots. Expelled participants' votes remain in
 * the database but never enter the ranking, τ* or the vote count.
 */
export function buildCountableBallots(votes: CountableVote[], optionCount: number): Map<string, Ballot> {
  const votesByParticipant = new Map<string, CountableVote[]>();
  for (const v of votes) {
    if (v.participant.is_retired) continue;
    const list = votesByParticipant.get(v.participant_id) ?? [];
    list.push(v);
    votesByParticipant.set(v.participant_id, list);
  }

  const completeBallots = new Map<string, Ballot>();
  for (const [partId, pVotes] of votesByParticipant.entries()) {
    if (pVotes.length === optionCount) {
      const ballot: Ballot = new Map();
      for (const v of pVotes) {
        ballot.set(v.option_id, v.position);
      }
      completeBallots.set(partId, ballot);
    }
  }
  return completeBallots;
}

export interface ReasonSourceVote {
  participant_id: string;
  option_id: string;
  position: number;
  reasons: Array<{ side: 'FOR' | 'AGAINST'; text: string; order_index: number }>;
}

/**
 * Collects all reasons of the countable ballots per option and side, verbatim.
 * Sorted by blind code and then by the participant's own order; nothing is
 * summarized, deduplicated or reordered by content.
 */
export function buildReasonsByOption(
  votes: ReasonSourceVote[],
  optionIds: string[],
  countable: Map<string, unknown>,
  blindCodeByParticipant: Map<string, string>
): ReportReasonsMap {
  const result: ReportReasonsMap = {};
  for (const id of optionIds) result[id] = { reasonsFor: [], reasonsAgainst: [] };

  for (const v of votes) {
    if (!countable.has(v.participant_id)) continue;
    const bucket = result[v.option_id];
    if (!bucket) continue;
    const blindCode = blindCodeByParticipant.get(v.participant_id) ?? 'Participante Anónimo';
    for (const r of v.reasons) {
      const entry: ReportReasonEntry = { blindCode, position: v.position, order: r.order_index, text: r.text };
      (r.side === 'FOR' ? bucket.reasonsFor : bucket.reasonsAgainst).push(entry);
    }
  }

  const byCodeThenOrder = (a: ReportReasonEntry, b: ReportReasonEntry) =>
    a.blindCode < b.blindCode ? -1 : a.blindCode > b.blindCode ? 1 : a.order - b.order;
  for (const id of optionIds) {
    result[id].reasonsFor.sort(byCodeThenOrder);
    result[id].reasonsAgainst.sort(byCodeThenOrder);
  }
  return result;
}

/**
 * Reason balance per option for the REASON_BALANCE tie-break: reasons for minus
 * reasons against, every non-empty reason of the round with weight 1.
 */
export function reasonBalanceOf(reasons: ReportReasonsMap): Record<string, number> {
  const balance: Record<string, number> = {};
  for (const [optionId, r] of Object.entries(reasons)) {
    balance[optionId] = r.reasonsFor.length - r.reasonsAgainst.length;
  }
  return balance;
}

export interface ProcessRoundTrigger {
  /** HOST for a manual close; SYSTEM for deadline (lazy check or worker). */
  actor: EventActor;
}

export async function processRoundConsensus(
  roomId: string,
  trigger: ProcessRoundTrigger = { actor: 'SYSTEM' }
): Promise<ProcessRoundResult> {
  // CAS atómico: asegura que solo un ejecutor procesa la ronda
  const casResult = await prisma.room.updateMany({
    where: { id: roomId, status: RoomStatus.ROUND_OPEN },
    data: { status: RoomStatus.PROCESSING },
  });

  if (casResult.count === 0) {
    const currentRoom = await prisma.room.findUnique({
      where: { id: roomId },
      select: { status: true },
    });
    return {
      success: false,
      quorumMet: false,
      state: currentRoom?.status ?? RoomStatus.PROCESSING,
      error: 'La ronda ya no está abierta o ya está siendo procesada',
    };
  }

  try {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        options: { orderBy: { order_index: 'asc' } },
        participants: true,
      },
    });

    if (!room) {
      return { success: false, quorumMet: false, state: RoomStatus.PROCESSING, error: 'Sala no encontrada.' };
    }

    const currentRound = room.current_round;
    const optionIds = room.options.map((p) => p.id);

    // 1. Fetch all votes cast in this round
    const rawVotes = await prisma.vote.findMany({
      where: {
        round: currentRound,
        option: { room_id: roomId },
      },
      include: {
        participant: true,
        option: true,
        reasons: true,
      },
    });

    // A participant is an "effective voter" only if they submitted votes for all
    // options in this round and were not expelled (PT-11: their votes stay stored)
    const completeBallots = buildCountableBallots(rawVotes, optionIds.length);

    const effectiveVoters = completeBallots.size;

    // 2. Quorum verification: minimum 3 participants required by methodology
    const minRequired = MIN_PARTICIPANTS;
    if (effectiveVoters < minRequired) {
      // Quorum guard: transition to INSUFFICIENT_VOTES
      await markInsufficientVotes(roomId, currentRound, effectiveVoters, trigger);

      return {
        success: true,
        quorumMet: false,
        state: RoomStatus.INSUFFICIENT_VOTES,
        effectiveVoters,
        mEfectivo: effectiveVoters,
      };
    }

    // Blind codes and verbatim reasons of the countable ballots (PT-15)
    const participantCodeMap = new Map<string, string>(
      room.participants.map((p) => [p.id, p.blind_code])
    );
    const reasonsByOption = buildReasonsByOption(rawVotes, optionIds, completeBallots, participantCodeMap);

    // 3. Run the algorithmic engine with the room's declared tie-break rule (PT-16)
    const engineOutput = runAggregationEngine({
      optionIds,
      ballots: completeBallots,
      method: room.method as AggregationMethod,
      minMembers: minRequired,
      tauThreshold: room.tau_threshold,
      currentRound,
      maxRounds: room.max_rounds,
      tieBreak: {
        rule: room.tie_break_rule,
        optionOrder: optionIds,
        reasonBalance: room.tie_break_rule === 'REASON_BALANCE' ? reasonBalanceOf(reasonsByOption) : undefined,
        // P0.4: last-resort random order, reproducible from the stored seed
        seed: room.tie_break_rule === 'REASON_BALANCE' ? randomInt(0, 2 ** 32 - 1) : undefined,
      },
      concordanceVariant: room.concordance_variant,
    });

    if (!engineOutput.result) {
      // Fallback if quorum check failed inside engine
      await markInsufficientVotes(roomId, currentRound, effectiveVoters, trigger);
      return {
        success: true,
        quorumMet: false,
        state: RoomStatus.INSUFFICIENT_VOTES,
        effectiveVoters,
        mEfectivo: effectiveVoters,
      };
    }

    const { ranking, tauStar, stuartTauStar, gammaTauStar, voterCIX, tieBreak } = engineOutput.result;

    // 4. Structure blind qualitative justifications by option
    const argumentsByOption: BlindArgumentsByOption = {};

    for (const p of room.options) {
      argumentsByOption[p.id] = [];
    }

    for (const v of rawVotes) {
      // Legacy single-reason list, kept for readers of older reports. Ballots that
      // use the new for/against reasons (PT-13) leave justification null.
      if (completeBallots.has(v.participant_id) && v.justification) {
        const code = participantCodeMap.get(v.participant_id) ?? 'Participante Anónimo';
        argumentsByOption[v.option_id]?.push({
          blindCode: code,
          codigoCiego: code,
          position: v.position,
          posicion: v.position,
          justification: v.justification,
          justificacion: v.justification,
        });
      }
    }

    const rankingJson: Prisma.InputJsonValue = ranking as unknown as Prisma.InputJsonValue;
    // AUD-16 & D1: Persistir métricas de concordancia y análisis de sensibilidad sin alterar argumentos
    const argumentsPayload = {
      ...argumentsByOption,
      __reasons: reasonsByOption,
      // PT-16: which groups were tied and whether the declared rule resolved them
      __tieBreak: tieBreak ?? { rule: 'NONE', applied: false, tiedGroups: [] },
      // PT-17: concordance variant used for tau* (cix = (tau + 1) / 2 in both)
      __concordance: { variant: engineOutput.result.concordanceVariant ?? 'WITH_TIES' },
      // PT-29: configuration and procedure version used to compute this round
      __procedure: {
        version: PROCEDURE_VERSION,
        method: room.method,
        tauThreshold: room.tau_threshold,
        maxRounds: room.max_rounds,
        minParticipants: minRequired,
        tieBreakRule: room.tie_break_rule,
        concordanceVariant: room.concordance_variant,
      },
      __metrics: {
        tauStar,
        stuartTauStar: stuartTauStar ?? tauStar,
        gammaTauStar: gammaTauStar ?? tauStar,
        voters: (voterCIX || []).map((v) => ({
          participantId: v.participantId,
          tauB: v.tauB ?? 0,
          cix: v.cix,
          stuartTauC: v.stuartTauC ?? 0,
          stuartCix: v.stuartCix ?? 0.5,
          gamma: v.gamma ?? 0,
          gammaCix: v.gammaCix ?? 0.5,
        })),
      },
    };
    const argumentsJson: Prisma.InputJsonValue = argumentsPayload as unknown as Prisma.InputJsonValue;

    // 5. Persist immutable RoundReport inside a transaction
    await prisma.$transaction(async (tx) => {
      // Upsert round report
      const savedReport = await tx.roundReport.upsert({
        where: {
          room_id_round: {
            room_id: roomId,
            round: currentRound,
          },
        },
        create: {
          room_id: roomId,
          round: currentRound,
          effective_voters: effectiveVoters,
          collective_ranking: rankingJson,
          obtained_tau: tauStar,
          arguments_json: argumentsJson,
        },
        update: {
          effective_voters: effectiveVoters,
          collective_ranking: rankingJson,
          obtained_tau: tauStar,
          arguments_json: argumentsJson,
        },
      });

      // PT-30: per-voter metrics in their own table (double write with __metrics)
      await tx.roundVoterMetric.deleteMany({ where: { report_id: savedReport.id } });
      if ((voterCIX || []).length > 0) {
        await tx.roundVoterMetric.createMany({
          data: voterCIX.map((v) => ({
            report_id: savedReport.id,
            room_id: roomId,
            round: currentRound,
            participant_id: v.participantId,
            tau_b: v.tauB ?? 0,
            cix: v.cix,
            stuart_tau_c: v.stuartTauC ?? 0,
            stuart_cix: v.stuartCix ?? 0.5,
            gamma: v.gamma ?? 0,
            gamma_cix: v.gammaCix ?? 0.5,
            concordant: v.concordant,
            discordant: v.discordant,
            tied: v.tied ?? 0,
          })),
        });
      }

      // 6. Determine final state transition
      const nextState = engineOutput.shouldConclude ? RoomStatus.CONCLUDED : RoomStatus.ROUND_FEEDBACK;

      await tx.room.update({
        where: { id: roomId },
        data: {
          status: nextState,
          // Clear deadline when entering feedback or conclusion; host will set a new one for round r+1
          deadline: nextState === RoomStatus.ROUND_FEEDBACK ? null : room.deadline,
        },
      });

      await recordRoomEvent(tx, {
        roomId,
        type: 'round_closed',
        actor: trigger.actor,
        round: currentRound,
      });
      await recordRoomEvent(tx, {
        roomId,
        type: 'round_processed',
        actor: 'SYSTEM',
        round: currentRound,
        data: { effectiveVoters, nextStatus: nextState },
      });
    });

    const finalState = engineOutput.shouldConclude ? RoomStatus.CONCLUDED : RoomStatus.ROUND_FEEDBACK;

    return {
      success: true,
      quorumMet: true,
      state: finalState,
      effectiveVoters,
      mEfectivo: effectiveVoters,
      tauStar,
    };
  } catch (err: unknown) {
    // Si falla el procesamiento posterior, restaura el estado apropiadamente a ROUND_OPEN
    try {
      await prisma.room.update({
        where: { id: roomId },
        data: { status: RoomStatus.ROUND_OPEN },
      });
    } catch (restoreErr) {
      console.error('Error al restaurar estado de la sala:', restoreErr);
    }
    const message = err instanceof Error ? err.message : 'Error al procesar el consenso de la ronda';
    return {
      success: false,
      quorumMet: false,
      state: RoomStatus.ROUND_OPEN,
      error: message,
    };
  }
}

async function markInsufficientVotes(
  roomId: string,
  round: number,
  effectiveVoters: number,
  trigger: ProcessRoundTrigger
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.room.update({
      where: { id: roomId },
      data: { status: RoomStatus.INSUFFICIENT_VOTES },
    });
    await recordRoomEvent(tx, { roomId, type: 'round_closed', actor: trigger.actor, round });
    await recordRoomEvent(tx, {
      roomId,
      type: 'insufficient_votes',
      actor: 'SYSTEM',
      round,
      data: { effectiveVoters },
    });
  });
}

/**
 * Lazy deadline check helper: can be called on any incoming room request.
 * If deadline has expired while in ROUND_OPEN, triggers processing automatically.
 */
export async function checkAndProcessExpiredDeadline(roomId: string): Promise<boolean> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { status: true, deadline: true },
  });

  if (!room || room.status !== RoomStatus.ROUND_OPEN || !room.deadline) {
    return false;
  }

  if (new Date() > room.deadline) {
    await processRoundConsensus(roomId);
    return true;
  }

  return false;
}

/**
 * PT-27: in rooms with close_when_all_voted, processes the round as soon as
 * every eligible person has a complete ballot. Eligible:
 *  - roster rooms: listed members not removed, whose participant (if any) is
 *    not retired; members who have not joined yet count as not voted;
 *  - open rooms: participants not retired;
 *  - with the closed cohort, from round 2 on only those who voted in round 1.
 * Requires at least MIN_PARTICIPANTS complete ballots, so an early close never
 * ends in insufficient votes. processRoundConsensus is atomic (CAS), so two
 * simultaneous last ballots process the round once.
 */
export async function closeRoundIfAllVoted(roomId: string): Promise<boolean> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { options: { select: { id: true } } },
  });
  if (!room || !room.close_when_all_voted || room.status !== RoomStatus.ROUND_OPEN) return false;
  if (room.deadline && new Date() > room.deadline) return false; // the deadline path handles it

  const round = room.current_round;
  const optionCount = room.options.length;

  const counts = await prisma.vote.groupBy({
    by: ['participant_id'],
    where: { round, option: { room_id: roomId }, participant: { is_retired: false } },
    _count: { _all: true },
  });
  const completeVoters = new Set(counts.filter((c) => c._count._all === optionCount).map((c) => c.participant_id));
  if (completeVoters.size < MIN_PARTICIPANTS) return false;

  let round1Voters: Set<string> | null = null;
  if (round > 1 && !room.allow_late_join) {
    const r1 = await prisma.vote.findMany({
      where: { round: 1, option: { room_id: roomId } },
      select: { participant_id: true },
      distinct: ['participant_id'],
    });
    round1Voters = new Set(r1.map((v) => v.participant_id));
  }
  const canVote = (participantId: string) => !round1Voters || round1Voters.has(participantId);

  let eligible: Array<string | null>;
  if (room.access_mode === 'ROSTER') {
    const members = await prisma.roomMember.findMany({
      where: { room_id: roomId, is_removed: false },
      select: { participant: { select: { id: true, is_retired: true } } },
    });
    eligible = members
      .filter((m) => !m.participant?.is_retired)
      .map((m) => m.participant?.id ?? null)
      .filter((id) => id === null ? round === 1 || room.allow_late_join : canVote(id));
  } else {
    const participants = await prisma.participant.findMany({
      where: { room_id: roomId, is_retired: false },
      select: { id: true },
    });
    eligible = participants.map((p) => p.id).filter(canVote);
  }

  const allVoted = eligible.length > 0 && eligible.every((id) => id !== null && completeVoters.has(id));
  if (!allVoted) return false;

  const result = await processRoundConsensus(roomId, { actor: 'SYSTEM' });
  return result.success;
}

