/**
 * __tests__/integration/telemetry.test.ts
 * Plan de mejora P2.1–P2.4: usability events from the participant screens and
 * refused joins. Events carry ids, counts and durations; never typed text,
 * PINs or codes.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ClientEventBatchSchema } from '@mic/backend/shared/telemetry-events';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

const state = vi.hoisted(() => ({
  session: null as null | { participantId: string; roomId: string; nickname: string; blindCode: string; sessionVersion?: number },
}));

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => null }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => state.session,
  createParticipantSession: async (payload: typeof state.session) => {
    state.session = payload;
  },
  clearParticipantSession: async () => undefined,
}));
vi.mock('@mic/backend/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

describe('P2: esquema de eventos del cliente', () => {
  it('rechaza un tiempo visible de 0 ms: una carga automática no es lectura', () => {
    const zero = { events: [{ type: 'report_read', report_round: 1, surface: 'feedback', visible_ms: 0, sections_opened: 0 }] };
    expect(ClientEventBatchSchema.safeParse(zero).success).toBe(false);
  });

  it('descarta cualquier texto que llegue junto a un evento de razones', () => {
    const parsed = ClientEventBatchSchema.parse({
      events: [{ type: 'reason_typing_started', option_id: 'opt1', side: 'for', text: 'lo que escribió' }],
    });
    expect(parsed.events[0]).toEqual({ type: 'reason_typing_started', option_id: 'opt1', side: 'for' });
  });

  it('rechaza tipos desconocidos y lotes vacíos o demasiado grandes', () => {
    expect(ClientEventBatchSchema.safeParse({ events: [{ type: 'vote_submitted' }] }).success).toBe(false);
    expect(ClientEventBatchSchema.safeParse({ events: [] }).success).toBe(false);
    const many = Array.from({ length: 26 }, () => ({ type: 'ballot_viewed', editing: false }));
    expect(ClientEventBatchSchema.safeParse({ events: many }).success).toBe(false);
  });
});

describe.skipIf(!hasTestDb)('P2: telemetría registrada (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DB_URL;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  async function room(opts: Parameters<typeof createRoomFixture>[1]) {
    const fx = await createRoomFixture(prisma, opts);
    fixtures.push(fx);
    return fx;
  }

  it('guarda los eventos con la ronda actual y report_round va a su propia columna del export', async () => {
    const fx = await room({ participants: 2, status: 'ROUND_OPEN', room: { current_round: 2 } });
    const p = { id: fx.participantIds[0] };
    const { recordClientEvents } = await import('@mic/backend/telemetry/record');
    const outcome = await recordClientEvents(prisma, { participantId: p.id, roomId: fx.roomId }, {
      events: [
        { type: 'ballot_viewed', editing: false },
        { type: 'ranking_reordered', method: 'buttons', option_id: fx.optionIds[1], from_position: 2, to_position: 1, reorder_index: 1 },
        { type: 'reason_field_added', option_id: fx.optionIds[0], side: 'against' },
        { type: 'reason_typing_started', option_id: fx.optionIds[0], side: 'against' },
        { type: 'report_section_opened', report_round: 1, surface: 'vote', option_id: fx.optionIds[0] },
        { type: 'report_read', report_round: 1, surface: 'vote', visible_ms: 4200, sections_opened: 1 },
      ],
    });
    expect(outcome).toBe('ok');
    const events = await prisma.roomEvent.findMany({ where: { room_id: fx.roomId }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
    expect(events.map((e) => e.type)).toEqual([
      'ballot_viewed',
      'ranking_reordered',
      'reason_field_added',
      'reason_typing_started',
      'report_section_opened',
      'report_read',
    ]);
    expect(events.every((e) => e.round === 2 && e.participant_id === p.id && e.actor === 'PARTICIPANT')).toBe(true);

    const { loadExportDataset } = await import('@mic/backend/export/dataset');
    const { buildExportTables } = await import('@mic/backend/export/tables');
    const ds = await loadExportDataset(prisma, fx.roomId);
    const csv = buildExportTables(ds!).find((t) => t.name === 'events.csv')!;
    const col = (name: string) => csv.headers.indexOf(name);
    const read = csv.rows.find((r) => r[col('type')] === 'report_read')!;
    expect(read[col('report_round')]).toBe(1);
    expect(read[col('visible_ms')]).toBe(4200);
    expect(csv.headers).not.toContain('report_round_1');
    expect(csv.headers.filter((h) => h === 'report_round')).toHaveLength(1);
  });

  it('un lote enviado tarde conserva el momento en que ocurrió cada evento', async () => {
    const fx = await room({ participants: 1, status: 'ROUND_OPEN' });
    const { recordClientEvents } = await import('@mic/backend/telemetry/record');
    const before = Date.now();
    const outcome = await recordClientEvents(prisma, { participantId: fx.participantIds[0], roomId: fx.roomId }, {
      events: [
        { type: 'ballot_viewed', editing: false },
        { type: 'reason_field_added', option_id: fx.optionIds[0], side: 'for' },
      ],
      ages_ms: [5000, 1000],
    });
    expect(outcome).toBe('ok');
    const [viewed, added] = await prisma.roomEvent.findMany({ where: { room_id: fx.roomId }, orderBy: { created_at: 'asc' } });
    expect(viewed.type).toBe('ballot_viewed');
    expect(added.created_at.getTime() - viewed.created_at.getTime()).toBe(4000);
    expect(before - viewed.created_at.getTime()).toBeGreaterThanOrEqual(4000);
    // ages must match the events one to one
    expect(
      await recordClientEvents(prisma, { participantId: fx.participantIds[0], roomId: fx.roomId }, {
        events: [{ type: 'ballot_viewed', editing: true }],
        ages_ms: [1, 2],
      })
    ).toBe('invalid');
  });

  it('no acepta eventos sin sesión, con sesión vencida o de un participante retirado', async () => {
    const fx = await room({ participants: 2, status: 'ROUND_OPEN' });
    const [p, q] = fx.participantIds.map((id) => ({ id }));
    const { recordClientEvents } = await import('@mic/backend/telemetry/record');
    const batch = { events: [{ type: 'ballot_viewed', editing: false }] };
    expect(await recordClientEvents(prisma, null, batch)).toBe('unauthorized');
    await prisma.participant.update({ where: { id: p.id }, data: { session_version: 1 } });
    expect(await recordClientEvents(prisma, { participantId: p.id, roomId: fx.roomId, sessionVersion: 0 }, batch)).toBe('unauthorized');
    await prisma.participant.update({ where: { id: q.id }, data: { is_retired: true } });
    expect(await recordClientEvents(prisma, { participantId: q.id, roomId: fx.roomId }, batch)).toBe('unauthorized');
    expect(await recordClientEvents(prisma, { participantId: p.id, roomId: fx.roomId, sessionVersion: 1 }, { events: 'x' })).toBe('invalid');
    expect(await prisma.roomEvent.count({ where: { room_id: fx.roomId } })).toBe(0);
  });

  it('el envío del voto registra cuántas razones se mandaron, sin su texto', async () => {
    const fx = await room({ participants: 2, status: 'ROUND_OPEN' });
    state.session = { participantId: fx.participantIds[0], roomId: fx.roomId, nickname: 'Persona 1', blindCode: fx.blindCodes[0] };
    const { submitVote } = await import('@/app/actions/participant');
    const res = await submitVote(
      fx.optionIds.map((optionId, i) => ({
        optionId,
        position: i + 1,
        reasonsFor: i === 0 ? ['razón secreta uno', 'razón secreta dos'] : [],
        reasonsAgainst: i === 1 ? ['razón secreta tres'] : [],
      }))
    );
    expect(res.success).toBe(true);
    const ev = await prisma.roomEvent.findFirstOrThrow({ where: { room_id: fx.roomId, type: 'vote_submitted' } });
    expect(ev.data).toMatchObject({ reasons_for: 2, reasons_against: 1 });
    expect(JSON.stringify(ev.data)).not.toContain('secreta');
  });

  it('un código de lista inválido queda como join_failed con la etiqueta del dispositivo, sin el código', async () => {
    const fx = await room({ participants: 0, status: 'ROUND_OPEN', room: { access_mode: 'ROSTER' } });
    const { joinRoomWithCode } = await import('@/app/actions/participant');
    const { generateMemberCode } = await import('@mic/backend/shared/member-codes');
    const code = generateMemberCode();
    expect((await joinRoomWithCode(fx.pin, code, '0123456789ab')).success).toBe(false);
    expect((await joinRoomWithCode(fx.pin, 'corto', 'no-es-una-etiqueta')).success).toBe(false);
    const events = await prisma.roomEvent.findMany({ where: { room_id: fx.roomId }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
    expect(events.map((e) => [e.type, e.participant_id, e.data])).toEqual([
      ['join_failed', null, { reason: 'invalid_code', mode: 'roster', device_tag: '0123456789ab' }],
      ['join_failed', null, { reason: 'invalid_code', mode: 'roster', device_tag: null }],
    ]);
    expect(JSON.stringify(events.map((e) => e.data))).not.toContain(code);
  });
});
