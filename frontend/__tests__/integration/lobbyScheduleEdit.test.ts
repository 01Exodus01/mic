/**
 * frontend/__tests__/integration/lobbyScheduleEdit.test.ts
 * Team request 2026-11-24:
 *  - participants join before round 1 (lobby) and get no options yet;
 *  - the host edits the group only before round 1, never its access mode.
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

describe.skipIf(!hasTestDb)('lobby, edición antes de la Ronda 1 (PostgreSQL)', () => {
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

  it('editar antes de la Ronda 1: cambia todo salvo la forma de ingreso; las opciones conservan su id', async () => {
    const fx = await draft({ consent_required: true, consent_text: 'Texto de consentimiento original de prueba.' });
    const room = await import('@/app/actions/room');
    const base = {
      title: 'Título editado del grupo',
      method: 'SCHULZE' as const,
      maxMembers: 70,
      tauThreshold: 75,
      maxRounds: 4,
      options: [
        { id: fx.optionIds[2], title: 'Opción tres editada', description: 'Nueva descripción' },
        { id: fx.optionIds[0], title: 'Opción 1', description: '' },
        { title: 'Opción nueva', description: '' },
        { title: 'Otra opción nueva', description: '' },
      ],
      settings: {
        accessMode: 'OPEN_PIN' as const,
        allowLateJoin: false,
        closeWhenAllVoted: true,
        consentRequired: true,
        consentText: 'Texto de consentimiento cambiado antes de empezar.',
      },
    };
    const res = await room.updateRoom(fx.roomId, base);
    expect(res).toEqual({ success: true });
    const saved = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId }, include: { options: { orderBy: { order_index: 'asc' } } } });
    expect(saved).toMatchObject({
      title: 'Título editado del grupo',
      method: 'SCHULZE',
      max_members: 70,
      tau_threshold: 0.75,
      max_rounds: 4,
      allow_late_join: false,
      close_when_all_voted: true,
      consent_version: 2,
    });
    expect(saved.options.map((o) => o.title)).toEqual(['Opción tres editada', 'Opción 1', 'Opción nueva', 'Otra opción nueva']);
    expect(saved.options[0].id).toBe(fx.optionIds[2]);
    expect(saved.options[1].id).toBe(fx.optionIds[0]);
    expect(saved.options.some((o) => o.id === fx.optionIds[1])).toBe(false);

    const access = await room.updateRoom(fx.roomId, { ...base, settings: { ...base.settings, accessMode: 'ROSTER' } });
    expect(access.success).toBe(false);

    await room.startRoom(fx.roomId, 15);
    const late = await room.updateRoom(fx.roomId, { ...base, title: 'Cambio tardío del grupo' });
    expect(late.success).toBe(false);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } })).title).toBe('Título editado del grupo');
  });

  it('no deja bajar el número de participantes por debajo de quienes ya esperan', async () => {
    const fx = await draft({}, 4);
    const room = await import('@/app/actions/room');
    const res = await room.updateRoom(fx.roomId, {
      title: 'Grupo con cuatro esperando',
      method: 'BORDA',
      maxMembers: 3,
      tauThreshold: 80,
      maxRounds: 3,
      options: fx.optionIds.map((id, i) => ({ id, title: `Opción ${i + 1}`, description: '' })),
      settings: { accessMode: 'OPEN_PIN' },
    });
    expect(res.success).toBe(false);
  });
});
