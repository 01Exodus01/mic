/**
 * __tests__/integration/roomEvents.test.ts
 * PT-10: every host and participant action leaves exactly one RoomEvent, written
 * in the same transaction as the change. Events never carry ballot content.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ROOM_EVENT_TYPES } from '@mic/backend/room-events';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

const state = vi.hoisted(() => ({
  hostId: null as string | null,
  session: null as null | { participantId: string; roomId: string; nickname: string; blindCode: string },
}));

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({
  getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null),
}));
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

describe('PT-10: tipos de evento', () => {
  it('no hay tipos repetidos', () => {
    expect(new Set(ROOM_EVENT_TYPES).size).toBe(ROOM_EVENT_TYPES.length);
  });
});

describe.skipIf(!hasTestDb)('PT-10: bitácora de la sala (PostgreSQL)', () => {
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

  async function eventsOf(roomId: string) {
    return prisma.roomEvent.findMany({ where: { room_id: roomId }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
  }

  async function countNew(roomId: string, before: number, action: () => Promise<unknown>) {
    await action();
    const all = await eventsOf(roomId);
    return all.slice(before);
  }

  it('cada acción deja un evento y el flujo de estados no cambia', async () => {
    const fx = await createRoomFixture(prisma, {
      participants: 3,
      status: 'DRAFT',
      room: { tau_threshold: 0.99, max_rounds: 3 },
    });
    fixtures.push(fx);
    state.hostId = fx.hostId;
    const room = await import('@/app/actions/room');
    const participant = await import('@/app/actions/participant');

    let seen = 0;
    const step = async (action: () => Promise<{ success: boolean }>) => {
      const res = await action();
      if (!res.success) throw new Error(`acción fallida: ${JSON.stringify(res)}`);
      const all = await eventsOf(fx.roomId);
      const fresh = all.slice(seen);
      seen = all.length;
      return fresh;
    };

    expect((await step(() => room.startRoom(fx.roomId, 30))).map((e) => [e.type, e.actor, e.round])).toEqual([
      ['room_started', 'HOST', 1],
    ]);

    for (let i = 0; i < 3; i++) {
      state.session = { participantId: fx.participantIds[i], roomId: fx.roomId, nickname: `Persona ${i + 1}`, blindCode: fx.blindCodes[i] };
      const fresh = await step(() =>
        participant.submitVote(
          fx.optionIds.map((optionId, k) => ({
            optionId,
            position: ((k + i) % fx.optionIds.length) + 1,
            justification: 'Texto secreto que no debe ir a la bitácora',
          }))
        )
      );
      expect(fresh.map((e) => [e.type, e.actor, e.participant_id])).toEqual([
        ['vote_submitted', 'PARTICIPANT', fx.participantIds[i]],
      ]);
      expect(JSON.stringify(fresh[0].data)).not.toContain('secreto');
      expect(Object.keys(fresh[0].data as object).sort()).toEqual(['changed', 'reasons_against', 'reasons_for', 'version']);
    }

    expect((await step(() => room.extendDeadline(fx.roomId, 15))).map((e) => e.type)).toEqual(['deadline_extended']);
    expect((await step(() => room.resetParticipantPin(fx.roomId, fx.participantIds[0], '4321'))).map((e) => [e.type, e.participant_id])).toEqual([
      ['pin_reset', fx.participantIds[0]],
    ]);
    expect((await step(() => room.closeRoundManually(fx.roomId))).map((e) => [e.type, e.actor])).toEqual([
      ['round_closed', 'HOST'],
      ['round_processed', 'SYSTEM'],
    ]);
    expect((await step(() => room.openNextRound(fx.roomId, 30))).map((e) => [e.type, e.round])).toEqual([['round_opened', 2]]);
    expect((await step(() => room.expelParticipant(fx.roomId, fx.participantIds[2]))).map((e) => [e.type, e.round])).toEqual([
      ['participant_expelled', 2],
    ]);
    expect((await step(() => room.closeRoundManually(fx.roomId))).map((e) => [e.type, e.round])).toEqual([
      ['round_closed', 2],
      ['insufficient_votes', 2],
    ]);
    expect((await step(() => room.cancelRoom(fx.roomId))).map((e) => e.type)).toEqual(['room_cancelled']);

    const final = await prisma.room.findUnique({ where: { id: fx.roomId } });
    expect(final?.status).toBe('CANCELLED');
    const all = await eventsOf(fx.roomId);
    expect(all.every((e) => e.created_at instanceof Date)).toBe(true);
  });

  it('una operación que falla no deja evento', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3, status: 'CONCLUDED' });
    fixtures.push(fx);
    state.hostId = fx.hostId;
    const room = await import('@/app/actions/room');
    const fresh = await countNew(fx.roomId, 0, async () => {
      expect((await room.startRoom(fx.roomId, 30)).success).toBe(false);
      expect((await room.closeRoundManually(fx.roomId)).success).toBe(false);
      expect((await room.extendDeadline(fx.roomId, 30)).success).toBe(false);
    });
    expect(fresh).toEqual([]);
  });

  it('ingresar y volver a ingresar dejan un evento cada vez', async () => {
    const fx = await createRoomFixture(prisma, { participants: 0, status: 'ROUND_OPEN' });
    fixtures.push(fx);
    const participant = await import('@/app/actions/participant');
    const first = await countNew(fx.roomId, 0, async () => {
      expect((await participant.joinRoom(fx.pin, 'Nueva Persona', '1234')).success).toBe(true);
    });
    expect(first.map((e) => [e.type, e.data])).toEqual([['participant_joined', { returning: false, device_tag: null }]]);
    const second = await countNew(fx.roomId, 1, async () => {
      expect((await participant.joinRoom(fx.pin, 'Nueva Persona', '1234')).success).toBe(true);
    });
    expect(second.map((e) => [e.type, e.data])).toEqual([['participant_joined', { returning: true, device_tag: null }]]);
    // P2.4: a refused attempt is logged with its reason, never with the PIN typed
    const wrong = await countNew(fx.roomId, 2, async () => {
      expect((await participant.joinRoom(fx.pin, 'Nueva Persona', '9999', 'a1b2c3d4e5f6')).success).toBe(false);
    });
    expect(wrong.map((e) => [e.type, e.participant_id, e.data])).toEqual([
      ['join_failed', first[0].participant_id, { reason: 'wrong_pin', mode: 'pin', device_tag: 'a1b2c3d4e5f6' }],
    ]);
  });

  it('el cierre por plazo queda registrado como del sistema', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3, status: 'ROUND_OPEN', room: { deadline: new Date(Date.now() - 1000) } });
    fixtures.push(fx);
    const { checkAndProcessExpiredDeadline } = await import('@mic/backend/round-processor');
    await checkAndProcessExpiredDeadline(fx.roomId);
    const events = await eventsOf(fx.roomId);
    expect(events.map((e) => [e.type, e.actor])).toEqual([
      ['round_closed', 'SYSTEM'],
      ['insufficient_votes', 'SYSTEM'],
    ]);
  });

  it('round_closed guarda el motivo: HOST, TIMEOUT o ALL_VOTED', async () => {
    const { processRoundConsensus, checkAndProcessExpiredDeadline, closeRoundIfAllVoted } = await import('@mic/backend/round-processor');
    const reasonOf = async (roomId: string) =>
      (await prisma.roomEvent.findFirstOrThrow({ where: { room_id: roomId, type: 'round_closed' } })).data;

    const manual = await createRoomFixture(prisma, { participants: 3 });
    fixtures.push(manual);
    state.hostId = manual.hostId;
    const room = await import('@/app/actions/room');
    await room.closeRoundManually(manual.roomId);
    expect(await reasonOf(manual.roomId)).toEqual({ reason: 'HOST' });

    const timeout = await createRoomFixture(prisma, { participants: 3, room: { deadline: new Date(Date.now() - 1000) } });
    fixtures.push(timeout);
    await checkAndProcessExpiredDeadline(timeout.roomId);
    expect(await reasonOf(timeout.roomId)).toEqual({ reason: 'TIMEOUT' });

    const early = await createRoomFixture(prisma, { participants: 3, room: { close_when_all_voted: true, tau_threshold: 0.99 } });
    fixtures.push(early);
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) {
        await prisma.vote.create({ data: { participant_id: early.participantIds[i], round: 1, option_id: early.optionIds[(k + i) % 3], position: k + 1 } });
      }
    }
    expect(await closeRoundIfAllVoted(early.roomId)).toBe(true);
    expect(await reasonOf(early.roomId)).toEqual({ reason: 'ALL_VOTED' });
    void processRoundConsensus;
  });
});
