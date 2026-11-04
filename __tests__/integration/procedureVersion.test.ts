/**
 * __tests__/integration/procedureVersion.test.ts
 * PT-29: every round report stores the configuration and procedure version
 * used; changing the computation requires raising PROCEDURE_VERSION.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PROCEDURE_VERSION } from '@/lib/round-processor';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

/**
 * Fingerprint of lib/algorithms/*.ts for each procedure version. If this test
 * fails, the computation changed: raise PROCEDURE_VERSION (AGENTS.md) and add
 * the new fingerprint here. Do not just update the hash.
 */
const ALGORITHMS_FINGERPRINT: Record<string, string> = {
  'r-fast-cr-2': 'c8ff8791a2c6246412598cde28c0be4a309fb7aabebbb7ade1c6e8245b93c3ea',
};

function algorithmsFingerprint(): string {
  const dir = path.resolve(__dirname, '../../lib/algorithms');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();
  const hash = createHash('sha256');
  for (const f of files) hash.update(fs.readFileSync(path.join(dir, f)));
  return hash.digest('hex');
}

describe('PT-29: versión del procedimiento', () => {
  it('lib/algorithms coincide con la huella de la versión actual', () => {
    expect(ALGORITHMS_FINGERPRINT[PROCEDURE_VERSION], 'raise PROCEDURE_VERSION and record its fingerprint').toBe(
      algorithmsFingerprint()
    );
  });
});

describe.skipIf(!hasTestDb)('PT-29: el informe guarda la configuración usada (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, {
      participants: 3,
      room: { method: 'SCHULZE', tau_threshold: 0.75, max_rounds: 4, tie_break_rule: 'LEXICOGRAPHIC', concordance_variant: 'WITHOUT_TIES' },
    });
    const orders = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) {
        await prisma.vote.create({ data: { participant_id: fx.participantIds[i], round: 1, option_id: fx.optionIds[orders[i][k]], position: k + 1 } });
      }
    }
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('dos exportes de la misma ronda indican la misma versión y configuración', async () => {
    const { processRoundConsensus } = await import('@/lib/round-processor');
    expect((await processRoundConsensus(fx!.roomId)).success).toBe(true);
    const report = await prisma.roundReport.findUniqueOrThrow({ where: { room_id_round: { room_id: fx!.roomId, round: 1 } } });
    const procedure = (report.arguments_json as unknown as { __procedure: Record<string, unknown> }).__procedure;
    expect(procedure).toEqual({
      version: PROCEDURE_VERSION,
      method: 'SCHULZE',
      tauThreshold: 0.75,
      maxRounds: 4,
      minParticipants: 3,
      tieBreakRule: 'LEXICOGRAPHIC',
      concordanceVariant: 'WITHOUT_TIES',
    });
    // Configuration changes after the round do not rewrite the stored report
    await prisma.room.update({ where: { id: fx!.roomId }, data: { tau_threshold: 0.5 } });
    const again = await prisma.roundReport.findUniqueOrThrow({ where: { id: report.id } });
    expect((again.arguments_json as unknown as { __procedure: { tauThreshold: number } }).__procedure.tauThreshold).toBe(0.75);
  });
});
