/**
 * frontend/__tests__/security/ownReasonsMark.test.ts
 * In the round report each participant sees which reasons are their own
 * ("Tu razón"): only a `mine` flag on their reasons, computed on the server.
 * Nobody receives the authors of the other reasons.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrismaClient } from '@prisma/client';
import RoundFeedbackReport from '@/components/RoundFeedbackReport';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

type Session = { participantId: string; roomId: string; nickname: string; blindCode: string };
const state = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => null }));
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

describe('"Tu razón" en el componente', () => {
  it('marca solo las razones propias, dentro de la misma lista', () => {
    const html = renderToStaticMarkup(
      <RoundFeedbackReport
        options={[{ id: 'a', title: 'A' }]}
        defaultOpen
        report={{
          collective_ranking: [{ id: 'a', midRank: 1 }],
          reasonsByOption: { a: { reasonsFor: [{ text: 'Mía', mine: true }, { text: 'De otra persona' }], reasonsAgainst: [] } },
          myConcordance: { voted: true, cix: 1 },
          myPositions: { a: 1 },
        }}
      />
    );
    expect(html.match(/Tu razón/g)).toHaveLength(1);
    expect(html).toMatch(/Tu razón<\/span>Mía/);
    expect(html).not.toMatch(/Tu razón<\/span>De otra persona/);
  });
});

describe.skipIf(!hasTestDb)('"Tu razón" desde el servidor (PostgreSQL)', () => {
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
          reasonsFor: k === 0 ? [`A favor de la persona ${i}`] : [],
          reasonsAgainst: k === 1 ? [`En contra de la persona ${i}`] : [],
        }))
      );
    }
    const { processRoundConsensus } = await import('@mic/backend/round-processor');
    await processRoundConsensus(fx.roomId);
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('cada persona ve marcadas solo sus razones y nunca los autores de las demás', async () => {
    const { getParticipantRoomView } = await import('@/app/actions/participant');
    for (let i = 0; i < 3; i++) {
      state.session = { participantId: fx!.participantIds[i], roomId: fx!.roomId, nickname: 'x', blindCode: fx!.blindCodes[i] };
      const view = await getParticipantRoomView();
      if (!view.success) throw new Error(view.error);
      const reasons = Object.values(view.data!.latestReport!.reasonsByOption).flatMap((o) => [...o.reasonsFor, ...o.reasonsAgainst]);
      expect(reasons).toHaveLength(6);
      const mine = reasons.filter((r) => r.mine);
      expect(mine.map((r) => r.text).sort()).toEqual([`A favor de la persona ${i}`, `En contra de la persona ${i}`]);
      expect(reasons.every((r) => Object.keys(r).every((k) => k === 'text' || k === 'mine'))).toBe(true);
      const json = JSON.stringify(view.data!.latestReport!.reasonsByOption);
      for (let j = 0; j < 3; j++) expect(json).not.toContain(fx!.blindCodes[j]);
    }
  });
});
