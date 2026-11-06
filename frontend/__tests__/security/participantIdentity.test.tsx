/**
 * frontend/__tests__/security/participantIdentity.test.tsx
 * Participant screens say "Conectado como <name>" (rooms with names) or
 * "Conectado como participante" (rooms with a list). The blind code is not
 * shown on screen (AGENTS.md: it only appears in the data).
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ParticipantIdentity from '@/components/ParticipantIdentity';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../../../backend/__tests__/helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

type Session = { participantId: string; roomId: string; nickname: string; blindCode: string };
const state = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => null }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => state.session,
  createParticipantSession: async () => undefined,
  clearParticipantSession: async () => undefined,
}));

describe('identidad en las pantallas del participante', () => {
  it('muestra el nombre o "participante", nunca el código', () => {
    expect(renderToStaticMarkup(<ParticipantIdentity displayName="Ana" />)).toContain('Conectado como <strong');
    expect(renderToStaticMarkup(<ParticipantIdentity displayName="Ana" />)).toContain('Ana');
    expect(renderToStaticMarkup(<ParticipantIdentity displayName={null} />)).toContain('Conectado como participante');
  });

  it('ninguna pantalla del participante pinta el código ciego', async () => {
    const fs = await import('fs');
    for (const page of ['vote', 'feedback', 'consent']) {
      const src = fs.readFileSync(new URL(`../../app/participant/${page}/page.tsx`, import.meta.url), 'utf8');
      expect(src, page).not.toMatch(/\{[^}]*blindCode[^}]*\}\s*<\/span>|formatParticipantSignature\(/);
    }
  });
});

describe.skipIf(!hasTestDb)('nombre que manda el servidor (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];
  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  });
  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('sala con nombres: su nombre; sala con lista: nada', async () => {
    const { getParticipantRoomView } = await import('@/app/actions/participant');
    for (const [mode, expected] of [['OPEN_PIN', 'Persona 1'], ['ROSTER', null]] as const) {
      const fx = await createRoomFixture(prisma, { participants: 1, room: { access_mode: mode } });
      fixtures.push(fx);
      state.session = { participantId: fx.participantIds[0], roomId: fx.roomId, nickname: 'x', blindCode: fx.blindCodes[0] };
      const view = await getParticipantRoomView();
      if (!view.success) throw new Error(view.error);
      expect(view.data!.displayName, mode).toBe(expected);
    }
  });
});
