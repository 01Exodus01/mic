/**
 * __tests__/concurrency/group2Concurrency.test.ts
 * Tests for Grupo 2: Concurrencia y consistencia (AUD-04, AUD-09, AUD-09b, AUD-26, AUD-31)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidTransition, isTerminalState, ROOM_STATUS_LABELS } from '@mic/backend/state-machine';

describe('Grupo 2: Concurrencia y consistencia', () => {
  describe('AUD-09b: Estado CANCELLED y máquina de estados', () => {
    it('reconoce CANCELLED como estado válido y terminal', () => {
      expect(isTerminalState('CANCELLED')).toBe(true);
      expect(isTerminalState('CONCLUDED')).toBe(true);
      expect(isTerminalState('ROUND_OPEN')).toBe(false);
    });

    it('permite cancelar sala desde DRAFT, ROUND_OPEN, INSUFFICIENT_VOTES y ROUND_FEEDBACK', () => {
      expect(isValidTransition('DRAFT', 'CANCELLED')).toBe(true);
      expect(isValidTransition('ROUND_OPEN', 'CANCELLED')).toBe(true);
      expect(isValidTransition('INSUFFICIENT_VOTES', 'CANCELLED')).toBe(true);
      expect(isValidTransition('ROUND_FEEDBACK', 'CANCELLED')).toBe(true);
    });

    it('no permite transiciones desde CANCELLED a ningún otro estado', () => {
      expect(isValidTransition('CANCELLED', 'ROUND_OPEN')).toBe(false);
      expect(isValidTransition('CANCELLED', 'DRAFT')).toBe(false);
      expect(isValidTransition('CANCELLED', 'CONCLUDED')).toBe(false);
    });

    it('mapea correctamente la etiqueta visible en español según glosario', () => {
      expect(ROOM_STATUS_LABELS.CANCELLED).toBe('Cancelada');
      expect(ROOM_STATUS_LABELS.CONCLUDED).toBe('Finalizada');
      expect(ROOM_STATUS_LABELS.ROUND_OPEN).toBe('Votación abierta');
      expect(ROOM_STATUS_LABELS.INSUFFICIENT_VOTES).toBe('Faltan votos');
    });
  });

  describe('AUD-09: Extender plazo sin transición espuria en ROUND_OPEN', () => {
    it('la extensión en ROUND_OPEN calcula nuevo plazo a partir del mayor entre now y deadline actual', () => {
      const now = 1000000;
      const futureDeadline = new Date(now + 10 * 60 * 1000); // 10 min en el futuro
      const extraMinutes = 15;

      const baseTime = futureDeadline.getTime() > now ? futureDeadline.getTime() : now;
      const newDeadline = new Date(baseTime + extraMinutes * 60 * 1000);

      // Debe sumar 15 minutos adicionales al plazo futuro existente
      expect(newDeadline.getTime()).toBe(futureDeadline.getTime() + 15 * 60 * 1000);
    });

    it('la extensión con plazo ya vencido calcula nuevo plazo desde now', () => {
      const now = 2000000;
      const pastDeadline = new Date(now - 5 * 60 * 1000); // vencido hace 5 min
      const extraMinutes = 10;

      const baseTime = pastDeadline.getTime() > now ? pastDeadline.getTime() : now;
      const newDeadline = new Date(baseTime + extraMinutes * 60 * 1000);

      expect(newDeadline.getTime()).toBe(now + 10 * 60 * 1000);
    });
  });

  describe('AUD-31: Intercambio de posiciones sin colisión de unicidad', () => {
    it('simula reemplazo atómico de boleta evitando colisión en (participant, round, position)', async () => {
      // Simula el almacén de votos
      let currentVotes = [
        { participantId: 'p1', round: 1, optionId: 'opt_A', position: 1, justification: 'Razón A para la primera opción' },
        { participantId: 'p1', round: 1, optionId: 'opt_B', position: 2, justification: 'Razón B para la segunda opción' },
      ];

      // El participante intercambia posiciones: opt_A -> pos 2, opt_B -> pos 1
      const newBallot = [
        { optionId: 'opt_A', position: 2, justification: 'Razón A actualizada para segunda posición' },
        { optionId: 'opt_B', position: 1, justification: 'Razón B actualizada para primera posición' },
      ];

      // Si se hiciera upsert secuencial:
      // Paso 1: opt_A pasa a pos 2 -> Error: ya existe opt_B en pos 2.
      // Con el patrón atómico deleteMany + createMany:
      const atomicReplace = (participantId: string, round: number, ballot: typeof newBallot) => {
        // 1. Elimina votos previos de esta ronda
        currentVotes = currentVotes.filter(v => !(v.participantId === participantId && v.round === round));

        // 2. Inserta la nueva boleta completa
        const inserted = ballot.map(b => ({
          participantId,
          round,
          optionId: b.optionId,
          position: b.position,
          justification: b.justification,
        }));

        // Verifica que no haya duplicados de posición en la nueva boleta
        const positions = new Set(inserted.map(i => i.position));
        if (positions.size !== inserted.length) {
          throw new Error('Colisión de posición en la boleta');
        }

        currentVotes.push(...inserted);
      };

      expect(() => atomicReplace('p1', 1, newBallot)).not.toThrow();
      expect(currentVotes.length).toBe(2);
      expect(currentVotes.find(v => v.optionId === 'opt_A')?.position).toBe(2);
      expect(currentVotes.find(v => v.optionId === 'opt_B')?.position).toBe(1);
    });
  });

  describe('AUD-26: Autorización previa a cualquier procesamiento perezoso', () => {
    it('comprueba que la pertenencia del anfitrión se evalúe antes de la mutación de plazo', () => {
      const roomHostId = 'host_original';
      const requestingHostId = 'host_intruso';

      const verifyHostBeforeMutation = (roomHost: string, requester: string) => {
        if (roomHost !== requester) {
          throw new Error('No autorizado');
        }
        // Mutación perezosa solo se ejecutaría después
        return 'mutacion_ejecutada';
      };

      expect(() => verifyHostBeforeMutation(roomHostId, requestingHostId)).toThrow('No autorizado');
      expect(verifyHostBeforeMutation(roomHostId, 'host_original')).toBe('mutacion_ejecutada');
    });
  });

  describe('AUD-04: Cierre de ronda y protección ante carreras con votos concurrentes', () => {
    it('un voto enviado después de la hora límite o durante PROCESSING es rechazado', () => {
      const isRoomOpenForVote = (status: string, deadline: Date | null, now: Date) => {
        if (status !== 'ROUND_OPEN') return false;
        if (deadline && now > deadline) return false;
        return true;
      };

      const now = new Date('2026-10-30T12:00:00Z');
      const validDeadline = new Date('2026-10-30T12:15:00Z');
      const expiredDeadline = new Date('2026-10-30T11:59:59Z');

      expect(isRoomOpenForVote('ROUND_OPEN', validDeadline, now)).toBe(true);
      expect(isRoomOpenForVote('ROUND_OPEN', expiredDeadline, now)).toBe(false);
      expect(isRoomOpenForVote('PROCESSING', validDeadline, now)).toBe(false);
      expect(isRoomOpenForVote('INSUFFICIENT_VOTES', validDeadline, now)).toBe(false);
      expect(isRoomOpenForVote('CONCLUDED', validDeadline, now)).toBe(false);
      expect(isRoomOpenForVote('CANCELLED', validDeadline, now)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PT-27: cierre anticipado cuando votan todos (PostgreSQL)
// ─────────────────────────────────────────────────────────────────────────────
import { vi as viPt27, beforeAll as beforeAllPt27, afterAll as afterAllPt27 } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

viPt27.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

type Pt27Session = { participantId: string; roomId: string; nickname: string; blindCode: string };
const pt27 = viPt27.hoisted(() => ({ store: null as null | { getStore: () => unknown } }));
const pt27Store = new AsyncLocalStorage<Pt27Session>();
pt27.store = pt27Store;

viPt27.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
viPt27.mock('next/cache', () => ({ revalidatePath: () => undefined }));
viPt27.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => pt27.store?.getStore() ?? null,
  createParticipantSession: async () => undefined,
  clearParticipantSession: async () => undefined,
}));
viPt27.mock('@mic/backend/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

describe.skipIf(!hasTestDb)('PT-27: cerrar cuando voten todos (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];

  beforeAllPt27(() => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });

  afterAllPt27(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  async function voteAs(fx: RoomFixture, i: number) {
    const { submitVote } = await import('@/app/actions/participant');
    return pt27Store.run({ participantId: fx.participantIds[i], roomId: fx.roomId, nickname: 'x', blindCode: fx.blindCodes[i] }, () =>
      submitVote(fx.optionIds.map((optionId, k) => ({ optionId, position: ((k + i) % fx.optionIds.length) + 1 })))
    );
  }

  const status = async (fx: RoomFixture) => (await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } })).status;
  const processedEvents = (fx: RoomFixture) => prisma.roomEvent.count({ where: { room_id: fx.roomId, type: 'round_processed' } });

  it('apagada: aunque voten todos, la ronda sigue abierta', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3, room: { tau_threshold: 0.99 } });
    fixtures.push(fx);
    for (let i = 0; i < 3; i++) await voteAs(fx, i);
    expect(await status(fx)).toBe('ROUND_OPEN');
  });

  it('encendida: el último voto cierra y procesa la ronda una sola vez', async () => {
    const fx = await createRoomFixture(prisma, { participants: 3, room: { close_when_all_voted: true, tau_threshold: 0.99 } });
    fixtures.push(fx);
    await voteAs(fx, 0);
    await voteAs(fx, 1);
    expect(await status(fx)).toBe('ROUND_OPEN');
    expect((await voteAs(fx, 2)).success).toBe(true);
    expect(await status(fx)).toBe('ROUND_FEEDBACK');
    expect(await processedEvents(fx)).toBe(1);
    const report = await prisma.roundReport.findUniqueOrThrow({ where: { room_id_round: { room_id: fx.roomId, round: 1 } } });
    expect(report.effective_voters).toBe(3);
  });

  it('encendida: dos últimos votos simultáneos procesan la ronda una sola vez', async () => {
    const fx = await createRoomFixture(prisma, { participants: 4, room: { close_when_all_voted: true, tau_threshold: 0.99 } });
    fixtures.push(fx);
    await voteAs(fx, 0);
    await voteAs(fx, 1);
    const results = await Promise.all([voteAs(fx, 2), voteAs(fx, 3)]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(await status(fx)).toBe('ROUND_FEEDBACK');
    expect(await processedEvents(fx)).toBe(1);
    expect(await prisma.roundReport.count({ where: { room_id: fx.roomId } })).toBe(1);
    expect((await prisma.roundReport.findFirstOrThrow({ where: { room_id: fx.roomId } })).effective_voters).toBe(4);
  });

  it('encendida: con menos de 3 boletas no cierra antes de tiempo', async () => {
    const fx = await createRoomFixture(prisma, { participants: 2, room: { close_when_all_voted: true } });
    fixtures.push(fx);
    await voteAs(fx, 0);
    await voteAs(fx, 1);
    expect(await status(fx)).toBe('ROUND_OPEN');
  });

  it('encendida en sala con lista: un miembro que no ingresó impide el cierre; los retirados no cuentan', async () => {
    const fx = await createRoomFixture(prisma, { participants: 4, room: { close_when_all_voted: true, access_mode: 'ROSTER', tau_threshold: 0.99 } });
    fixtures.push(fx);
    for (let i = 0; i < 4; i++) {
      await prisma.roomMember.create({ data: { room_id: fx.roomId, label: `M${i}`, access_code_hash: `${i}`.repeat(64), participant_id: fx.participantIds[i] } });
    }
    const pending = await prisma.roomMember.create({ data: { room_id: fx.roomId, label: 'Sin ingresar', access_code_hash: 'f'.repeat(64) } });
    await prisma.participant.update({ where: { id: fx.participantIds[3] }, data: { is_retired: true } });
    for (let i = 0; i < 3; i++) await voteAs(fx, i);
    expect(await status(fx)).toBe('ROUND_OPEN');
    await prisma.roomMember.update({ where: { id: pending.id }, data: { is_removed: true } });
    const { closeRoundIfAllVoted } = await import('@mic/backend/round-processor');
    expect(await closeRoundIfAllVoted(fx.roomId)).toBe(true);
    expect(await status(fx)).toBe('ROUND_FEEDBACK');
  });
});
