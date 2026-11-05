/**
 * frontend/__tests__/realtime/roundClosingDate.test.tsx
 * The host can set a round by duration (default) or, through a discreet link,
 * by an exact closing date and time on a calendar. The server keeps the exact
 * moment and logs which way was used.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import DurationPicker, { formatClosingMoment, toLocalInputValue } from '@/components/DurationPicker';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

const state = vi.hoisted(() => ({ hostId: null as string | null }));
vi.mock('next/headers', () => ({ headers: () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

describe('selector de plazo: la fecha de cierre no compite con la duración', () => {
  it('por defecto muestra solo las duraciones y un enlace discreto al calendario', () => {
    const html = renderToStaticMarkup(<DurationPicker value={15} onChange={() => undefined} onClosesAtChange={() => undefined} />);
    expect(html).toContain('15 min');
    expect(html).toContain('Prefiero elegir el día y la hora de cierre');
    expect(html).not.toContain('type="datetime-local"');
  });

  it('sin onClosesAtChange no ofrece el calendario', () => {
    const html = renderToStaticMarkup(<DurationPicker value={15} onChange={() => undefined} />);
    expect(html).not.toContain('Prefiero elegir el día');
  });

  it('con una fecha elegida muestra solo el calendario y cómo volver', () => {
    const closesAt = new Date(Date.now() + 3 * 86400000).toISOString();
    const html = renderToStaticMarkup(
      <DurationPicker value={15} onChange={() => undefined} closesAt={closesAt} onClosesAtChange={() => undefined} label="Duración de la Ronda 1" />
    );
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain(`value="${toLocalInputValue(new Date(closesAt))}"`);
    expect(html).toContain('Volver a elegir una duración');
    expect(html).not.toContain('15 min');
  });

  it('describe el cierre en lenguaje llano', () => {
    expect(formatClosingMoment(new Date(2026, 10, 7, 23, 59))).toBe('sábado 07/11 a las 23:59');
  });
});

describe.skipIf(!hasTestDb)('acciones con fecha de cierre (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  async function room(opts: Parameters<typeof createRoomFixture>[1]) {
    const fx = await createRoomFixture(prisma, opts);
    fixtures.push(fx);
    state.hostId = fx.hostId;
    return fx;
  }

  const inDays = (d: number) => {
    const t = new Date(Date.now() + d * 86400000);
    t.setSeconds(0, 0);
    return t;
  };

  it('iniciar con una fecha guarda exactamente esa hora límite', async () => {
    const fx = await room({ participants: 3, status: 'DRAFT', room: { deadline: null } });
    const { startRoom } = await import('@/app/actions/room');
    const closes = inDays(4);
    expect(await startRoom(fx.roomId, { closesAt: closes.toISOString() })).toEqual({ success: true });
    const r = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(r.deadline!.toISOString()).toBe(closes.toISOString());
    const ev = await prisma.roomEvent.findFirstOrThrow({ where: { room_id: fx.roomId, type: 'room_started' } });
    expect(ev.data).toMatchObject({ timing: 'date' });
    expect(Math.abs((ev.data as { minutes: number }).minutes - 4 * 1440)).toBeLessThanOrEqual(1);
  });

  it('una fecha pasada o a más de 30 días no abre la ronda', async () => {
    const fx = await room({ participants: 3, status: 'DRAFT', room: { deadline: null } });
    const { startRoom } = await import('@/app/actions/room');
    expect(await startRoom(fx.roomId, { closesAt: inDays(-1).toISOString() })).toMatchObject({
      success: false,
      error: 'La hora de cierre tiene que ser al menos un minuto después de ahora.',
    });
    expect(await startRoom(fx.roomId, { closesAt: inDays(31).toISOString() })).toMatchObject({
      success: false,
      error: 'La ronda puede durar hasta 30 días.',
    });
    expect((await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } })).status).toBe('DRAFT');
  });

  it('la duración sigue funcionando igual que antes', async () => {
    const fx = await room({ participants: 3, status: 'DRAFT', room: { deadline: null } });
    const { startRoom } = await import('@/app/actions/room');
    const before = Date.now();
    expect(await startRoom(fx.roomId, 30)).toEqual({ success: true });
    const r = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(Math.abs(r.deadline!.getTime() - (before + 30 * 60000))).toBeLessThan(5000);
    const ev = await prisma.roomEvent.findFirstOrThrow({ where: { room_id: fx.roomId, type: 'room_started' } });
    expect(ev.data).toEqual({ minutes: 30, timing: 'duration' });
  });

  it('extender con una fecha: tiene que ser posterior a la hora límite actual', async () => {
    const current = inDays(2);
    const fx = await room({ participants: 3, status: 'ROUND_OPEN', room: { deadline: current } });
    const { extendDeadline } = await import('@/app/actions/room');
    expect(await extendDeadline(fx.roomId, { closesAt: inDays(1).toISOString() })).toMatchObject({
      success: false,
      error: 'La hora de cierre tiene que ser al menos un minuto después de la hora límite actual.',
    });
    const later = inDays(5);
    expect(await extendDeadline(fx.roomId, { closesAt: later.toISOString() })).toEqual({ success: true });
    const r = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(r.deadline!.toISOString()).toBe(later.toISOString());
    const ev = await prisma.roomEvent.findFirstOrThrow({ where: { room_id: fx.roomId, type: 'deadline_extended' } });
    expect(ev.data).toMatchObject({ reopened: false, timing: 'date', minutes: 3 * 1440 });
  });

  it('abrir la siguiente ronda con una fecha', async () => {
    const fx = await room({ participants: 3, status: 'ROUND_FEEDBACK', room: { deadline: null, max_rounds: 3 } });
    const { openNextRound } = await import('@/app/actions/room');
    const closes = inDays(7);
    expect(await openNextRound(fx.roomId, { closesAt: closes.toISOString() })).toEqual({ success: true });
    const r = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(r).toMatchObject({ status: 'ROUND_OPEN', current_round: 2 });
    expect(r.deadline!.toISOString()).toBe(closes.toISOString());
  });
});
