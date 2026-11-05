/**
 * __tests__/integration/expelKeepsVotes.test.ts
 * PT-11: expelling keeps the participant's votes in the database; they do not
 * enter the ranking, τ*, the reasons of the report or the vote count. With
 * fewer than 3 countable ballots the round ends with insufficient votes.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

const state = vi.hoisted(() => ({
  hostId: null as string | null,
  session: null as null | { participantId: string; roomId: string; nickname: string; blindCode: string },
}));

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => state.session,
  createParticipantSession: async () => undefined,
  clearParticipantSession: async () => undefined,
}));
vi.mock('@mic/backend/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

describe.skipIf(!hasTestDb)('PT-11: expulsar conserva los votos (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DB_URL;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  async function voteAs(fx: RoomFixture, i: number, order: number[]) {
    const { submitVote } = await import('@/app/actions/participant');
    state.session = { participantId: fx.participantIds[i], roomId: fx.roomId, nickname: `Persona ${i + 1}`, blindCode: fx.blindCodes[i] };
    const res = await submitVote(
      order.map((optIdx, pos) => ({
        optionId: fx.optionIds[optIdx],
        position: pos + 1,
        justification: `Razón de la persona ${i + 1} con el largo mínimo pedido`,
      }))
    );
    expect(res).toEqual({ success: true });
  }

  it('tras expulsar, los votos siguen en la base y no entran al ranking ni a las razones', async () => {
    const fx = await createRoomFixture(prisma, { participants: 4, room: { tau_threshold: 0.99 } });
    fixtures.push(fx);
    state.hostId = fx.hostId;
    await voteAs(fx, 0, [0, 1, 2]);
    await voteAs(fx, 1, [0, 1, 2]);
    await voteAs(fx, 2, [1, 0, 2]);
    // The expelled participant pushes option 3 to the top
    await voteAs(fx, 3, [2, 1, 0]);

    const room = await import('@/app/actions/room');
    expect((await room.expelParticipant(fx.roomId, fx.participantIds[3])).success).toBe(true);

    expect(await prisma.vote.count({ where: { participant_id: fx.participantIds[3], round: 1 } })).toBe(3);

    const status = await room.getRoomStatus(fx.roomId);
    expect(status.success && status.data?.votesThisRound).toBe(3);

    expect((await room.closeRoundManually(fx.roomId)).success).toBe(true);
    const report = await prisma.roundReport.findUnique({ where: { room_id_round: { room_id: fx.roomId, round: 1 } } });
    expect(report?.effective_voters).toBe(3);

    // Borda without the expelled ballot: option 1 = 2+2+1 = 5, option 2 = 1+1+2 = 4, option 3 = 0
    const ranking = report!.collective_ranking as Array<{ id: string; midRank: number }>;
    expect(ranking.find((r) => r.id === fx.optionIds[2])?.midRank).toBe(3);

    const args = report!.arguments_json as Record<string, Array<{ blindCode: string }>>;
    const codes = new Set(fx.optionIds.flatMap((id) => args[id].map((a) => a.blindCode)));
    expect(codes.has(fx.blindCodes[3])).toBe(false);
    const metrics = (report!.arguments_json as { __metrics: { voters: Array<{ participantId: string }> } }).__metrics;
    expect(metrics.voters.map((v) => v.participantId)).not.toContain(fx.participantIds[3]);
  });

  it('si quedan menos de 3 votos contables, la ronda queda con votos insuficientes', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3 });
    fixtures.push(fx);
    state.hostId = fx.hostId;
    await voteAs(fx, 0, [0, 1, 2]);
    await voteAs(fx, 1, [1, 0, 2]);
    await voteAs(fx, 2, [2, 1, 0]);

    const room = await import('@/app/actions/room');
    await room.expelParticipant(fx.roomId, fx.participantIds[2]);
    const res = await room.closeRoundManually(fx.roomId);
    expect(res.success && res.data?.state).toBe('INSUFFICIENT_VOTES');
    expect(res.success && res.data?.mEfectivo).toBe(2);
    expect(await prisma.vote.count({ where: { participant: { room_id: fx.roomId } } })).toBe(9);
  });
});
