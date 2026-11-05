/**
 * __tests__/integration/createRoomSettings.test.tsx
 * PT-18: advanced room options at creation.
 *  - A room created without touching anything behaves as before.
 *  - Invalid combinations are rejected with a clear message, server side.
 *  - The chosen options are stored and shown read-only in the host panel.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { RoomSettingsSchema } from '@mic/backend/shared/validations';
import RoomAdvancedSettings, { RoomSettingsSummary, DEFAULT_ROOM_SETTINGS } from '@/components/RoomAdvancedSettings';
import { TEST_DB_URL, hasTestDb } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

const state = vi.hoisted(() => ({ hostId: null as string | null }));
vi.mock('next/headers', () => ({ headers: () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const baseInput = {
  title: 'Sala de opciones avanzadas',
  method: 'BORDA' as const,
  maxMembers: 20,
  tauThreshold: 80,
  maxRounds: 3,
  options: [{ title: 'Opción uno' }, { title: 'Opción dos' }, { title: 'Opción tres' }],
};

describe('PT-18: esquema de opciones de sala', () => {
  it('sin nada, los valores por defecto son el comportamiento anterior', () => {
    expect(RoomSettingsSchema.parse({})).toEqual(DEFAULT_ROOM_SETTINGS);
  });

  it('rechaza valores inválidos; regla de desempate y variante ya no se eligen (E-12)', () => {
    expect(RoomSettingsSchema.parse({ tieBreakRule: 'NONE', concordanceVariant: 'WITH_TIES' })).toEqual(DEFAULT_ROOM_SETTINGS);
    expect(RoomSettingsSchema.safeParse({ accessMode: 'OTRO' }).success).toBe(false);
    expect(RoomSettingsSchema.safeParse({ allowLateJoin: 'sí' }).success).toBe(false);
  });
});

describe('PT-18: componentes', () => {
  it('el formulario va en una sección plegable con ayuda en lenguaje llano y sin términos técnicos', () => {
    const html = renderToStaticMarkup(<RoomAdvancedSettings value={DEFAULT_ROOM_SETTINGS} onChange={() => undefined} />);
    expect(html).toContain('<details');
    expect(html).toContain('Opciones avanzadas');
    // E-12: no tie-break or variant choice; the fixed cascade is explained
    expect(html).not.toContain('name="tieBreakRule"');
    expect(html).not.toContain('name="concordanceVariant"');
    expect(html).toContain('por mayoría entre las opciones');
    expect(html).toContain('orden alfabético del título');
    expect(html).toContain('Solo personas de una lista');
    expect(html).toContain('Cerrar la ronda en cuanto voten todos');
    for (const banned of ['τ', 'tau', 'cohorte', 'Kendall', 'mid-rank', 'quórum']) {
      expect(html.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it('el resumen de una sala nueva muestra el desempate fijo', () => {
    const html = renderToStaticMarkup(
      <RoomSettingsSummary room={{ tie_break_rule: 'PAIRWISE_MAJORITY', concordance_variant: 'WITHOUT_TIES', access_mode: 'OPEN_PIN' }} />
    );
    expect(html).toContain('Desempate por mayoría entre las opciones empatadas');
    expect(html).toContain('Sin empates');
  });

  it('el resumen de solo lectura muestra la configuración de una sala anterior', () => {
    const html = renderToStaticMarkup(
      <RoomSettingsSummary room={{ tie_break_rule: 'REASON_BALANCE', concordance_variant: 'WITHOUT_TIES', access_mode: 'ROSTER', allow_late_join: true, close_when_all_voted: true }} />
    );
    expect(html).toContain('Desempatar por las razones');
    expect(html).toContain('Sin empates');
    expect(html).toContain('Solo personas de una lista');
    expect(html).toContain('Se pueden sumar');
    expect(html).not.toContain('<input');
  });
});

describe.skipIf(!hasTestDb)('PT-18: createRoom (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let hostId = '';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    const host = await prisma.user.create({ data: { email: `pt18-${Date.now()}@example.test`, name: 'Host', password_hash: 'x' } });
    hostId = host.id;
    state.hostId = hostId;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: hostId } });
    await prisma.$disconnect();
  });

  it('toda sala nueva desempata por mayoría y mide sin empates', async () => {
    const { createRoom } = await import('@/app/actions/room');
    const res = await createRoom(baseInput);
    expect(res.success).toBe(true);
    if (!res.success || !res.data) throw new Error('createRoom failed');
    const room = await prisma.room.findUnique({ where: { id: res.data.salaId } });
    expect(room).toMatchObject({
      tie_break_rule: 'PAIRWISE_MAJORITY',
      concordance_variant: 'WITHOUT_TIES',
      access_mode: 'OPEN_PIN',
      allow_late_join: false,
      close_when_all_voted: false,
      consent_required: false,
    });
  });

  it('guarda las opciones elegidas', async () => {
    const { createRoom } = await import('@/app/actions/room');
    const res = await createRoom({
      ...baseInput,
      settings: { accessMode: 'ROSTER', allowLateJoin: true, closeWhenAllVoted: true },
    });
    expect(res.success).toBe(true);
    if (!res.success || !res.data) throw new Error('createRoom failed');
    const room = await prisma.room.findUnique({ where: { id: res.data.salaId } });
    expect(room).toMatchObject({
      tie_break_rule: 'PAIRWISE_MAJORITY',
      concordance_variant: 'WITHOUT_TIES',
      access_mode: 'ROSTER',
      allow_late_join: true,
      close_when_all_voted: true,
    });
  });

  it('el servidor ignora una regla o variante enviada por el cliente', async () => {
    const { createRoom } = await import('@/app/actions/room');
    const forged = { ...baseInput, settings: { tieBreakRule: 'NONE', concordanceVariant: 'WITH_TIES' } } as unknown as Parameters<typeof createRoom>[0];
    const res = await createRoom(forged);
    expect(res.success).toBe(true);
    if (!res.success || !res.data) throw new Error('createRoom failed');
    const room = await prisma.room.findUnique({ where: { id: res.data.salaId } });
    expect(room).toMatchObject({ tie_break_rule: 'PAIRWISE_MAJORITY', concordance_variant: 'WITHOUT_TIES' });
  });

  it('una sala nueva no puede usar Kemeny-Young', async () => {
    const { createRoom } = await import('@/app/actions/room');
    const before = await prisma.room.count({ where: { host_id: hostId } });
    const res = await createRoom({ ...baseInput, method: 'KEMENY_YOUNG' } as unknown as Parameters<typeof createRoom>[0]);
    expect(res).toMatchObject({ success: false, error: 'Selecciona una regla de decisión colectiva.' });
    expect(await prisma.room.count({ where: { host_id: hostId } })).toBe(before);
  });

  it('ninguna acción del anfitrión cambia la configuración después de crear la sala', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../../backend/src/services/room.ts', import.meta.url), 'utf8');
    const afterCreate = source.slice(source.indexOf('export async function startRoom'));
    for (const field of ['tie_break_rule', 'concordance_variant', 'access_mode', 'allow_late_join', 'close_when_all_voted']) {
      expect(afterCreate, field).not.toMatch(new RegExp(`${field}\\s*:`));
    }
  });
});
