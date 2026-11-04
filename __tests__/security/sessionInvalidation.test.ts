/**
 * __tests__/security/sessionInvalidation.test.ts
 * Resetting a participant's PIN (or regenerating a roster code) signs out the
 * sessions opened before: Participant.session_version goes up and older
 * session cookies get SESSION_EXPIRED instead of staying valid until expiry.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { generateMemberCode, hashMemberCode } from '@/lib/member-codes';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

type Session = { participantId: string; roomId: string; nickname: string; blindCode: string; sessionVersion?: number };
const state = vi.hoisted(() => ({ hostId: null as string | null, session: null as Session | null, created: [] as Session[] }));
vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => state.session,
  createParticipantSession: async (p: Session) => {
    state.created.push(p);
  },
  clearParticipantSession: async () => undefined,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

describe.skipIf(!hasTestDb)('Sesión invalidada al cambiar el acceso (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('restablecer el PIN cierra la sesión anterior; con el PIN nuevo se vuelve a entrar', async () => {
    const fx = await createRoomFixture(prisma, { participants: 0 });
    fixtures.push(fx);
    state.hostId = fx.hostId;
    const p = await import('@/app/actions/participant');
    const room = await import('@/app/actions/room');

    expect((await p.joinRoom(fx.pin, 'Persona Uno', '1234')).success).toBe(true);
    const oldSession = state.created[state.created.length - 1];
    expect(oldSession.sessionVersion).toBe(0);
    state.session = oldSession;
    expect((await p.getParticipantRoomView()).success).toBe(true);

    expect((await room.resetParticipantPin(fx.roomId, oldSession.participantId, '9876')).success).toBe(true);
    expect(await p.getParticipantRoomView()).toMatchObject({ success: false, code: 'SESSION_EXPIRED' });
    expect(await p.submitVote(fx.optionIds.map((optionId, i) => ({ optionId, position: i + 1 })))).toMatchObject({ success: false, code: 'SESSION_EXPIRED' });
    const sync = await import('@/app/api/rooms/[id]/sync/route');
    state.hostId = null;
    expect((await sync.GET(new NextRequest('http://localhost/api'), { params: { id: fx.roomId } })).status).toBe(401);

    expect((await p.joinRoom(fx.pin, 'Persona Uno', '1234')).success).toBe(false);
    expect((await p.joinRoom(fx.pin, 'Persona Uno', '9876')).success).toBe(true);
    state.session = state.created[state.created.length - 1];
    expect(state.session.sessionVersion).toBe(1);
    expect((await p.getParticipantRoomView()).success).toBe(true);
  });

  it('regenerar el código de una persona de la lista cierra su sesión anterior', async () => {
    const fx = await createRoomFixture(prisma, { participants: 0, room: { access_mode: 'ROSTER' } });
    fixtures.push(fx);
    state.hostId = fx.hostId;
    const code = generateMemberCode();
    const member = await prisma.roomMember.create({ data: { room_id: fx.roomId, label: 'A001', access_code_hash: hashMemberCode(code) } });
    const p = await import('@/app/actions/participant');
    const room = await import('@/app/actions/room');

    expect((await p.joinRoomWithCode(fx.pin, code)).success).toBe(true);
    state.session = state.created[state.created.length - 1];
    expect((await p.getParticipantRoomView()).success).toBe(true);

    const regen = await room.regenerateMemberCode(fx.roomId, member.id);
    expect(regen.success).toBe(true);
    expect(await p.getParticipantRoomView()).toMatchObject({ success: false, code: 'SESSION_EXPIRED' });
    expect((await p.joinRoomWithCode(fx.pin, code)).success).toBe(false);
    expect((await p.joinRoomWithCode(fx.pin, regen.success ? regen.data!.issued.code : '')).success).toBe(true);
    state.session = state.created[state.created.length - 1];
    expect((await p.getParticipantRoomView()).success).toBe(true);
  });
});
