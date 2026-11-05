/**
 * __tests__/security/consent.test.tsx
 * PT-24: informed consent configured per room.
 *  - Off (default): nothing changes.
 *  - On: the host's text is required at creation; voting without accepting
 *    fails on the server; acceptance is stored with time and text version;
 *    the text can still be read after accepting.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { RoomSettingsSchema } from '@mic/backend/shared/validations';
import RoomConsentSettings from '@/components/RoomConsentSettings';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

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

const TEXT = 'Participo de forma voluntaria.\nMis respuestas se usan sin mi nombre en un estudio del curso.';

describe('PT-24: configuración del consentimiento', () => {
  it('apagado por defecto y sin texto legal por defecto', () => {
    const parsed = RoomSettingsSchema.parse({});
    expect(parsed.consentRequired).toBe(false);
    expect(parsed.consentText).toBe('');
  });

  it('si se activa, el texto es obligatorio y conserva los saltos de línea', () => {
    const empty = RoomSettingsSchema.safeParse({ consentRequired: true, consentText: '   ' });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(empty.error.errors[0]?.path).toEqual(['consentText']);
    const ok = RoomSettingsSchema.parse({ consentRequired: true, consentText: `  ${TEXT}  ` });
    expect(ok.consentText).toBe(TEXT);
    expect(RoomSettingsSchema.safeParse({ consentRequired: true, consentText: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('el formulario muestra el campo de texto solo con el interruptor activo', () => {
    const off = renderToStaticMarkup(<RoomConsentSettings required={false} text="" onChange={() => undefined} />);
    expect(off).toContain('Pedir consentimiento antes de votar');
    expect(off).not.toContain('<textarea');
    const on = renderToStaticMarkup(<RoomConsentSettings required text="" onChange={() => undefined} />);
    expect(on).toContain('<textarea');
    expect(on).toContain('0/4000');
  });
});

describe.skipIf(!hasTestDb)('PT-24: consentimiento en el servidor (PostgreSQL)', () => {
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

  it('con consentimiento activo, votar sin aceptar falla en el servidor; tras aceptar, funciona', async () => {
    const fx = await createRoomFixture(prisma, { participants: 1, room: { consent_required: true, consent_text: TEXT, consent_version: 1 } });
    fixtures.push(fx);
    state.session = { participantId: fx.participantIds[0], roomId: fx.roomId, nickname: 'Persona 1', blindCode: fx.blindCodes[0] };
    const p = await import('@/app/actions/participant');

    const view = await p.getParticipantRoomView();
    expect(view.success && view.data?.consent).toEqual({ required: true, accepted: false, version: 1, text: TEXT });

    expect(await p.submitVote(ballot(fx))).toMatchObject({ success: false, code: 'CONSENT_REQUIRED' });
    expect(await prisma.vote.count({ where: { participant_id: fx.participantIds[0] } })).toBe(0);

    expect(await p.acceptConsent()).toEqual({ success: true });
    expect(await p.acceptConsent()).toEqual({ success: true });
    const records = await prisma.consentRecord.findMany({ where: { room_id: fx.roomId } });
    expect(records).toHaveLength(1);
    expect(records[0].text_version).toBe(1);
    expect(records[0].accepted_at).toBeInstanceOf(Date);
    expect(await prisma.roomEvent.count({ where: { room_id: fx.roomId, type: 'consent_accepted' } })).toBe(1);

    expect(await p.submitVote(ballot(fx))).toEqual({ success: true });
    const after = await p.getParticipantRoomView();
    expect(after.success && after.data?.consent).toEqual({ required: true, accepted: true, version: 1, text: TEXT });
  });

  it('con el consentimiento apagado el flujo es igual que antes', async () => {
    const fx = await createRoomFixture(prisma, { participants: 1 });
    fixtures.push(fx);
    state.session = { participantId: fx.participantIds[0], roomId: fx.roomId, nickname: 'Persona 1', blindCode: fx.blindCodes[0] };
    const p = await import('@/app/actions/participant');
    const view = await p.getParticipantRoomView();
    expect(view.success && view.data?.consent).toEqual({ required: false, accepted: true, version: 1, text: null });
    expect(await p.submitVote(ballot(fx))).toEqual({ success: true });
    expect(await prisma.consentRecord.count({ where: { room_id: fx.roomId } })).toBe(0);
  });

  it('createRoom guarda el texto del anfitrión y rechaza el interruptor sin texto', async () => {
    const host = await createRoomFixture(prisma, { participants: 0, status: 'DRAFT' });
    fixtures.push(host);
    state.hostId = host.hostId;
    const { createRoom } = await import('@/app/actions/room');
    const base = { title: 'Sala con consentimiento', method: 'BORDA' as const, maxMembers: 20, tauThreshold: 80, maxRounds: 3, options: [{ title: 'Uno uno' }, { title: 'Dos dos' }, { title: 'Tres tres' }] };
    expect((await createRoom({ ...base, settings: { consentRequired: true, consentText: '' } })).success).toBe(false);
    const res = await createRoom({ ...base, settings: { consentRequired: true, consentText: TEXT } });
    if (!res.success || !res.data) throw new Error('createRoom failed');
    const room = await prisma.room.findUniqueOrThrow({ where: { id: res.data.salaId } });
    expect(room).toMatchObject({ consent_required: true, consent_text: TEXT, consent_version: 1 });
  });
});
