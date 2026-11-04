/**
 * __tests__/security/rosterJoin.test.ts
 * PT-22: joining a roster room with room PIN + personal code.
 *  - A valid code enters and later resumes the same identity, from any device.
 *  - Invalid codes, codes of another room and removed members get the same
 *    generic message.
 *  - The open flow (name + 4-digit PIN) does not work on roster rooms.
 *  - The roster label never reaches the participant session.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { generateMemberCode, hashMemberCode } from '@/lib/member-codes';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

type Session = { participantId: string; roomId: string; nickname: string; blindCode: string };
const state = vi.hoisted(() => ({ sessions: [] as Session[] }));

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => state.sessions[state.sessions.length - 1] ?? null,
  createParticipantSession: async (p: Session) => {
    state.sessions.push(p);
  },
  clearParticipantSession: async () => undefined,
}));

const GENERIC = 'No se puede ingresar a esa sala. Revisa el PIN y tu código.';

describe.skipIf(!hasTestDb)('PT-22: ingreso con código personal (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];
  let roster: RoomFixture;
  let other: RoomFixture;
  const codes: Record<string, string> = {};

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    roster = await createRoomFixture(prisma, { participants: 0, status: 'ROUND_OPEN', room: { access_mode: 'ROSTER' } });
    other = await createRoomFixture(prisma, { participants: 0, status: 'ROUND_OPEN', room: { access_mode: 'ROSTER' } });
    fixtures.push(roster, other);
    for (const [fx, label] of [[roster, 'A001'], [roster, 'A002'], [roster, 'A003'], [other, 'B001']] as const) {
      const code = generateMemberCode();
      codes[label] = code;
      await prisma.roomMember.create({ data: { room_id: fx.roomId, label, access_code_hash: hashMemberCode(code) } });
    }
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('un código válido entra, crea la identidad con código ciego y la retoma después', async () => {
    const { joinRoomWithCode } = await import('@/app/actions/participant');
    const first = await joinRoomWithCode(roster.pin, codes.A001.toLowerCase());
    expect(first.success).toBe(true);
    const again = await joinRoomWithCode(roster.pin, codes.A001.replace('-', ''));
    expect(again).toEqual(first);
    const member = await prisma.roomMember.findFirstOrThrow({ where: { room_id: roster.roomId, label: 'A001' } });
    expect(member.participant_id).toBe(first.success ? first.data!.participantId : '');
    expect(await prisma.participant.count({ where: { room_id: roster.roomId } })).toBe(1);

    const session = state.sessions[state.sessions.length - 1];
    expect(session.blindCode).toMatch(/^Participante \d{2}$/);
    expect(JSON.stringify(state.sessions)).not.toContain('A001');
  });

  it('dos dispositivos con el mismo código a la vez comparten la misma identidad', async () => {
    const { joinRoomWithCode } = await import('@/app/actions/participant');
    const [a, b] = await Promise.all([joinRoomWithCode(roster.pin, codes.A002), joinRoomWithCode(roster.pin, codes.A002)]);
    expect(a.success && b.success).toBe(true);
    expect(a).toEqual(b);
    const linked = await prisma.roomMember.findFirstOrThrow({ where: { room_id: roster.roomId, label: 'A002' } });
    expect(await prisma.participant.count({ where: { id: linked.participant_id! } })).toBe(1);
    expect(await prisma.participant.count({ where: { room_id: roster.roomId } })).toBe(2);
  });

  it('código inválido, de otra sala, mal formado o de un miembro quitado: mismo mensaje genérico', async () => {
    const { joinRoomWithCode } = await import('@/app/actions/participant');
    const removed = await prisma.roomMember.findFirstOrThrow({ where: { room_id: roster.roomId, label: 'A003' } });
    await prisma.roomMember.update({ where: { id: removed.id }, data: { is_removed: true } });
    const attempts = await Promise.all([
      joinRoomWithCode(roster.pin, generateMemberCode()),
      joinRoomWithCode(roster.pin, codes.B001),
      joinRoomWithCode(roster.pin, 'corto'),
      joinRoomWithCode(roster.pin, codes.A003),
      joinRoomWithCode('ZZZZZZ', codes.A001),
    ]);
    for (const res of attempts) expect(res).toEqual({ success: false, error: GENERIC, code: 'CANNOT_JOIN' });
  });

  it('el ingreso con nombre y PIN de 4 dígitos no funciona en una sala con lista', async () => {
    const { joinRoom, checkNicknameInRoom, verifyRoomPin } = await import('@/app/actions/participant');
    expect((await joinRoom(roster.pin, 'Alguien', '1234')).success).toBe(false);
    expect((await checkNicknameInRoom(roster.pin, 'Alguien')).success).toBe(false);
    const verified = await verifyRoomPin(roster.pin);
    expect(verified.success && verified.data?.accessMode).toBe('ROSTER');
  });

  it('con la cohorte cerrada, un código nuevo no entra después de la ronda 1', async () => {
    const { joinRoomWithCode } = await import('@/app/actions/participant');
    const code = generateMemberCode();
    await prisma.roomMember.create({ data: { room_id: roster.roomId, label: 'A010', access_code_hash: hashMemberCode(code), added_round: 2 } });
    await prisma.room.update({ where: { id: roster.roomId }, data: { current_round: 2 } });
    expect(await joinRoomWithCode(roster.pin, code)).toEqual({ success: false, error: GENERIC, code: 'CANNOT_JOIN' });
    // A member who joined in round 1 still resumes
    expect((await joinRoomWithCode(roster.pin, codes.A001)).success).toBe(true);
  });
});
