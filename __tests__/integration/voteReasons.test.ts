/**
 * __tests__/integration/voteReasons.test.ts
 * PT-13: submitVote stores optional reasons as VoteReason rows (deleted and
 * recreated with the votes), leaves justification null for new ballots, and the
 * CSV exports still generate with null justifications.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

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
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

describe.skipIf(!hasTestDb)('PT-13: razones guardadas (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(() => {
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
    state.hostId = fx.hostId;
    state.session = { participantId: fx.participantIds[0], roomId: fx.roomId, nickname: 'Persona 1', blindCode: fx.blindCodes[0] };
  });

  it('acepta un voto sin ninguna razón y deja justification nula', async () => {
    const { submitVote } = await import('@/app/actions/participant');
    const res = await submitVote(fx!.optionIds.map((optionId, i) => ({ optionId, position: i + 1 })));
    expect(res).toEqual({ success: true });
    const votes = await prisma.vote.findMany({ where: { participant_id: fx!.participantIds[0] }, include: { reasons: true } });
    expect(votes).toHaveLength(3);
    expect(votes.every((v) => v.justification === null && v.reasons.length === 0)).toBe(true);
  });

  it('guarda varias razones por lado en orden y las reemplaza al editar', async () => {
    const { submitVote, getParticipantRoomView } = await import('@/app/actions/participant');
    const [a, b, c] = fx!.optionIds;
    await submitVote([
      { optionId: a, position: 1, reasonsFor: ['Barata', '  Rápida  ', ''], reasonsAgainst: ['Frágil'] },
      { optionId: b, position: 2, reasonsAgainst: ['Cara', 'Lenta'] },
      { optionId: c, position: 3 },
    ]);
    let reasons = await prisma.voteReason.findMany({
      where: { vote: { participant_id: fx!.participantIds[0] } },
      include: { vote: { select: { option_id: true } } },
      orderBy: [{ side: 'asc' }, { order_index: 'asc' }],
    });
    expect(reasons.filter((r) => r.vote.option_id === a).map((r) => [r.side, r.order_index, r.text])).toEqual([
      ['FOR', 0, 'Barata'],
      ['FOR', 1, 'Rápida'],
      ['AGAINST', 0, 'Frágil'],
    ]);
    expect(reasons.filter((r) => r.vote.option_id === b).map((r) => r.text)).toEqual(['Cara', 'Lenta']);

    const view = await getParticipantRoomView();
    const mine = view.success ? view.data!.myVotes : [];
    expect(mine.find((v) => v.option_id === a)).toMatchObject({ reasonsFor: ['Barata', 'Rápida'], reasonsAgainst: ['Frágil'] });

    await submitVote([
      { optionId: b, position: 1, reasonsFor: ['Cambié de idea'] },
      { optionId: a, position: 2 },
      { optionId: c, position: 3 },
    ]);
    reasons = await prisma.voteReason.findMany({
      where: { vote: { participant_id: fx!.participantIds[0] } },
      include: { vote: { select: { option_id: true } } },
    });
    expect(reasons.map((r) => [r.vote.option_id, r.side, r.text])).toEqual([[b, 'FOR', 'Cambié de idea']]);
  });

  it('rechaza una razón de más de 200 caracteres o más de 5 por lado, sin guardar nada', async () => {
    const { submitVote } = await import('@/app/actions/participant');
    const [a, b, c] = fx!.optionIds;
    const long = await submitVote([
      { optionId: a, position: 1, reasonsFor: ['x'.repeat(201)] },
      { optionId: b, position: 2 },
      { optionId: c, position: 3 },
    ]);
    expect(long.success).toBe(false);
    const many = await submitVote([
      { optionId: a, position: 1, reasonsAgainst: ['1', '2', '3', '4', '5', '6'] },
      { optionId: b, position: 2 },
      { optionId: c, position: 3 },
    ]);
    expect(many.success).toBe(false);
    expect(await prisma.vote.count({ where: { participant_id: fx!.participantIds[0] } })).toBe(0);
  });

  it('los exportes siguen generando CSV con justification nula', async () => {
    const { submitVote } = await import('@/app/actions/participant');
    for (let i = 0; i < 3; i++) {
      state.session = { participantId: fx!.participantIds[i], roomId: fx!.roomId, nickname: `Persona ${i + 1}`, blindCode: fx!.blindCodes[i] };
      await submitVote(fx!.optionIds.map((optionId, k) => ({ optionId, position: ((k + i) % 3) + 1, reasonsFor: ['Una razón'] })));
    }
    const { processRoundConsensus } = await import('@/lib/round-processor');
    await processRoundConsensus(fx!.roomId);

    const longRoute = await import('@/app/api/rooms/[id]/export/long/route');
    const wideRoute = await import('@/app/api/rooms/[id]/export/wide/route');
    const req = new NextRequest('http://localhost/api');
    const longRes = await longRoute.GET(req, { params: { id: fx!.roomId } });
    const wideRes = await wideRoute.GET(req, { params: { id: fx!.roomId } });
    expect(longRes.status).toBe(200);
    expect(wideRes.status).toBe(200);
    const longCsv = await longRes.text();
    expect(longCsv.split('\r\n')).toHaveLength(1 + 9);
  });
});
