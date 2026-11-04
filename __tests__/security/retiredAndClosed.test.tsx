/**
 * __tests__/security/retiredAndClosed.test.tsx
 * Edge cases with the vote screen open:
 *  - expelled participant: clear "Fuiste retirado de la sala" (RETIRED), on the
 *    view, on submitVote and on the sync endpoint;
 *  - round closed while the client timer still showed time: ROOM_CLOSED with
 *    "La votación ya se cerró", ballot not stored.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import RetiredNotice from '@/components/RetiredNotice';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

const state = vi.hoisted(() => ({
  hostId: null as string | null,
  session: null as null | { participantId: string; roomId: string; nickname: string; blindCode: string },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => state.session,
  createParticipantSession: async () => undefined,
  clearParticipantSession: async () => undefined,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

describe('Aviso de retiro', () => {
  it('dice con claridad que fue retirado y ofrece salir', () => {
    const html = renderToStaticMarkup(<RetiredNotice />);
    expect(html).toContain('Fuiste retirado de la sala');
    expect(html).toContain('Salir');
    expect(html).toContain('role="alert"');
  });
});

describe.skipIf(!hasTestDb)('Pantalla de voto abierta (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  const ballot = (fx: RoomFixture) => fx.optionIds.map((optionId, i) => ({ optionId, position: i + 1 }));

  it('expulsado con la pantalla abierta: vista, voto y sincronización responden RETIRED', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3 });
    fixtures.push(fx);
    state.hostId = fx.hostId;
    state.session = { participantId: fx.participantIds[0], roomId: fx.roomId, nickname: 'x', blindCode: fx.blindCodes[0] };
    const { expelParticipant } = await import('@/app/actions/room');
    const { getParticipantRoomView, submitVote } = await import('@/app/actions/participant');
    await expelParticipant(fx.roomId, fx.participantIds[0]);

    const view = await getParticipantRoomView();
    expect(view).toMatchObject({ success: false, code: 'RETIRED', error: 'Fuiste retirado de la sala. Tus votos anteriores se conservan.' });
    expect(await submitVote(ballot(fx))).toMatchObject({ success: false, code: 'RETIRED' });

    state.hostId = null;
    const sync = await import('@/app/api/rooms/[id]/sync/route');
    const res = await sync.GET(new NextRequest('http://localhost/api'), { params: { id: fx.roomId } });
    expect((await res.json()).isRetired).toBe(true);
  });

  it('ronda cerrada mientras el cronómetro mostraba tiempo: mensaje claro y voto no guardado', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3 });
    fixtures.push(fx);
    state.session = { participantId: fx.participantIds[1], roomId: fx.roomId, nickname: 'x', blindCode: fx.blindCodes[1] };
    await prisma.room.update({ where: { id: fx.roomId }, data: { status: 'PROCESSING' } });
    const { submitVote } = await import('@/app/actions/participant');
    expect(await submitVote(ballot(fx))).toMatchObject({
      success: false,
      code: 'ROOM_CLOSED',
      error: 'La votación ya se cerró. Tu voto no se guardó.',
    });
    expect(await prisma.vote.count({ where: { participant_id: fx.participantIds[1] } })).toBe(0);
  });
});
