/**
 * __tests__/integration/voteRevisions.test.ts
 * PT-09: every distinct ballot a participant submits is kept as a VoteRevision.
 * The effective votes (deleteMany + createMany) and the computation do not change.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildVoteSnapshot, isSameSnapshot } from '@mic/backend/vote-revision';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

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
vi.mock('@mic/backend/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

describe('PT-09: copia normalizada del voto', () => {
  it('dos boletas iguales en distinto orden producen la misma copia', () => {
    const a = buildVoteSnapshot([
      { optionId: 'b', position: 2, justification: 'x' },
      { optionId: 'a', position: 1, justification: 'y' },
    ]);
    const b = buildVoteSnapshot([
      { optionId: 'a', position: 1, justification: 'y' },
      { optionId: 'b', position: 2, justification: 'x' },
    ]);
    expect(isSameSnapshot(JSON.parse(JSON.stringify(a)), b)).toBe(true);
  });

  it('un cambio de texto o de posición produce otra copia', () => {
    const base = buildVoteSnapshot([{ optionId: 'a', position: 1, justification: 'y' }]);
    expect(isSameSnapshot(base, buildVoteSnapshot([{ optionId: 'a', position: 1, justification: 'z' }]))).toBe(false);
    expect(isSameSnapshot(base, buildVoteSnapshot([{ optionId: 'a', position: 2, justification: 'y' }]))).toBe(false);
    expect(isSameSnapshot(null, base)).toBe(false);
  });
});

describe.skipIf(!hasTestDb)('PT-09: historial de votos (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupFixture(prisma, fx);
    fx = await createRoomFixture(prisma, { participants: 3 });
  });

  function as(i: number) {
    state.session = { participantId: fx!.participantIds[i], roomId: fx!.roomId, nickname: `Persona ${i + 1}`, blindCode: fx!.blindCodes[i] };
  }

  function ballot(order: number[], text: string) {
    return order.map((optIdx, pos) => ({
      optionId: fx!.optionIds[optIdx],
      position: pos + 1,
      justification: `${text} para la opción ${optIdx + 1}, con detalle suficiente`,
    }));
  }

  it('tres ediciones distintas dejan tres versiones y los votos efectivos son los últimos', async () => {
    const { submitVote } = await import('@/app/actions/participant');
    as(0);
    expect(await submitVote(ballot([0, 1, 2], 'Primera versión'))).toEqual({ success: true });
    expect(await submitVote(ballot([1, 0, 2], 'Segunda versión'))).toEqual({ success: true });
    expect(await submitVote(ballot([2, 1, 0], 'Tercera versión'))).toEqual({ success: true });

    const revisions = await prisma.voteRevision.findMany({
      where: { participant_id: fx!.participantIds[0], round: 1 },
      orderBy: { version: 'asc' },
    });
    expect(revisions.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(revisions.every((r) => r.room_id === fx!.roomId)).toBe(true);

    const votes = await prisma.vote.findMany({
      where: { participant_id: fx!.participantIds[0], round: 1 },
      orderBy: { position: 'asc' },
    });
    expect(votes.map((v) => v.option_id)).toEqual([fx!.optionIds[2], fx!.optionIds[1], fx!.optionIds[0]]);
    expect(votes[0].justification).toContain('Tercera versión');
    const last = revisions[2].snapshot as { entries: Array<{ optionId: string; position: number }> };
    expect(last.entries.map((e) => e.optionId)).toEqual(votes.map((v) => v.option_id));
  });

  it('reenviar el mismo voto no crea otra versión', async () => {
    const { submitVote } = await import('@/app/actions/participant');
    as(1);
    await submitVote(ballot([0, 1, 2], 'Igual'));
    await submitVote(ballot([0, 1, 2], 'Igual'));
    await submitVote(ballot([0, 1, 2], 'Igual'));
    expect(await prisma.voteRevision.count({ where: { participant_id: fx!.participantIds[1] } })).toBe(1);
  });

  it('el informe de la ronda se calcula con los votos efectivos', async () => {
    const { submitVote } = await import('@/app/actions/participant');
    const { processRoundConsensus } = await import('@mic/backend/round-processor');
    as(0);
    await submitVote(ballot([2, 1, 0], 'Borrador'));
    await submitVote(ballot([0, 1, 2], 'Final'));
    as(1);
    await submitVote(ballot([0, 1, 2], 'Final'));
    as(2);
    await submitVote(ballot([0, 2, 1], 'Final'));

    const result = await processRoundConsensus(fx!.roomId);
    expect(result.success).toBe(true);
    expect(result.effectiveVoters).toBe(3);
    const report = await prisma.roundReport.findUnique({ where: { room_id_round: { room_id: fx!.roomId, round: 1 } } });
    const ranking = report!.collective_ranking as Array<{ id: string; midRank: number }>;
    // Borda with ballots [0,1,2], [0,1,2], [0,2,1]: option 1 first, then 2, then 3
    expect(ranking.find((r) => r.id === fx!.optionIds[0])?.midRank).toBe(1);
    expect(ranking.find((r) => r.id === fx!.optionIds[1])?.midRank).toBe(2);
    expect(ranking.find((r) => r.id === fx!.optionIds[2])?.midRank).toBe(3);
  });
});
