/**
 * frontend/__tests__/integration/lobbyScheduleEdit.test.ts
 * Team request 2026-11-24:
 *  - participants join before round 1 (lobby) and get no options yet;
 *  - the host edits the group only before round 1, never its access mode;
 *  - the host schedules when a round opens and closes, before round 1 and
 *    between rounds; it opens by itself (lazy check or worker endpoint).
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

const MIN = 60 * 1000;

describe.skipIf(!hasTestDb)('lobby, edición antes de la Ronda 1 y rondas programadas (PostgreSQL)', () => {
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

  it('Ronda 1 programada: no se abre antes de hora; a la hora se abre sola con el cierre programado', async () => {
    const fx = await draft({}, 3);
    const room = await import('@/app/actions/room');
    const opensAt = new Date(Date.now() + 10 * MIN);
    const res = await room.scheduleRound(fx.roomId, { opensAt: opensAt.toISOString(), timing: 30 });
    expect(res.success).toBe(true);
    let saved = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(saved.scheduled_open_at?.getTime()).toBe(opensAt.getTime());
    expect(saved.scheduled_deadline?.getTime()).toBe(opensAt.getTime() + 30 * MIN);

    const { openScheduledRoundIfDue } = await import('@mic/backend/round-schedule');
    expect(await openScheduledRoundIfDue(fx.roomId)).toBe(false);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } })).status).toBe('DRAFT');

    // At the scheduled time (two callers at once open it once)
    const at = new Date(opensAt.getTime() + 5000);
    const both = await Promise.all([openScheduledRoundIfDue(fx.roomId, at), openScheduledRoundIfDue(fx.roomId, at)]);
    expect(both.filter(Boolean)).toHaveLength(1);
    saved = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(saved).toMatchObject({ status: 'ROUND_OPEN', current_round: 1, scheduled_open_at: null, scheduled_deadline: null });
    expect(saved.deadline?.getTime()).toBe(opensAt.getTime() + 30 * MIN);
    const events = await prisma.roomEvent.findMany({ where: { room_id: fx.roomId }, orderBy: { created_at: 'asc' } });
    expect(events.map((e) => [e.type, e.actor])).toEqual([
      ['round_scheduled', 'HOST'],
      ['room_started', 'SYSTEM'],
    ]);
  });

  it('entre rondas: se programa la siguiente y la consulta de cualquiera la abre a la hora', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3, status: 'ROUND_FEEDBACK', room: { max_rounds: 3 } });
    fixtures.push(fx);
    state.hostId = fx.hostId;
    const room = await import('@/app/actions/room');
    const opensAt = new Date(Date.now() + 2 * MIN);
    const closesAt = new Date(opensAt.getTime() + 90 * MIN);
    expect((await room.scheduleRound(fx.roomId, { opensAt: opensAt.toISOString(), timing: { closesAt: closesAt.toISOString() } })).success).toBe(true);
    // Simulate that the time has come
    await prisma.room.update({ where: { id: fx.roomId }, data: { scheduled_open_at: new Date(Date.now() - 1000) } });
    const { checkAndProcessExpiredDeadline } = await import('@mic/backend/round-processor');
    expect(await checkAndProcessExpiredDeadline(fx.roomId)).toBe(true);
    const saved = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(saved).toMatchObject({ status: 'ROUND_OPEN', current_round: 2 });
    expect(saved.deadline?.getTime()).toBe(closesAt.getTime());
  });

  it('abrir a mano o quitar la programación la reemplaza; no se programa con la ronda abierta ni en el pasado', async () => {
    const fx = await draft({}, 3);
    const room = await import('@/app/actions/room');
    const later = new Date(Date.now() + 60 * MIN).toISOString();
    expect((await room.scheduleRound(fx.roomId, { opensAt: new Date(Date.now() - MIN).toISOString(), timing: 15 })).success).toBe(false);
    expect((await room.scheduleRound(fx.roomId, { opensAt: later, timing: 15 })).success).toBe(true);
    expect((await room.cancelScheduledRound(fx.roomId)).success).toBe(true);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } })).scheduled_open_at).toBeNull();

    expect((await room.scheduleRound(fx.roomId, { opensAt: later, timing: 15 })).success).toBe(true);
    expect((await room.startRoom(fx.roomId, 20)).success).toBe(true);
    const saved = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    expect(saved.scheduled_open_at).toBeNull();
    expect((await room.scheduleRound(fx.roomId, { opensAt: later, timing: 15 })).success).toBe(false);
  });

  it('el endpoint del worker abre una ronda programada vencida', async () => {
    const fx = await draft({ scheduled_open_at: new Date(Date.now() - 1000), scheduled_deadline: new Date(Date.now() + 30 * MIN) }, 3);
    const { processDeadline } = await import('@mic/backend/services/http/process-deadline');
    const { env } = await import('@mic/backend/env');
    const res = await processDeadline({} as never, { workerSecret: env.WORKER_SECRET, bodyText: JSON.stringify({ roomId: fx.roomId }) });
    expect(res).toMatchObject({ status: 200, body: { state: 'ROUND_OPEN', opened: true } });
    const { dueScheduledRoomIds } = await import('@mic/backend/round-schedule');
    expect(await dueScheduledRoomIds()).not.toContain(fx.roomId);
  });
});
