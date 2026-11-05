/**
 * backend/__tests__/integration/pairwiseTieBreakRound.test.ts
 * E-12 end to end: a round of a room with the fixed rule is processed with
 * pairwise majority on the counted ballots and then the option title; the
 * report stores the rule, the tied groups and whether the title decided, under
 * procedure r-fast-cr-4. Expelled ballots never count in the majority.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

describe.skipIf(!hasTestDb)('E-12: ronda procesada con desempate fijo (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  async function roomWith(titles: string[], orders: number[][], expelled: number[] = []) {
    const fx = await createRoomFixture(prisma, {
      participants: orders.length,
      room: { tie_break_rule: 'PAIRWISE_MAJORITY', concordance_variant: 'WITHOUT_TIES', tau_threshold: 0.99 },
    });
    fixtures.push(fx);
    for (let i = 0; i < titles.length; i++) {
      await prisma.option.update({ where: { id: fx.optionIds[i] }, data: { title: titles[i] } });
    }
    for (let p = 0; p < orders.length; p++) {
      for (let k = 0; k < orders[p].length; k++) {
        await prisma.vote.create({
          data: { participant_id: fx.participantIds[p], round: 1, option_id: fx.optionIds[orders[p][k]], position: k + 1 },
        });
      }
    }
    for (const p of expelled) await prisma.participant.update({ where: { id: fx.participantIds[p] }, data: { is_retired: true } });
    const { processRoundConsensus } = await import('@mic/backend/round-processor');
    expect((await processRoundConsensus(fx.roomId)).success).toBe(true);
    const report = await prisma.roundReport.findUniqueOrThrow({ where: { room_id_round: { room_id: fx.roomId, round: 1 } } });
    const ranking = (report.collective_ranking as unknown as Array<{ id: string; midRank: number }>)
      .sort((a, b) => a.midRank - b.midRank)
      .map((r) => fx.optionIds.indexOf(r.id));
    return { fx, report, ranking, json: report.arguments_json as Record<string, any> };
  }

  it('ciclo 3-3-3: decide el título y queda registrado', async () => {
    const { ranking, json } = await roomWith(['Torneo', 'biblioteca', 'Huerto'], [[0, 1, 2], [1, 2, 0], [2, 0, 1]]);
    expect(ranking).toEqual([1, 2, 0]);
    expect(json.__tieBreak).toMatchObject({ rule: 'PAIRWISE_MAJORITY', applied: true, fallbackUsed: true });
    expect(json.__procedure).toMatchObject({ version: 'r-fast-cr-4', tieBreakRule: 'PAIRWISE_MAJORITY', concordanceVariant: 'WITHOUT_TIES' });
    expect(json.__concordance).toEqual({ variant: 'WITHOUT_TIES' });
  });

  it('empate de Borda con mayoría clara: decide la mayoría aunque el título diga lo contrario', async () => {
    // Borda: option 0 = 4, option 1 = 4, option 2 = 1; option 0 above 1 on 2 of 3 ballots
    const { ranking, json } = await roomWith(['Zeta', 'Alfa', 'Beta'], [[0, 1, 2], [0, 1, 2], [1, 2, 0]]);
    expect(ranking.slice(0, 2)).toEqual([0, 1]);
    expect(json.__tieBreak).toMatchObject({ rule: 'PAIRWISE_MAJORITY', applied: true, fallbackUsed: false });
  });

  it('las selecciones de un expulsado no cuentan en la mayoría', async () => {
    // Counted: the 3-cycle (Borda tie, majority cycle) → title order. The expelled
    // ballot would have broken it towards option 0 if it counted.
    const { ranking, json } = await roomWith(
      ['Torneo', 'biblioteca', 'Huerto'],
      [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1]],
      [3]
    );
    expect(ranking).toEqual([1, 2, 0]);
    expect(json.__tieBreak.fallbackUsed).toBe(true);
  });
});
