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

import prisma from './prisma';
import { runAggregationEngine, Ballot, AggregationMethod, WeakOrder } from './algorithms';
import { RoomStatus, Prisma } from '@prisma/client';
import type { EventActor } from '@prisma/client';
import { recordRoomEvent } from './room-events';
import { MIN_PARTICIPANTS } from './validations';
import type { RankingEntry, BlindArgumentEntry, BlindArgumentsMap } from '@/types/report';

export type EstadoSala = RoomStatus;

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

    // 3. Run the algorithmic engine
    const engineOutput = runAggregationEngine({
      optionIds,
      ballots: completeBallots,
      method: room.method as AggregationMethod,
      minMembers: minRequired,
      tauThreshold: room.tau_threshold,
      currentRound,
      maxRounds: room.max_rounds,
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

    const { ranking, tauStar, stuartTauStar, gammaTauStar, voterCIX } = engineOutput.result;

    // 4. Structure blind qualitative justifications by option
    const participantCodeMap = new Map<string, string>(
      room.participants.map((p) => [p.id, p.blind_code])
    );

    const argumentsByOption: BlindArgumentsByOption = {};

    for (const p of room.options) {
      argumentsByOption[p.id] = [];
    }

    for (const v of rawVotes) {
      if (completeBallots.has(v.participant_id)) {
        const code = participantCodeMap.get(v.participant_id) ?? 'Participante Anónimo';
        argumentsByOption[v.option_id]?.push({
          blindCode: code,
          codigoCiego: code,
          position: v.position,
          posicion: v.position,
          justification: v.justification ?? '',
          justificacion: v.justification ?? '',
        });
      }
    }

    const rankingJson: Prisma.InputJsonValue = ranking as unknown as Prisma.InputJsonValue;
    // AUD-16 & D1: Persistir métricas de concordancia y análisis de sensibilidad sin alterar argumentos
    const argumentsPayload = {
      ...argumentsByOption,
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
      await tx.roundReport.upsert({
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
