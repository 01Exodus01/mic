/**
 * frontend/__tests__/integration/noDeadlineRounds.test.ts
 * Team request 2026-11-24: a deadline is optional. Without one the round stays
 * open until the host closes it (or everyone sent, with early close); a
 * scheduled round may have no closing time; the host can add or remove a
 * deadline while the round is open.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NO_DEADLINE } from '@mic/backend/shared/round-timing';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

const state = vi.hoisted(() => ({ hostId: null as string | null }));
vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => null,
  createParticipantSession: async () => undefined,
  clearParticipantSession: async () => undefined,
}));

const MIN = 60 * 1000;

describe.skipIf(!hasTestDb)('rondas sin hora límite (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];
  const draft = async () => {
    const fx = await createRoomFixture(prisma, { participants: 3, status: 'DRAFT', room: { deadline: null } });
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

  it('se abre sin hora límite, nada la cierra sola y el anfitrión la cierra', async () => {
    const fx = await draft();
    const room = await import('@/app/actions/room');
    expect((await room.startRoom(fx.roomId, NO_DEADLINE)).success).toBe(true);
    let saved = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(saved).toMatchObject({ status: 'ROUND_OPEN', deadline: null });
    const opened = await prisma.roomEvent.findFirstOrThrow({ where: { room_id: fx.roomId, type: 'room_started' } });
    expect(opened.data).toMatchObject({ minutes: null, timing: 'none' });

    const { checkAndProcessExpiredDeadline } = await import('@mic/backend/round-processor');
    expect(await checkAndProcessExpiredDeadline(fx.roomId)).toBe(false);
    expect((await room.closeRoundManually(fx.roomId)).success).toBe(true);
    saved = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(saved.status).not.toBe('ROUND_OPEN');
  });

  it('con la ronda abierta se puede fijar una hora límite y volver a quitarla', async () => {
    const fx = await draft();
    const room = await import('@/app/actions/room');
    await room.startRoom(fx.roomId, NO_DEADLINE);
    expect((await room.extendDeadline(fx.roomId, 30)).success).toBe(true);
    const withDeadline = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(withDeadline.deadline!.getTime() - Date.now()).toBeGreaterThan(29 * MIN);
    expect((await room.extendDeadline(fx.roomId, NO_DEADLINE)).success).toBe(true);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } })).deadline).toBeNull();
  });

  it('una ronda programada sin hora de cierre se abre sola y queda sin hora límite', async () => {
    const fx = await draft();
    const room = await import('@/app/actions/room');
    const opensAt = new Date(Date.now() + 5 * MIN);
    const res = await room.scheduleRound(fx.roomId, { opensAt: opensAt.toISOString(), timing: NO_DEADLINE });
    expect(res).toEqual({ success: true, data: { opensAt: opensAt.toISOString(), deadline: null } });
    const { openScheduledRoundIfDue } = await import('@mic/backend/round-schedule');
    expect(await openScheduledRoundIfDue(fx.roomId, new Date(opensAt.getTime() + 1000))).toBe(true);
    expect(await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } })).toMatchObject({ status: 'ROUND_OPEN', deadline: null });
  });
});
