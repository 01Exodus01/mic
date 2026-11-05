/**
 * __tests__/security/exportPrivacy.test.ts
 * PT-26: CSV exports with reasons, versions, events and configuration.
 * No CSV allows identifying anyone by name or roster label; reasons are
 * exported verbatim; scripts that read the old columns by name still work.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
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

function parseCsv(text: string): Array<Record<string, string>> {
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const body = text.slice(1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' && body[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += c;
  }
  row.push(field);
  rows.push(row);
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

describe.skipIf(!hasTestDb)('PT-26: exportes (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture | null = null;
  const csv: Record<string, Array<Record<string, string>>> = {};
  const raw: Record<string, string> = {};

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, { participants: 4, room: { tau_threshold: 0.99, access_mode: 'ROSTER', tie_break_rule: 'LEXICOGRAPHIC' } });
    state.hostId = fx.hostId;
    // Roster labels and nicknames that must never appear in any CSV
    for (let i = 0; i < 4; i++) {
      await prisma.participant.update({ where: { id: fx.participantIds[i] }, data: { nickname: `NombreReal${i}` } });
      await prisma.roomMember.create({ data: { room_id: fx.roomId, label: `MATRICULA-${i}`, access_code_hash: `${i}`.repeat(64), participant_id: fx.participantIds[i] } });
    }
    const { submitVote } = await import('@/app/actions/participant');
    const [a, b, c] = fx.optionIds;
    const ballots = [
      [{ optionId: a, position: 1, reasonsFor: ['=SUMA(1,2)', 'Con, coma y "comillas"'] }, { optionId: b, position: 2 }, { optionId: c, position: 3, reasonsAgainst: ['Cara'] }],
      [{ optionId: b, position: 1 }, { optionId: c, position: 2 }, { optionId: a, position: 3 }],
      [{ optionId: c, position: 1 }, { optionId: a, position: 2 }, { optionId: b, position: 3 }],
      [{ optionId: a, position: 1 }, { optionId: b, position: 2 }, { optionId: c, position: 3 }],
    ];
    for (let i = 0; i < 4; i++) {
      state.session = { participantId: fx.participantIds[i], roomId: fx.roomId, nickname: `x`, blindCode: fx.blindCodes[i] };
      await submitVote(ballots[i]);
    }
    // Participant 1 edits once more: version 2
    state.session = { participantId: fx.participantIds[0], roomId: fx.roomId, nickname: 'x', blindCode: fx.blindCodes[0] };
    await submitVote([{ ...ballots[0][0], reasonsFor: ['=SUMA(1,2)', 'Con, coma y "comillas"'] }, ballots[0][1], { ...ballots[0][2], reasonsAgainst: ['Cara', 'Lejos'] }]);
    // Participant 4 is expelled before closing: kept but excluded
    const room = await import('@/app/actions/room');
    await room.expelParticipant(fx.roomId, fx.participantIds[3]);
    await room.closeRoundManually(fx.roomId);

    const req = new NextRequest('http://localhost/api');
    for (const kind of ['long', 'wide', 'reasons', 'events']) {
      const mod = await import(`@/app/api/rooms/[id]/export/${kind}/route`);
      const res: Response = await mod.GET(req, { params: { id: fx.roomId } });
      expect(res.status).toBe(200);
      // text() would strip the BOM: read the bytes and decode keeping it
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(0, 3)], kind).toEqual([0xef, 0xbb, 0xbf]);
      raw[kind] = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
      csv[kind] = parseCsv(raw[kind]);
    }
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('ningún CSV contiene nombres ni etiquetas de la lista', () => {
    for (const kind of Object.keys(raw)) {
      expect(raw[kind], kind).not.toMatch(/NombreReal|MATRICULA-/);
    }
  });

  it('el CSV largo sigue leyéndose por nombre y trae las columnas nuevas', () => {
    const rows = csv.long;
    expect(rows).toHaveLength(12);
    const p1a = rows.find((r) => r.blind_code === fx!.blindCodes[0] && r.option_id === fx!.optionIds[0])!;
    expect(p1a).toMatchObject({ position: '1', reasons_for_count: '2', reasons_against_count: '0', vote_version: '2', joined_round: '1', excluded_from_round: 'false', tie_break_rule: 'LEXICOGRAPHIC', concordance_variant: 'WITH_TIES', round_status: 'REPORTED' });
    expect(p1a.justification_text).toBe('');
    expect(Number.isNaN(Date.parse(p1a.submitted_at))).toBe(false);
    const expelled = rows.filter((r) => r.blind_code === fx!.blindCodes[3]);
    expect(expelled).toHaveLength(3);
    expect(expelled.every((r) => r.excluded_from_round === 'true' && r.voter_cix !== '')).toBe(true);
  });

  it('el CSV de razones trae cada razón textual, con fórmulas neutralizadas', () => {
    const texts = csv.reasons.map((r) => [r.blind_code, r.side, r.order, r.text]);
    expect(texts).toContainEqual([fx!.blindCodes[0], 'FOR', '0', "'=SUMA(1,2)"]);
    expect(texts).toContainEqual([fx!.blindCodes[0], 'FOR', '1', 'Con, coma y "comillas"']);
    expect(texts).toContainEqual([fx!.blindCodes[0], 'AGAINST', '1', 'Lejos']);
    expect(csv.reasons).toHaveLength(4);
  });

  it('el CSV ancho trae regla y variante; el de eventos no trae contenido de votos', () => {
    expect(csv.wide[0]).toMatchObject({ round: '1', tie_break_rule: 'LEXICOGRAPHIC', concordance_variant: 'WITH_TIES' });
    const types = csv.events.map((e) => e.type);
    expect(types).toContain('vote_submitted');
    expect(types).toContain('participant_expelled');
    expect(raw.events).not.toMatch(/SUMA|comillas|Cara|Lejos/);
    expect(csv.events.find((e) => e.type === 'vote_submitted')!.blind_code).toMatch(/^Participante/);
  });
});
