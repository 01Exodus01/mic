/**
 * frontend/__tests__/security/concludedRoomJoin.test.ts
 * A finished room stays reachable for the people who took part, so they can
 * see the final results (open PIN and roster). Nobody new can join it.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateMemberCode, hashMemberCode } from '@mic/backend/shared/member-codes';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

type Session = { participantId: string; roomId: string; nickname: string; blindCode: string };
const state = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => null }));
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

const ENDED = 'La actividad ya terminó. Solo pueden entrar quienes participaron, para ver los resultados finales.';

describe.skipIf(!hasTestDb)('sala finalizada: reingreso para ver resultados (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('con PIN: quien participó vuelve a entrar; alguien nuevo no', async () => {
    const fx = await createRoomFixture(prisma, { participants: 2, status: 'CONCLUDED' });
    fixtures.push(fx);
    await prisma.participant.update({ where: { id: fx.participantIds[0] }, data: { nickname: 'Ana', pin_hash: await bcrypt.hash('1234', 10) } });
    const p = await import('@/app/actions/participant');

    const verified = await p.verifyRoomPin(fx.pin);
    expect(verified).toMatchObject({ success: true, data: { concluded: true } });
    expect(await p.checkNicknameInRoom(fx.pin, 'Ana')).toMatchObject({ success: true, data: { exists: true } });
    expect(await p.checkNicknameInRoom(fx.pin, 'Nadie')).toEqual({ success: false, error: ENDED });

    state.session = null;
    expect(await p.joinRoom(fx.pin, 'Ana', '1234')).toMatchObject({ success: true });
    expect(state.session).toMatchObject({ participantId: fx.participantIds[0] });
    expect(await p.joinRoom(fx.pin, 'Nadie', '1234')).toMatchObject({ success: false, error: ENDED });
    expect(await prisma.participant.count({ where: { room_id: fx.roomId } })).toBe(2);
    const refused = await prisma.roomEvent.findFirst({ where: { room_id: fx.roomId, type: 'join_failed' } });
    expect(refused?.data).toMatchObject({ reason: 'room_concluded' });

    // The returning participant sees the room as finished (final results)
    const view = await p.getParticipantRoomView();
    if (!view.success) throw new Error(view.error);
    expect(view.data?.sala.status).toBe('CONCLUDED');
  });

  it('con lista: el código de quien participó funciona; uno sin usar no crea a nadie', async () => {
    const fx = await createRoomFixture(prisma, { participants: 0, status: 'ROUND_OPEN', room: { access_mode: 'ROSTER' } });
    fixtures.push(fx);
    const used = generateMemberCode();
    const unused = generateMemberCode();
    await prisma.roomMember.create({ data: { room_id: fx.roomId, label: 'A1', access_code_hash: hashMemberCode(used) } });
    await prisma.roomMember.create({ data: { room_id: fx.roomId, label: 'A2', access_code_hash: hashMemberCode(unused) } });
    const p = await import('@/app/actions/participant');
    expect((await p.joinRoomWithCode(fx.pin, used)).success).toBe(true);
    await prisma.room.update({ where: { id: fx.roomId }, data: { status: 'CONCLUDED' } });

    expect((await p.joinRoomWithCode(fx.pin, used)).success).toBe(true);
    expect((await p.joinRoomWithCode(fx.pin, unused)).success).toBe(false);
    expect(await prisma.participant.count({ where: { room_id: fx.roomId } })).toBe(1);
  });

  it('una sala cancelada sigue cerrada para todos', async () => {
    const fx = await createRoomFixture(prisma, { participants: 1, status: 'CANCELLED' });
    fixtures.push(fx);
    const p = await import('@/app/actions/participant');
    expect((await p.verifyRoomPin(fx.pin)).success).toBe(false);
  });
});
