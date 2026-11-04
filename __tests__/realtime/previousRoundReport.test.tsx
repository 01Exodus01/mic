/**
 * __tests__/realtime/previousRoundReport.test.tsx
 * PT-20: while round r > 1 is open the participant still receives the report of
 * round r - 1; in round 1 there is no report.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { OptionPreviousRound } from '@/components/RoundFeedbackReport';
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

describe('PT-20: línea de la ronda anterior junto a cada opción', () => {
  it('muestra la posición de grupo y las razones al abrirla', () => {
    const html = renderToStaticMarkup(
      <OptionPreviousRound
        optionId="a"
        report={{
          collective_ranking: [{ id: 'a', midRank: 1.5 }, { id: 'b', midRank: 1.5 }],
          reasonsByOption: { a: { reasonsFor: [{ blindCode: 'Participante 03', position: 1, text: 'Barata' }], reasonsAgainst: [] } },
        }}
      />
    );
    expect(html).toContain('Ronda anterior: grupo 1.º y 2.º empatadas · 1 razón');
    expect(html).toContain('<details');
    expect(html).toContain('Barata');
  });

  it('sin posición en el informe no muestra nada', () => {
    expect(renderToStaticMarkup(<OptionPreviousRound optionId="z" report={{ collective_ranking: [] }} />)).toBe('');
  });
});

describe.skipIf(!hasTestDb)('PT-20: informe de la ronda anterior (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, { participants: 3, status: 'ROUND_OPEN', currentRound: 1 });
    state.session = { participantId: fx.participantIds[0], roomId: fx.roomId, nickname: 'Persona 1', blindCode: fx.blindCodes[0] };
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('en la ronda 1 no se entrega informe', async () => {
    const { getParticipantRoomView } = await import('@/app/actions/participant');
    const res = await getParticipantRoomView();
    expect(res.success && res.data?.latestReport).toBeNull();
  });

  it('durante la ronda 2 se entrega el informe de la ronda 1', async () => {
    await prisma.roundReport.create({
      data: {
        room_id: fx!.roomId,
        round: 1,
        effective_voters: 3,
        obtained_tau: 0.6,
        collective_ranking: fx!.optionIds.map((id, i) => ({ id, midRank: i + 1, score: 3 - i })),
        arguments_json: {
          ...Object.fromEntries(fx!.optionIds.map((id) => [id, []])),
          __reasons: { [fx!.optionIds[0]]: { reasonsFor: [{ blindCode: 'Participante 02', position: 1, order: 0, text: 'Texto de la ronda 1' }], reasonsAgainst: [] } },
        },
      },
    });
    await prisma.room.update({ where: { id: fx!.roomId }, data: { current_round: 2 } });
    const { getParticipantRoomView } = await import('@/app/actions/participant');
    const res = await getParticipantRoomView();
    const report = res.success ? res.data!.latestReport : null;
    expect(report?.round).toBe(1);
    expect(report?.reasonsByOption[fx!.optionIds[0]].reasonsFor.map((r) => r.text)).toEqual(['Texto de la ronda 1']);
    expect(res.success && res.data?.sala.status).toBe('ROUND_OPEN');
  });
});
