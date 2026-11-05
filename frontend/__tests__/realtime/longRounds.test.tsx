/**
 * __tests__/realtime/longRounds.test.tsx
 * PT-28: rounds of up to 30 days. Days and weeks in the picker, readable
 * multi-day countdown, create and extend a 14-day round, the deadline closes it.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import DurationPicker, { formatCountdown, formatDeadlineLabel } from '@/components/DurationPicker';
import { MAX_ROUND_MINUTES, RoundDurationSchema } from '@mic/backend/shared/validations';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

const state = vi.hoisted(() => ({ hostId: null as string | null }));
vi.mock('next/headers', () => ({ headers: () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

describe('PT-28: plazos largos', () => {
  it('el máximo es 30 días', () => {
    expect(MAX_ROUND_MINUTES).toBe(43200);
    expect(RoundDurationSchema.safeParse(14 * 1440).success).toBe(true);
  });

  it('el selector ofrece días y semanas', () => {
    const html = renderToStaticMarkup(<DurationPicker value={20160} onChange={() => undefined} />);
    expect(html).toContain('3 días');
    expect(html).toContain('1 semana');
    expect(html).toContain('2 semanas');
    const custom = renderToStaticMarkup(<DurationPicker value={14 * 1440 + 0} onChange={() => undefined} />);
    expect(custom).toContain('2 semanas');
    const odd = renderToStaticMarkup(<DurationPicker value={5 * 1440} onChange={() => undefined} />);
    expect(odd).toContain('<option value="d" selected="">días</option>');
    expect(odd).toContain('value="5"');
  });

  it('la cuenta regresiva se lee bien con varios días', () => {
    expect(formatCountdown(((2 * 24 + 3) * 3600 + 15 * 60 + 20) * 1000)).toBe('2 d 03:15:20');
    expect(formatCountdown((3600 + 5 * 60 + 9) * 1000)).toBe('1:05:09');
    expect(formatCountdown(299_000)).toBe('04:59');
    expect(formatCountdown(-5)).toBe('00:00');
  });

  it('la hora límite muestra la fecha si no es hoy', () => {
    const now = new Date(2026, 10, 4, 10, 0);
    expect(formatDeadlineLabel(new Date(2026, 10, 4, 18, 30), now)).not.toMatch(/\//);
    expect(formatDeadlineLabel(new Date(2026, 10, 18, 18, 30), now)).toMatch(/18/);
  });
});

describe.skipIf(!hasTestDb)('PT-28: ronda de 14 días (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, { participants: 3, status: 'DRAFT' });
    state.hostId = fx.hostId;
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('se crea y se extiende a 14 días, y al vencer se cierra', async () => {
    const room = await import('@/app/actions/room');
    const fourteenDays = 14 * 1440;
    const before = Date.now();
    expect((await room.startRoom(fx!.roomId, fourteenDays)).success).toBe(true);
    let r = await prisma.room.findUniqueOrThrow({ where: { id: fx!.roomId } });
    expect(r.deadline!.getTime() - before).toBeGreaterThanOrEqual(fourteenDays * 60000 - 5000);

    expect((await room.extendDeadline(fx!.roomId, fourteenDays)).success).toBe(true);
    r = await prisma.room.findUniqueOrThrow({ where: { id: fx!.roomId } });
    expect(r.deadline!.getTime() - before).toBeGreaterThanOrEqual(2 * fourteenDays * 60000 - 5000);
    expect((await room.extendDeadline(fx!.roomId, MAX_ROUND_MINUTES + 1)).success).toBe(false);

    // Simulate the deadline passing: the worker/lazy check closes the round
    await prisma.room.update({ where: { id: fx!.roomId }, data: { deadline: new Date(Date.now() - 1000) } });
    const { checkAndProcessExpiredDeadline } = await import('@mic/backend/round-processor');
    expect(await checkAndProcessExpiredDeadline(fx!.roomId)).toBe(true);
    r = await prisma.room.findUniqueOrThrow({ where: { id: fx!.roomId } });
    expect(r.status).toBe('INSUFFICIENT_VOTES');
  });
});
