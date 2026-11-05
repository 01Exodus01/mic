/**
 * __tests__/security/hostParticipation.test.tsx
 * PT-25: the host sees, per person and round, only participation states;
 * responses carry no positions, reasons, blind codes or individual cix.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ParticipationGrid } from '@/components/ParticipationTable';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

const state = vi.hoisted(() => ({
  hostId: null as string | null,
  session: null as null | { participantId: string; roomId: string; nickname: string; blindCode: string },
}));

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => state.session,
  createParticipantSession: async () => undefined,
  clearParticipantSession: async () => undefined,
}));
vi.mock('@mic/backend/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

describe('PT-25: tabla', () => {
  it('muestra solo estados por ronda', () => {
    const html = renderToStaticMarkup(
      <ParticipationGrid data={{ rounds: [1, 2], rows: [{ key: 'a', name: 'A001', states: ['voted', 'joined'] }] }} />
    );
    expect(html).toContain('Ronda 2');
    expect(html).toContain('Envió');
    expect(html).toContain('Ingresó');
  });
});

describe.skipIf(!hasTestDb)('PT-25: participación por ronda (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, { participants: 4, room: { access_mode: 'ROSTER', tau_threshold: 0.99, allow_late_join: true } });
    state.hostId = fx.hostId;
    const labels = ['A001', 'A002', 'A003', 'A004', 'A005', 'A006'];
    for (let i = 0; i < labels.length; i++) {
      await prisma.roomMember.create({
        data: { room_id: fx.roomId, label: labels[i], access_code_hash: `${i}`.repeat(64), participant_id: fx.participantIds[i] ?? null, is_removed: i === 5 },
      });
    }
    const { submitVote } = await import('@/app/actions/participant');
    const vote = async (i: number, reasons = false) => {
      state.session = { participantId: fx!.participantIds[i], roomId: fx!.roomId, nickname: 'x', blindCode: fx!.blindCodes[i] };
      const res = await submitVote(
        fx!.optionIds.map((optionId, k) => ({ optionId, position: ((k + i) % 3) + 1, reasonsFor: reasons ? ['Razón secreta del voto'] : [] }))
      );
      expect(res.success).toBe(true);
    };
    // Round 1: A001, A002, A003 vote; A004 joined but did not vote
    await vote(0, true);
    await vote(1);
    await vote(2);
    const room = await import('@/app/actions/room');
    await room.closeRoundManually(fx.roomId);
    await room.openNextRound(fx.roomId, 30);
    // Round 2: A001 votes, A003 is expelled
    await vote(0);
    await room.expelParticipant(fx.roomId, fx.participantIds[2]);
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('el anfitrión ve quién no votó en cada ronda', async () => {
    const { getRoomParticipation } = await import('@/app/actions/room');
    const res = await getRoomParticipation(fx!.roomId);
    if (!res.success || !res.data) throw new Error('participation failed');
    expect(res.data.rounds).toEqual([1, 2]);
    const byName = Object.fromEntries(res.data.rows.map((r) => [r.name, r.states]));
    expect(byName).toEqual({
      A001: ['voted', 'voted'],
      A002: ['voted', 'joined'],
      A003: ['voted', 'retired'],
      A004: ['not_voted', 'joined'],
      A005: ['not_joined', 'not_joined'],
      A006: ['removed', 'removed'],
    });
  });

  it('las respuestas al anfitrión no traen votos, razones, códigos ciegos ni cix', async () => {
    const { getRoomParticipation, getRoomStatus } = await import('@/app/actions/room');
    const participation = JSON.stringify(await getRoomParticipation(fx!.roomId));
    const status = JSON.stringify(await getRoomStatus(fx!.roomId));
    for (const text of [participation, status]) {
      expect(text).not.toContain('Razón secreta del voto');
      expect(text).not.toContain('__metrics');
      expect(text).not.toContain('"cix"');
      expect(text).not.toContain('Participante 0');
    }
    for (const optionId of fx!.optionIds) expect(participation).not.toContain(optionId);
    expect(participation).not.toContain('position');
  });
});
