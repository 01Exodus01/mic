/**
 * __tests__/concurrency/concurrentVoters.test.ts
 * Simultaneous ballots against a real PostgreSQL database.
 *  - 40 participants voting at the same time are all saved (write conflicts
 *    P2034 are retried instead of being reported as "room closed").
 *  - Closing the round while ballots arrive: every accepted ballot is in the
 *    report of its round, and the round is processed once.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

type Session = { participantId: string; roomId: string; nickname: string; blindCode: string };
const holder = vi.hoisted(() => ({ store: null as null | { getStore: () => unknown } }));
const sessionStore = new AsyncLocalStorage<Session>();
holder.store = sessionStore;

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => holder.store?.getStore() ?? null,
  createParticipantSession: async () => undefined,
  clearParticipantSession: async () => undefined,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

describe.skipIf(!hasTestDb)('Votos simultáneos (PostgreSQL)', () => {
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

  async function voteAll(fx: RoomFixture) {
    const { submitVote } = await import('@/app/actions/participant');
    return Promise.all(
      fx.participantIds.map((participantId, i) =>
        sessionStore.run({ participantId, roomId: fx.roomId, nickname: `Persona ${i + 1}`, blindCode: fx.blindCodes[i] }, () =>
          submitVote(
            fx.optionIds.map((optionId, k) => ({
              optionId,
              position: ((k + i) % fx.optionIds.length) + 1,
              justification: 'Razón con el largo mínimo que pide la validación',
            }))
          )
        )
      )
    );
  }

  it('40 participantes votan a la vez y todos los votos se guardan', async () => {
    const fx = await createRoomFixture(prisma, { participants: 40, room: { max_members: 40 } });
    fixtures.push(fx);
    const results = await voteAll(fx);
    expect(results.filter((r) => !r.success)).toEqual([]);
    const voters = await prisma.vote.groupBy({ by: ['participant_id'], where: { option: { room_id: fx.roomId }, round: 1 } });
    expect(voters).toHaveLength(40);
  }, 60000);

  it('cerrar la ronda mientras llegan votos no deja votos aceptados fuera del informe', async () => {
    const fx = await createRoomFixture(prisma, { participants: 30, room: { max_members: 40 } });
    fixtures.push(fx);
    const { processRoundConsensus } = await import('@/lib/round-processor');

    const votesPromise = voteAll(fx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const [results, close1, close2] = await Promise.all([
      votesPromise,
      processRoundConsensus(fx.roomId),
      processRoundConsensus(fx.roomId),
    ]);

    // Exactly one executor processes the round
    expect([close1.success, close2.success].filter(Boolean)).toHaveLength(1);

    const accepted = results.filter((r) => r.success).length;
    const rejected = results.filter((r) => !r.success);
    expect(rejected.every((r) => r.code === 'ROOM_CLOSED')).toBe(true);

    const room = await prisma.room.findUnique({ where: { id: fx.roomId } });
    if (accepted >= 3) {
      const report = await prisma.roundReport.findUnique({ where: { room_id_round: { room_id: fx.roomId, round: 1 } } });
      expect(report?.effective_voters).toBe(accepted);
    } else {
      expect(room?.status).toBe('INSUFFICIENT_VOTES');
    }
    const stored = await prisma.vote.groupBy({ by: ['participant_id'], where: { option: { room_id: fx.roomId }, round: 1 } });
    expect(stored).toHaveLength(accepted);
  }, 60000);
  it('el mismo participante enviando desde varias pestañas a la vez recibe respuesta clara y queda una sola boleta', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3 });
    fixtures.push(fx);
    const { submitVote } = await import('@/app/actions/participant');
    const session = { participantId: fx.participantIds[0], roomId: fx.roomId, nickname: 'Persona 1', blindCode: fx.blindCodes[0] };
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, t) =>
        sessionStore.run(session, () =>
          submitVote(fx.optionIds.map((optionId, k) => ({ optionId, position: ((k + t) % fx.optionIds.length) + 1 })))
        )
      )
    );
    expect(results.map((r) => r.success)).toEqual(Array(8).fill(true));
    expect(await prisma.vote.count({ where: { participant_id: fx.participantIds[0], round: 1 } })).toBe(3);
  }, 60000);
});
