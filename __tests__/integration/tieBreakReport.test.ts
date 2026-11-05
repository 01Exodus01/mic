/**
 * __tests__/integration/tieBreakReport.test.ts
 * PT-16: a room's declared tie-break rule reaches the engine, and the report
 * stores the strict ranking plus which groups were tied and the rule applied.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { reasonBalanceOf } from '@/lib/round-processor';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

describe('PT-16: saldo de razones', () => {
  it('cuenta cada razón no vacía con peso 1: a favor menos en contra', () => {
    const r = (n: number) => Array.from({ length: n }, (_, i) => ({ blindCode: 'P', position: 1, order: i, text: 'x' }));
    expect(reasonBalanceOf({ a: { reasonsFor: r(3), reasonsAgainst: r(1) }, b: { reasonsFor: [], reasonsAgainst: r(2) } })).toEqual({ a: 2, b: -2 });
  });
});

describe.skipIf(!hasTestDb)('PT-16: regla de desempate en el informe (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  async function cyclicVotes(fx: RoomFixture) {
    const [a, b, c] = fx.optionIds;
    const orders = [[a, b, c], [b, c, a], [c, a, b]];
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) {
        await prisma.vote.create({ data: { participant_id: fx.participantIds[i], round: 1, option_id: orders[i][k], position: k + 1 } });
      }
    }
  }

  it('con regla lexicográfica el informe guarda el orden estricto y la regla aplicada', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3, room: { tie_break_rule: 'LEXICOGRAPHIC' } });
    fixtures.push(fx);
    await cyclicVotes(fx);
    const { processRoundConsensus } = await import('@/lib/round-processor');
    expect((await processRoundConsensus(fx.roomId)).success).toBe(true);
    const report = await prisma.roundReport.findUnique({ where: { room_id_round: { room_id: fx.roomId, round: 1 } } });
    const ranking = report!.collective_ranking as Array<{ id: string; midRank: number }>;
    expect(fx.optionIds.map((id) => ranking.find((r) => r.id === id)!.midRank)).toEqual([1, 2, 3]);
    const args = report!.arguments_json as unknown as { __tieBreak: { rule: string; applied: boolean; tiedGroups: string[][]; weakOrder?: unknown[] } };
    expect(args.__tieBreak).toMatchObject({ rule: 'LEXICOGRAPHIC', applied: true, tiedGroups: [fx.optionIds] });
  });

  it('sin regla los empates se conservan como antes', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3 });
    fixtures.push(fx);
    await cyclicVotes(fx);
    const { processRoundConsensus } = await import('@/lib/round-processor');
    await processRoundConsensus(fx.roomId);
    const report = await prisma.roundReport.findUnique({ where: { room_id_round: { room_id: fx.roomId, round: 1 } } });
    const ranking = report!.collective_ranking as Array<{ midRank: number }>;
    expect(ranking.map((r) => r.midRank)).toEqual([2, 2, 2]);
    expect(report!.obtained_tau).toBe(0.5);
    const args = report!.arguments_json as unknown as { __tieBreak: { rule: string; applied: boolean } };
    expect(args.__tieBreak).toMatchObject({ rule: 'NONE', applied: false });
  });
});
