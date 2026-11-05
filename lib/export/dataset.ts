/**
 * lib/export/dataset.ts
 * Loads everything the normalized export needs for one room in one pass.
 * The roster (RoomMember) is never loaded: labels must not reach any export
 * (plan de mejora P3.4).
 */

import type { PrismaClient, Prisma } from '@prisma/client';

export async function loadExportDataset(prisma: PrismaClient, roomId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      pin: true,
      title: true,
      method: true,
      tau_threshold: true,
      max_rounds: true,
      current_round: true,
      status: true,
      deadline: true,
      created_at: true,
      access_mode: true,
      allow_late_join: true,
      consent_required: true,
      consent_version: true,
      close_when_all_voted: true,
      tie_break_rule: true,
      concordance_variant: true,
    },
  });
  if (!room) return null;

  const [options, participants, votes, revisions, reports, voterMetrics, events, consents] = await Promise.all([
    prisma.option.findMany({ where: { room_id: roomId }, select: { id: true, order_index: true }, orderBy: { order_index: 'asc' } }),
    prisma.participant.findMany({
      where: { room_id: roomId },
      select: { id: true, blind_code: true, joined_round: true, is_retired: true, created_at: true },
      orderBy: { blind_code: 'asc' },
    }),
    prisma.vote.findMany({
      where: { option: { room_id: roomId } },
      select: {
        id: true,
        participant_id: true,
        round: true,
        option_id: true,
        position: true,
        justification: true,
        created_at: true,
        reasons: { select: { id: true, side: true, order_index: true, text: true, created_at: true } },
      },
      orderBy: [{ round: 'asc' }, { position: 'asc' }],
    }),
    prisma.voteRevision.groupBy({ by: ['participant_id', 'round'], where: { room_id: roomId }, _max: { version: true } }),
    prisma.roundReport.findMany({ where: { room_id: roomId }, orderBy: { round: 'asc' } }),
    prisma.roundVoterMetric.findMany({ where: { room_id: roomId } }),
    prisma.roomEvent.findMany({ where: { room_id: roomId }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] }),
    prisma.consentRecord.findMany({ where: { room_id: roomId }, select: { participant_id: true, accepted_at: true, text_version: true } }),
  ]);

  return { room, options, participants, votes, revisions, reports, voterMetrics, events, consents };
}

export type ExportDataset = NonNullable<Awaited<ReturnType<typeof loadExportDataset>>>;
export type ExportReport = ExportDataset['reports'][number];
export type ExportEvent = ExportDataset['events'][number];
export type JsonRecord = Record<string, Prisma.JsonValue>;
