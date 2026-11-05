/**
 * __tests__/security/exportZipPrivacy.test.ts
 * Plan de mejora P3.4: the course roster (label ↔ blind code) is stored apart
 * and never reaches any file of the export ZIP, in either mode. Checked on a
 * real roster room: members join with their personal codes, vote with reasons,
 * a join fails, telemetry arrives, the round is processed; then every file of
 * both ZIPs is scanned. Also: the ZIP route is for the room's host only.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { generateMemberCode, hashMemberCode } from '@/lib/member-codes';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';
import { readZip } from '../helpers/readZip';

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
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  checkLockout: () => ({ isLocked: false, remainingSec: 0 }),
  recordFailedAttempt: () => ({ isLocked: false, remainingSec: 0 }),
  resetFailedAttempts: () => undefined,
  getClientIp: () => '127.0.0.1',
}));

const LABELS = ['2023-4471 Pérez Soto', '2023-4472 Ñuñez Vera', '2023-4473 Díaz Mora'];

describe.skipIf(!hasTestDb)('P3.4: la lista del curso nunca llega al ZIP (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;
  const codes: string[] = [];
  const memberIds: string[] = [];
  const zips: Record<string, Map<string, Buffer>> = {};

  async function getZip(query: string, hostId: string | null): Promise<Response> {
    state.hostId = hostId;
    const { GET } = await import('@/app/api/rooms/[id]/export/v2/route');
    return GET(new NextRequest(`http://localhost/api/rooms/${fx!.roomId}/export/v2${query}`), { params: { id: fx!.roomId } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, {
      participants: 0,
      status: 'ROUND_OPEN',
      room: { access_mode: 'ROSTER', tau_threshold: 0.99, title: 'Curso 3B Liceo Ejemplo' },
    });
    for (const label of LABELS) {
      const code = generateMemberCode();
      codes.push(code);
      const m = await prisma.roomMember.create({ data: { room_id: fx.roomId, label, access_code_hash: hashMemberCode(code) } });
      memberIds.push(m.id);
    }
    const p = await import('@/app/actions/participant');
    expect((await p.joinRoomWithCode(fx.pin, generateMemberCode(), 'abcdefabcdef')).success).toBe(false);
    const [a, b, c] = fx.optionIds;
    const orders = [[a, b, c], [b, a, c], [c, a, b]];
    for (let i = 0; i < LABELS.length; i++) {
      expect((await p.joinRoomWithCode(fx.pin, codes[i], '00000000000' + i)).success).toBe(true);
      const { recordClientEvents } = await import('@/lib/telemetry/record');
      await recordClientEvents(prisma, state.session, {
        events: [{ type: 'ranking_reordered', method: 'drag', option_id: orders[i][0], from_position: 3, to_position: 1, reorder_index: 1 }],
      });
      const res = await p.submitVote(
        orders[i].map((optionId, k) => ({ optionId, position: k + 1, reasonsFor: k === 0 ? [`Razón de ${i}`] : [] }))
      );
      expect(res.success).toBe(true);
    }
    const room = await prisma.room.findUniqueOrThrow({ where: { id: fx.roomId } });
    if (room.status === 'ROUND_OPEN') {
      const { closeRoundManually } = await import('@/app/actions/room');
      state.hostId = fx.hostId;
      await closeRoundManually(fx.roomId);
    }
    for (const [mode, query] of [['research', ''], ['publication', '?mode=publication'], ['publication+text', '?mode=publication&include_text=1']]) {
      const res = await getZip(query, fx.hostId);
      expect(res.status, mode).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
      zips[mode] = readZip(Buffer.from(await res.arrayBuffer()));
    }
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('ningún archivo de ningún ZIP contiene etiquetas, códigos personales ni ids de la lista', () => {
    const participants = new Set<string>();
    for (const [mode, files] of Object.entries(zips)) {
      expect(files.size, mode).toBe(12);
      for (const [name, data] of files) {
        const text = data.toString('utf8');
        for (const label of LABELS) {
          expect(text, `${mode}/${name}`).not.toContain(label);
          expect(text, `${mode}/${name}`).not.toContain(label.slice(0, 9)); // the student number alone
        }
        for (const code of codes) expect(text, `${mode}/${name}`).not.toContain(code);
        for (const id of memberIds) expect(text, `${mode}/${name}`).not.toContain(id);
        expect(text, `${mode}/${name}`).not.toMatch(/\bm-c[a-z0-9]{20,}/); // internal nickname of roster participants
      }
      const csv = files.get('participants.csv')!.toString('utf8');
      for (const line of csv.split('\r\n').slice(1)) participants.add(line.split(',')[0]);
    }
    // the export still identifies people by their blind code
    expect([...participants].every((c) => /^Participante \d+$/.test(c))).toBe(true);
    expect(participants.size).toBe(3);
  });

  it('modo publicación: sin nombre de sala, sin fechas, sin texto salvo aprobación', () => {
    const pub = zips.publication;
    for (const [name, data] of pub) {
      if (!name.endsWith('.csv')) continue;
      const text = data.toString('utf8');
      expect(text, name).not.toContain('Curso 3B');
      expect(text, name).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(text, name).not.toContain('Razón de');
    }
    expect(zips['publication+text'].get('reasons.csv')!.toString('utf8')).toContain('Razón de 0');
    expect(zips.research.get('rooms.csv')!.toString('utf8')).toContain('Curso 3B Liceo Ejemplo');
    const events = pub.get('events.csv')!.toString('utf8');
    expect(events).toContain('join_failed');
    expect(events).toContain('ranking_reordered');
  });

  it('solo el anfitrión de la sala descarga el ZIP', async () => {
    expect((await getZip('', null)).status).toBe(401);
    expect((await getZip('', 'otro-anfitrion')).status).toBe(404);
  });
});
