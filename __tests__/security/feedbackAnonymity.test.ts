/**
 * __tests__/security/feedbackAnonymity.test.ts
 * Feedback reasons are a plain list per side (for / against): the participant
 * view carries no blind code or position per reason, so reasons are not
 * grouped or signed by participant. The stored report and the CSVs keep the
 * authorship for research.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

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
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

describe.skipIf(!hasTestDb)('Razones sin agrupar por participante (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, { participants: 3, room: { tau_threshold: 0.99 } });
    const { submitVote } = await import('@/app/actions/participant');
    for (let i = 0; i < 3; i++) {
      state.session = { participantId: fx.participantIds[i], roomId: fx.roomId, nickname: 'x', blindCode: fx.blindCodes[i] };
      await submitVote(
        fx.optionIds.map((optionId, k) => ({
          optionId,
          position: ((k + i) % 3) + 1,
          reasonsFor: k === 0 ? [`P${i} primera`, `P${i} segunda`, `P${i} tercera`] : [],
          reasonsAgainst: k === 0 ? [`P${i} en contra`] : [],
        }))
      );
    }
    const { processRoundConsensus } = await import('@/lib/round-processor');
    await processRoundConsensus(fx.roomId);
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('la vista trae todas las razones, separadas por lado, sin código ciego ni posición', async () => {
    state.session = { participantId: fx!.participantIds[0], roomId: fx!.roomId, nickname: 'x', blindCode: fx!.blindCodes[0] };
    const { getParticipantRoomView } = await import('@/app/actions/participant');
    const view = await getParticipantRoomView();
    const report = view.success ? view.data!.latestReport! : null;
    const reasons = report!.reasonsByOption[fx!.optionIds[0]];
    expect(reasons.reasonsFor.map((r) => r.text).sort()).toEqual(
      ['P0 primera', 'P0 segunda', 'P0 tercera', 'P1 primera', 'P1 segunda', 'P1 tercera', 'P2 primera', 'P2 segunda', 'P2 tercera'].sort()
    );
    expect(reasons.reasonsAgainst.map((r) => r.text).sort()).toEqual(['P0 en contra', 'P1 en contra', 'P2 en contra']);
    const reasonsJson = JSON.stringify(report!.reasonsByOption);
    for (const code of fx!.blindCodes) expect(reasonsJson).not.toContain(code);
    expect(reasonsJson).not.toContain('position');
    expect(reasonsJson).not.toContain('blindCode');

    // Same order on every poll for the same report
    const again = await getParticipantRoomView();
    expect(again.success && again.data!.latestReport!.reasonsByOption).toEqual(report!.reasonsByOption);
  });

  it('el informe guardado conserva la autoría para la investigación', async () => {
    const stored = await prisma.roundReport.findUniqueOrThrow({ where: { room_id_round: { room_id: fx!.roomId, round: 1 } } });
    const json = JSON.stringify(stored.arguments_json);
    for (const code of fx!.blindCodes) expect(json).toContain(code);
  });
});
