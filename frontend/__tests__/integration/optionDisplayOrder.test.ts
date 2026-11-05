/**
 * __tests__/integration/optionDisplayOrder.test.ts
 * P1.4: options are shown in a random order per participant and round, and the
 * place where each option was shown is stored with the ballot (displayed_position).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { displayOrderFor, displayedPositions } from '@mic/backend/option-order';
import { loadExportDataset } from '@mic/backend/export/dataset';
import { buildExportTables } from '@mic/backend/export/tables';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

const state = vi.hoisted(() => ({
  session: null as null | { participantId: string; roomId: string; nickname: string; blindCode: string; sessionVersion?: number },
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

describe('P1.4: orden de las opciones por participante', () => {
  const options = ['a', 'b', 'c', 'd', 'e'];

  it('es una permutación estable para la misma persona y ronda', () => {
    const o = displayOrderFor('p1', 1, options);
    expect([...o].sort()).toEqual(options);
    expect(displayOrderFor('p1', 1, [...options].reverse())).toEqual(o);
  });

  it('varía entre participantes y entre rondas', () => {
    const orders = new Set(Array.from({ length: 40 }, (_, i) => displayOrderFor(`p${i}`, 1, options).join('')));
    expect(orders.size).toBeGreaterThan(20);
    const byRound = new Set([1, 2, 3, 4, 5].map((r) => displayOrderFor('p1', r, options).join('')));
    expect(byRound.size).toBeGreaterThan(1);
    // The host's list order is not the default
    expect(Array.from({ length: 40 }, (_, i) => displayOrderFor(`p${i}`, 1, options).join('')).filter((x) => x === 'abcde').length).toBeLessThan(5);
  });
});

describe.skipIf(!hasTestDb)('P1.4: orden mostrado guardado con el voto (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, { participants: 3, options: 5 });
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('la vista entrega el orden propio y el voto guarda displayed_position', async () => {
    const p = await import('@/app/actions/participant');
    for (let i = 0; i < 3; i++) {
      state.session = { participantId: fx!.participantIds[i], roomId: fx!.roomId, nickname: 'x', blindCode: fx!.blindCodes[i], sessionVersion: 0 };
      const view = await p.getParticipantRoomView();
      const shown = view.success ? view.data!.options.map((o) => o.id) : [];
      expect(shown).toEqual(displayOrderFor(fx!.participantIds[i], 1, fx!.optionIds));
      // Submit exactly as shown
      expect(await p.submitVote(shown.map((optionId, k) => ({ optionId, position: k + 1 })))).toEqual({ success: true });
      const votes = await prisma.vote.findMany({ where: { participant_id: fx!.participantIds[i] } });
      const expected = displayedPositions(fx!.participantIds[i], 1, fx!.optionIds);
      for (const v of votes) expect(v.displayed_position).toBe(expected.get(v.option_id));
    }
    const ds = await loadExportDataset(prisma, fx!.roomId);
    const votesLong = buildExportTables(ds!).find((t) => t.name === 'votes_long.csv')!;
    const col = votesLong.headers.indexOf('displayed_position');
    expect(votesLong.rows.every((r) => typeof r[col] === 'number')).toBe(true);
  });
});
