/**
 * __tests__/realtime/reportViewedOnce.test.ts
 * PT-12: the first time a participant receives a round report, one
 * "report_viewed" event is logged. Polling (every 5 s) and simultaneous tabs
 * must not create more than one per participant and round.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

const state = vi.hoisted(() => ({
  session: null as null | { participantId: string; roomId: string; nickname: string; blindCode: string },
}));

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => state.session,
  createParticipantSession: async () => undefined,
  clearParticipantSession: async () => undefined,
}));

describe.skipIf(!hasTestDb)('PT-12: informe visto (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, { participants: 3, status: 'ROUND_FEEDBACK' });
    await prisma.roundReport.create({
      data: {
        room_id: fx.roomId,
        round: 1,
        effective_voters: 3,
        obtained_tau: 0.5,
        collective_ranking: fx.optionIds.map((id, i) => ({ id, midRank: i + 1, score: 3 - i })),
        arguments_json: Object.fromEntries(fx.optionIds.map((id) => [id, []])),
      },
    });
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  function as(i: number) {
    state.session = { participantId: fx!.participantIds[i], roomId: fx!.roomId, nickname: `Persona ${i + 1}`, blindCode: fx!.blindCodes[i] };
  }

  async function viewedEvents(participantId: string) {
    return prisma.roomEvent.findMany({ where: { room_id: fx!.roomId, participant_id: participantId, type: 'report_viewed' } });
  }

  it('el sondeo repetido deja un único evento por ronda', async () => {
    const { getParticipantRoomView } = await import('@/app/actions/participant');
    as(0);
    for (let i = 0; i < 5; i++) {
      const res = await getParticipantRoomView();
      expect(res.success && res.data?.latestReport?.round).toBe(1);
    }
    const events = await viewedEvents(fx!.participantIds[0]);
    expect(events.map((e) => [e.round, e.actor])).toEqual([[1, 'PARTICIPANT']]);
  });

  it('consultas simultáneas tampoco duplican el evento', async () => {
    const { getParticipantRoomView } = await import('@/app/actions/participant');
    as(1);
    await Promise.all(Array.from({ length: 8 }, () => getParticipantRoomView()));
    expect(await viewedEvents(fx!.participantIds[1])).toHaveLength(1);
  });

  it('sin informe entregado no hay evento', async () => {
    const { getParticipantRoomView } = await import('@/app/actions/participant');
    await prisma.room.update({ where: { id: fx!.roomId }, data: { status: 'ROUND_OPEN', current_round: 1 } });
    as(2);
    const res = await getParticipantRoomView();
    expect(res.success && res.data?.latestReport).toBeNull();
    expect(await viewedEvents(fx!.participantIds[2])).toHaveLength(0);
  });
});
