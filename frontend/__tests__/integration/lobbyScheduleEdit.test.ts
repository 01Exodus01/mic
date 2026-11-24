/**
 * frontend/__tests__/integration/lobbyScheduleEdit.test.ts
 * Team request 2026-11-24:
 *  - participants join before round 1 (lobby) and get no options yet;
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { generateMemberCode, hashMemberCode } from '@mic/backend/shared/member-codes';
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

describe.skipIf(!hasTestDb)('lobby (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];
  const draft = async (room: Record<string, unknown> = {}, participants = 0) => {
    const fx = await createRoomFixture(prisma, { participants, status: 'DRAFT', room: { deadline: null, ...room } });
    fixtures.push(fx);
    state.hostId = fx.hostId;
    return fx;
  };

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('lobby con PIN: se entra antes de la Ronda 1 y todavía no se ven las opciones', async () => {
    const fx = await draft();
    const p = await import('@/app/actions/participant');
    expect((await p.verifyRoomPin(fx.pin)).success).toBe(true);
    const joined = await p.joinRoom(fx.pin, 'Ana', '1234');
    expect(joined.success).toBe(true);
    const view = await p.getParticipantRoomView();
    if (!view.success || !view.data) throw new Error('view failed');
    expect(view.data.sala.status).toBe('DRAFT');
    expect(view.data.options).toEqual([]);
    // Nothing can be sent until the round opens
    const vote = await p.submitVote(fx.optionIds.map((optionId, k) => ({ optionId, position: k + 1 })));
    expect(vote.success).toBe(false);
    // The host sees who is waiting
    const { getRoomStatus } = await import('@/app/actions/room');
    const status = await getRoomStatus(fx.roomId);
    expect(status.success && status.data?.room.participants.map((x) => x.nickname)).toEqual(['Ana']);
  });

  it('lobby con lista: se entra con el código personal antes de la Ronda 1', async () => {
    const fx = await draft({ access_mode: 'ROSTER' });
    const code = generateMemberCode();
    await prisma.roomMember.create({ data: { room_id: fx.roomId, label: 'A001', access_code_hash: hashMemberCode(code) } });
    const p = await import('@/app/actions/participant');
    expect((await p.joinRoomWithCode(fx.pin, code)).success).toBe(true);
    const member = await prisma.roomMember.findFirstOrThrow({ where: { room_id: fx.roomId } });
    expect(member.participant_id).not.toBeNull();
  });
});
