/**
 * frontend/__tests__/security/removeAndReinstate.test.ts
 * Removing a participant (open PIN rooms) frees their seat and their name;
 * the host can bring the same participant back ("Reincorporar") with the same
 * blind code and history, if there is a free seat and the name is still free.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

type Session = { participantId: string; roomId: string; nickname: string; blindCode: string };
const state = vi.hoisted(() => ({ hostId: null as string | null, session: null as Session | null }));

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => state.session,
  createParticipantSession: async (p: Session) => {
    state.session = p;
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

describe.skipIf(!hasTestDb)('retirar y reincorporar participantes (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  /** Room of `max` seats, full, with names Ana / Beto / Caro and PIN 1234 */
  async function fullRoom(max = 3) {
    const fx = await createRoomFixture(prisma, { participants: max, status: 'ROUND_OPEN', room: { max_members: max, allow_late_join: true } });
    fixtures.push(fx);
    const names = ['Ana', 'Beto', 'Caro', 'Dani'];
    const hash = await bcrypt.hash('1234', 10);
    for (let i = 0; i < max; i++) {
      await prisma.participant.update({ where: { id: fx.participantIds[i] }, data: { nickname: names[i], pin_hash: hash } });
    }
    state.hostId = fx.hostId;
    return fx;
  }

  it('retirar libera el cupo y el nombre: la persona real entra con ese nombre como alguien nuevo', async () => {
    const fx = await fullRoom();
    const room = await import('@/app/actions/room');
    const p = await import('@/app/actions/participant');

    // Full room: nobody new fits
    expect((await p.joinRoom(fx.pin, 'Eva', '5678')).success).toBe(false);

    // "Ana" was a troll: removed
    expect((await room.expelParticipant(fx.roomId, fx.participantIds[0])).success).toBe(true);
    const troll = await prisma.participant.findUniqueOrThrow({ where: { id: fx.participantIds[0] } });
    expect(troll).toMatchObject({ is_retired: true, retired_nickname: 'Ana' });
    expect(troll.nickname.startsWith('~')).toBe(true);

    // The real Ana joins with her name and her own PIN: a new participant with its own code
    state.session = null;
    const joined = await p.joinRoom(fx.pin, 'Ana', '9999');
    expect(joined.success).toBe(true);
    const realAna = await prisma.participant.findFirstOrThrow({ where: { room_id: fx.roomId, nickname: 'Ana' } });
    expect(realAna.id).not.toBe(troll.id);
    expect(realAna.blind_code).not.toBe(troll.blind_code);
    // The troll's PIN no longer opens that name
    expect((await p.joinRoom(fx.pin, 'Ana', '1234')).success).toBe(false);
    // The troll keeps its data (votes, code) as an excluded participant
    expect(await prisma.participant.count({ where: { room_id: fx.roomId } })).toBe(4);
  });

  it('reincorporar devuelve a la misma persona con su nombre, si hay cupo y nadie tomó el nombre', async () => {
    const fx = await fullRoom();
    const room = await import('@/app/actions/room');
    const p = await import('@/app/actions/participant');
    const beto = fx.participantIds[1];
    await room.expelParticipant(fx.roomId, beto);

    // Shown to the host with the name they had
    const status = await room.getRoomStatus(fx.roomId);
    if (!status.success) throw new Error(status.error);
    expect(status.data!.room.removedParticipants).toEqual([{ id: beto, nickname: 'Beto' }]);

    // Someone else took the free seat: no seat for Beto
    expect((await p.joinRoom(fx.pin, 'Eva', '5678')).success).toBe(true);
    expect(await room.reinstateParticipant(fx.roomId, beto)).toMatchObject({
      success: false,
      error: 'No hay cupos libres en la sala para reincorporar a esta persona.',
    });

    // A seat frees up: Beto comes back as himself (same blind code)
    const eva = await prisma.participant.findFirstOrThrow({ where: { room_id: fx.roomId, nickname: 'Eva' } });
    await room.expelParticipant(fx.roomId, eva.id);
    expect(await room.reinstateParticipant(fx.roomId, beto)).toMatchObject({ success: true, data: { activeCount: 3 } });
    const back = await prisma.participant.findUniqueOrThrow({ where: { id: beto } });
    expect(back).toMatchObject({ is_retired: false, nickname: 'Beto', retired_nickname: null, blind_code: fx.blindCodes[1] });
    state.session = null;
    expect((await p.joinRoom(fx.pin, 'Beto', '1234')).success).toBe(true);
    expect(state.session).toMatchObject({ participantId: beto });

    const ev = await prisma.roomEvent.findFirst({ where: { room_id: fx.roomId, type: 'participant_reinstated' } });
    expect(ev).toMatchObject({ participant_id: beto, actor: 'HOST' });
  });

  it('no reincorpora si otra persona ya usa ese nombre', async () => {
    const fx = await fullRoom();
    const room = await import('@/app/actions/room');
    const p = await import('@/app/actions/participant');
    await room.expelParticipant(fx.roomId, fx.participantIds[2]);
    expect((await p.joinRoom(fx.pin, 'caro', '5678')).success).toBe(true);
    const other = await prisma.participant.findFirstOrThrow({ where: { room_id: fx.roomId, nickname: 'caro' } });
    await room.expelParticipant(fx.roomId, fx.participantIds[0]); // a free seat, but the name is taken
    expect(await room.reinstateParticipant(fx.roomId, fx.participantIds[2])).toMatchObject({
      success: false,
      error: 'El nombre Caro ya lo usa otra persona en la sala; no se puede reincorporar.',
    });
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: other.id } })).is_retired).toBe(false);
  });

  it('solo el anfitrión de la sala, solo mientras la actividad sigue y solo en salas con nombre', async () => {
    const fx = await fullRoom();
    const room = await import('@/app/actions/room');
    await room.expelParticipant(fx.roomId, fx.participantIds[0]);
    state.hostId = 'otro-anfitrion';
    expect((await room.reinstateParticipant(fx.roomId, fx.participantIds[0])).success).toBe(false);
    state.hostId = fx.hostId;
    await prisma.room.update({ where: { id: fx.roomId }, data: { status: 'CONCLUDED' } });
    expect((await room.reinstateParticipant(fx.roomId, fx.participantIds[0])).success).toBe(false);
    await prisma.room.update({ where: { id: fx.roomId }, data: { status: 'ROUND_OPEN', access_mode: 'ROSTER' } });
    expect(await room.reinstateParticipant(fx.roomId, fx.participantIds[0])).toMatchObject({
      success: false,
      error: 'En salas con lista, vuelve a agregar a la persona desde la lista.',
    });
  });
});
