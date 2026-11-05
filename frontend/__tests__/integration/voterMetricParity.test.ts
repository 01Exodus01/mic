/**
 * __tests__/integration/voterMetricParity.test.ts
 * PT-30: per-voter metrics stored in RoundVoterMetric equal what the exports
 * recomputed before, and equal arguments_json.__metrics. The long CSV is
 * identical whether it reads the table or recomputes.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { computeVoterCIX } from '@mic/backend/algorithms/kendallTau';
import type { WeakOrder } from '@mic/backend/algorithms/types';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

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

describe.skipIf(!hasTestDb)('PT-30: paridad de métricas por votante (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, { participants: 6, options: 4, room: { tau_threshold: 0.99, max_rounds: 3 } });
    state.hostId = fx.hostId;
    const orders = [[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 0, 1], [0, 2, 1, 3], [3, 2, 1, 0], [1, 0, 2, 3]];
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 4; k++) {
        await prisma.vote.create({ data: { participant_id: fx.participantIds[i], round: 1, option_id: fx.optionIds[orders[i][k]], position: k + 1 } });
      }
    }
    // An expelled voter: kept, not counted, still recomputed in the long export
    await prisma.participant.update({ where: { id: fx.participantIds[5] }, data: { is_retired: true } });
    const { processRoundConsensus } = await import('@mic/backend/round-processor');
    expect((await processRoundConsensus(fx.roomId)).success).toBe(true);
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('la tabla coincide con el recálculo y con __metrics', async () => {
    const report = await prisma.roundReport.findUniqueOrThrow({ where: { room_id_round: { room_id: fx!.roomId, round: 1 } } });
    const rows = await prisma.roundVoterMetric.findMany({ where: { report_id: report.id } });
    expect(rows).toHaveLength(5);
    const metrics = (report.arguments_json as unknown as { __metrics: { voters: Array<Record<string, number | string>> } }).__metrics.voters;
    for (const row of rows) {
      const votes = await prisma.vote.findMany({ where: { participant_id: row.participant_id, round: 1 } });
      const recomputed = computeVoterCIX(new Map(votes.map((v) => [v.option_id, v.position])), report.collective_ranking as unknown as WeakOrder[], row.participant_id);
      // DOUBLE PRECISION round trip through Prisma can differ in the last bit
      // (e.g. 0.16666666666666669 vs 0.1666666666666667): compare to 1e-12. The CSV
      // rounds to 4 decimals and is byte-identical (next test).
      const pairs: Array<[number, number | undefined]> = [
        [row.tau_b, recomputed.tauB], [row.cix, recomputed.cix], [row.stuart_tau_c, recomputed.stuartTauC],
        [row.stuart_cix, recomputed.stuartCix], [row.gamma, recomputed.gamma], [row.gamma_cix, recomputed.gammaCix],
      ];
      for (const [stored, fresh] of pairs) expect(Math.abs(stored - (fresh ?? NaN))).toBeLessThan(1e-12);
      expect([row.concordant, row.discordant, row.tied]).toEqual([recomputed.concordant, recomputed.discordant, recomputed.tied]);
      const fromJson = metrics.find((m) => m.participantId === row.participant_id)!;
      expect(Math.abs(Number(fromJson.cix) - row.cix)).toBeLessThan(1e-12);
      expect(Math.abs(Number(fromJson.tauB) - row.tau_b)).toBeLessThan(1e-12);
    }
    expect(rows.map((r) => r.participant_id)).not.toContain(fx!.participantIds[5]);
  });

  it('voter_round_metrics.csv es idéntico leyendo la tabla o recalculando', async () => {
    const { GET } = await import('@/app/api/rooms/[id]/export/v2/[file]/route');
    const file = 'voter_round_metrics.csv';
    const req = new NextRequest(`http://localhost/api/rooms/${fx!.roomId}/export/v2/${file}`);
    const withTable = await (await GET(req, { params: { id: fx!.roomId, file } })).text();
    await prisma.roundVoterMetric.deleteMany({ where: { room_id: fx!.roomId } });
    const recomputed = await (await GET(req, { params: { id: fx!.roomId, file } })).text();
    // every column must match byte for byte
    expect(withTable).toBe(recomputed);
  });

  it('la vista del participante da su propio cix desde la tabla', async () => {
    const { processRoundConsensus } = await import('@mic/backend/round-processor');
    void processRoundConsensus;
    const report = await prisma.roundReport.findUniqueOrThrow({ where: { room_id_round: { room_id: fx!.roomId, round: 1 } } });
    await prisma.roundVoterMetric.create({
      data: { report_id: report.id, room_id: fx!.roomId, round: 1, participant_id: fx!.participantIds[0], tau_b: 0.5, cix: 0.75, stuart_tau_c: 0.5, stuart_cix: 0.75, gamma: 0.5, gamma_cix: 0.75, concordant: 4, discordant: 1, tied: 1 },
    });
    state.session = { participantId: fx!.participantIds[0], roomId: fx!.roomId, nickname: 'x', blindCode: fx!.blindCodes[0] };
    const { getParticipantRoomView } = await import('@/app/actions/participant');
    const view = await getParticipantRoomView();
    expect(view.success && view.data?.latestReport?.myConcordance).toEqual({ voted: true, cix: 0.75 });
  });
});
