/**
 * __tests__/integration/tauCPrimary.test.ts
 * AGENTS.md E-14 (r-fast-cr-5), end to end on PostgreSQL: a processed round
 * stores the CIX and τ* of Stuart's tau-c, and the export says so.
 *
 * Room with the variant with ties and no tie-break rule, so that the group
 * order keeps a tie and tau-b and tau-c differ. Four ballots on A, B, C:
 * two A > B > C, two B > A > C → Borda A = 6, B = 6, C = 0, group A = B > C.
 * Every ballot: C = 2, D = 0, (A,B) tied in the group, n = 3, q = 2.
 *   tau_c = 8/9 → CIX = 17/18 ≈ 0.9444 (stored and used)
 *   tau_b = 2/√6 → CIX ≈ 0.9082 (sensitivity only)
 * Threshold 0.93 sits between both: only tau-c reaches consensus.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';
import { loadExportDataset } from '@mic/backend/export/dataset';
import { exportTables } from '@mic/backend/export/bundle';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

describe.skipIf(!hasTestDb)('E-14: la ronda se calcula con tau-c (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, {
      participants: 4,
      options: 3,
      room: { method: 'BORDA', tau_threshold: 0.93, max_rounds: 3, tie_break_rule: 'NONE', concordance_variant: 'WITH_TIES' },
    });
    const orders = [[0, 1, 2], [1, 0, 2], [0, 1, 2], [1, 0, 2]];
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 3; k++) {
        await prisma.vote.create({ data: { participant_id: fx.participantIds[i], round: 1, option_id: fx.optionIds[orders[i][k]], position: k + 1 } });
      }
    }
    const { processRoundConsensus } = await import('@mic/backend/round-processor');
    expect((await processRoundConsensus(fx.roomId)).success).toBe(true);
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('el informe guarda τ* de tau-c y la sala concluye por consenso', async () => {
    const report = await prisma.roundReport.findUniqueOrThrow({ where: { room_id_round: { room_id: fx!.roomId, round: 1 } } });
    expect(report.obtained_tau).toBeCloseTo(17 / 18, 10);
    const json = report.arguments_json as Record<string, any>;
    expect(json.__procedure).toMatchObject({ version: 'r-fast-cr-5', concordanceIndex: 'TAU_C' });
    expect(json.__concordance).toEqual({ variant: 'WITH_TIES', index: 'TAU_C' });
    const room = await prisma.room.findUniqueOrThrow({ where: { id: fx!.roomId } });
    expect(room.status).toBe('CONCLUDED');
  });

  it('cada métrica por participante tiene cix = (tau_c + 1) / 2; tau-b queda solo como sensibilidad', async () => {
    const rows = await prisma.roundVoterMetric.findMany({ where: { room_id: fx!.roomId, round: 1 } });
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.stuart_tau_c).toBeCloseTo(8 / 9, 10);
      expect(r.cix).toBeCloseTo(17 / 18, 10);
      expect(r.cix).toBe(r.stuart_cix);
      expect(r.tau_b).toBeCloseTo(2 / Math.sqrt(6), 10);
    }
  });

  it('el export declara TAU_C y sus columnas salen de tau-c', async () => {
    const ds = await loadExportDataset(prisma, fx!.roomId);
    const tables = exportTables(ds!, { mode: 'research', includeText: true });
    const rowsOf = (name: string) => {
      const t = tables.find((x) => x.name === name)!;
      return t.rows.map((row) => Object.fromEntries(t.headers.map((h, i) => [h, row[i]])));
    };
    const rm = rowsOf('round_metrics.csv')[0];
    expect(rm.concordance_index).toBe('TAU_C');
    expect(Number(rm.mean_tau)).toBeCloseTo(8 / 9, 4);
    expect(Number(rm.collective_cix)).toBeCloseTo(17 / 18, 4);
    expect(rm.stop_reason).toBe('CONSENSUS');
    for (const v of rowsOf('voter_round_metrics.csv')) {
      expect(Number(v.cix)).toBeCloseTo((Number(v.tau_c) + 1) / 2, 4);
      expect(Number(v.cix)).not.toBeCloseTo((Number(v.tau_b) + 1) / 2, 3);
    }
  });
});
