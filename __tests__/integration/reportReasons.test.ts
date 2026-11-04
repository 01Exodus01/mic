/**
 * __tests__/integration/reportReasons.test.ts
 * PT-15: the round report lists, per option, all non-empty reasons for and
 * against, verbatim, signed with the blind code and the position that
 * participant gave to the option, sorted by blind code and then by order.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildReasonsByOption } from '@/lib/round-processor';
import type { ReportReasonsMap } from '@/types/report';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

// Runs before the static imports: the Prisma client of lib/prisma must use the test DB
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

describe('PT-15: armado de razones del informe', () => {
  it('ordena por código ciego y luego por orden, excluye boletas no contables y no cambia el texto', () => {
    const votes = [
      { participant_id: 'p2', option_id: 'a', position: 2, reasons: [{ side: 'FOR' as const, text: 'B segunda', order_index: 1 }, { side: 'FOR' as const, text: 'B primera', order_index: 0 }] },
      { participant_id: 'p1', option_id: 'a', position: 1, reasons: [{ side: 'FOR' as const, text: '  A con espacios internos  ', order_index: 0 }, { side: 'AGAINST' as const, text: 'A contra', order_index: 0 }] },
      { participant_id: 'p3', option_id: 'a', position: 3, reasons: [{ side: 'FOR' as const, text: 'Excluido', order_index: 0 }] },
    ];
    const codes = new Map([['p1', 'Participante 01'], ['p2', 'Participante 02'], ['p3', 'Participante 03']]);
    const countable = new Map([['p1', 1], ['p2', 1]]);
    const res = buildReasonsByOption(votes, ['a', 'b'], countable, codes);
    expect(res.a.reasonsFor).toEqual([
      { blindCode: 'Participante 01', position: 1, order: 0, text: '  A con espacios internos  ' },
      { blindCode: 'Participante 02', position: 2, order: 0, text: 'B primera' },
      { blindCode: 'Participante 02', position: 2, order: 1, text: 'B segunda' },
    ]);
    expect(res.a.reasonsAgainst).toEqual([{ blindCode: 'Participante 01', position: 1, order: 0, text: 'A contra' }]);
    expect(res.b).toEqual({ reasonsFor: [], reasonsAgainst: [] });
  });
});

describe.skipIf(!hasTestDb)('PT-15: razones en el informe de ronda (PostgreSQL)', () => {
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

  it('el número y el texto de las razones del informe coinciden con lo enviado', async () => {
    fx = await createRoomFixture(prisma, { participants: 3, room: { tau_threshold: 0.99 } });
    const { submitVote } = await import('@/app/actions/participant');
    const { processRoundConsensus } = await import('@/lib/round-processor');
    const [a, b, c] = fx.optionIds;
    const ballots = [
      [
        { optionId: a, position: 1, reasonsFor: ['Uno', 'Dos', '  '], reasonsAgainst: ['Tres'] },
        { optionId: b, position: 2, reasonsAgainst: ['Cuatro <b>con</b> "comillas"'] },
        { optionId: c, position: 3 },
      ],
      [
        { optionId: b, position: 1, reasonsFor: ['Cinco'] },
        { optionId: a, position: 2, reasonsFor: ['Seis'], reasonsAgainst: ['Siete', 'Ocho'] },
        { optionId: c, position: 3, reasonsAgainst: ['Nueve'] },
      ],
      [
        { optionId: c, position: 1 },
        { optionId: b, position: 2 },
        { optionId: a, position: 3 },
      ],
    ];
    for (let i = 0; i < 3; i++) {
      state.session = { participantId: fx.participantIds[i], roomId: fx.roomId, nickname: `Persona ${i + 1}`, blindCode: fx.blindCodes[i] };
      expect(await submitVote(ballots[i])).toEqual({ success: true });
    }
    const result = await processRoundConsensus(fx.roomId);
    expect(result.success).toBe(true);

    const report = await prisma.roundReport.findUnique({ where: { room_id_round: { room_id: fx.roomId, round: 1 } } });
    const reasons = (report!.arguments_json as unknown as { __reasons: ReportReasonsMap }).__reasons;
    const sent = ['Uno', 'Dos', 'Tres', 'Cuatro <b>con</b> "comillas"', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve'];
    const inReport = fx.optionIds.flatMap((id) => [...reasons[id].reasonsFor, ...reasons[id].reasonsAgainst].map((r) => r.text));
    expect(inReport.sort()).toEqual([...sent].sort());

    expect(reasons[a].reasonsFor.map((r) => [r.blindCode, r.position, r.text])).toEqual([
      [fx.blindCodes[0], 1, 'Uno'],
      [fx.blindCodes[0], 1, 'Dos'],
      [fx.blindCodes[1], 2, 'Seis'],
    ]);
    expect(reasons[a].reasonsAgainst.map((r) => r.text)).toEqual(['Tres', 'Siete', 'Ocho']);

    // Legacy per-option lists stay, empty for ballots without the old single reason
    const legacy = report!.arguments_json as unknown as Record<string, unknown>;
    expect(Array.isArray(legacy[a])).toBe(true);
    expect(legacy[a]).toEqual([]);
  });
});
