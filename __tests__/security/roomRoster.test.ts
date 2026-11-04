/**
 * __tests__/security/roomRoster.test.ts
 * PT-21: course roster with personal access codes.
 *  - 35 people → 35 distinct codes, shown once, stored only as hashes.
 *  - Repeated labels are rejected; the room's maximum is respected.
 *  - Only the room's host can manage it, and only in roster rooms.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  generateMemberCode,
  hashMemberCode,
  normalizeMemberCode,
  isWellFormedMemberCode,
  parseRosterText,
  MEMBER_CODE_LENGTH,
} from '@/lib/member-codes';
import { buildCodesCsv } from '@/components/RoomRosterManager';
import { TEST_DB_URL, hasTestDb, createRoomFixture, cleanupFixture, type RoomFixture } from '../helpers/dbFixtures';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

const state = vi.hoisted(() => ({ hostId: null as string | null }));
vi.mock('next/headers', () => ({ headers: () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next-auth', () => ({ getServerSession: async () => (state.hostId ? { user: { id: state.hostId } } : null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));

describe('PT-21: códigos personales', () => {
  it('genera códigos de 10 caracteres sin letras ambiguas, con guion para leerlos', () => {
    const codes = new Set(Array.from({ length: 2000 }, generateMemberCode));
    expect(codes.size).toBe(2000);
    for (const c of codes) {
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
      expect(isWellFormedMemberCode(c)).toBe(true);
    }
    expect(MEMBER_CODE_LENGTH).toBe(10);
  });

  it('el hash no depende de mayúsculas, espacios ni guiones', () => {
    expect(normalizeMemberCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(hashMemberCode('abcde fghjk')).toBe(hashMemberCode('ABCDE-FGHJK'));
    expect(hashMemberCode('ABCDE-FGHJK')).toMatch(/^[0-9a-f]{64}$/);
    expect(isWellFormedMemberCode('ABCDE-FGHJ0')).toBe(false);
  });

  it('lee líneas pegadas y CSV: primer campo, sin encabezado ni vacías', () => {
    expect(parseRosterText('﻿matrícula,nombre\nA001,Ana\n"A002";Beto\n\n  A003  \tCarla\r\n')).toEqual(['A001', 'A002', 'A003']);
  });

  it('el CSV de códigos lleva BOM y neutraliza fórmulas', () => {
    const csv = buildCodesCsv([{ memberId: '1', label: '=HYPERLINK("x")', code: 'ABCDE-FGHJK' }]);
    expect(csv.startsWith('﻿label,access_code')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe.skipIf(!hasTestDb)('PT-21: lista del curso (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const fixtures: RoomFixture[] = [];
  let roster: RoomFixture;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    roster = await createRoomFixture(prisma, { participants: 0, status: 'DRAFT', room: { access_mode: 'ROSTER', max_members: 36 } });
    fixtures.push(roster);
    state.hostId = roster.hostId;
  });

  afterAll(async () => {
    for (const fx of fixtures) await cleanupFixture(prisma, fx);
    await prisma.$disconnect();
  });

  it('carga 35 estudiantes y obtiene 35 códigos distintos, guardados solo como hash', async () => {
    const room = await import('@/app/actions/room');
    const labels = Array.from({ length: 35 }, (_, i) => `A${String(i + 1).padStart(3, '0')}`);
    const res = await room.importRoomMembers(roster.roomId, labels.join('\n'));
    expect(res.success).toBe(true);
    const issued = res.success ? res.data!.issued : [];
    expect(issued).toHaveLength(35);
    expect(new Set(issued.map((i) => i.code)).size).toBe(35);

    const stored = await prisma.roomMember.findMany({ where: { room_id: roster.roomId } });
    expect(stored).toHaveLength(35);
    const allStored = JSON.stringify(stored);
    for (const { code, label } of issued) {
      expect(allStored).not.toContain(code);
      expect(allStored).not.toContain(normalizeMemberCode(code));
      expect(stored.find((m) => m.label === label)!.access_code_hash).toBe(hashMemberCode(code));
    }

    // No code or label in the event log
    const events = await prisma.roomEvent.findMany({ where: { room_id: roster.roomId } });
    expect(events.map((e) => [e.type, e.data])).toEqual([['member_added', { count: 35 }]]);
    expect(JSON.stringify(events)).not.toContain('A001');
  });

  it('rechaza etiquetas repetidas, en el lote o con la lista, sin agregar nada', async () => {
    const room = await import('@/app/actions/room');
    const inBatch = await room.importRoomMembers(roster.roomId, 'B001\nb001');
    expect(inBatch).toMatchObject({ success: false });
    if (!inBatch.success) expect(inBatch.error).toContain('Etiquetas repetidas');
    const withList = await room.addRoomMember(roster.roomId, 'a001');
    expect(withList).toMatchObject({ success: false });
    if (!withList.success) expect(withList.error).toContain('Ya están en la lista');
    expect(await prisma.roomMember.count({ where: { room_id: roster.roomId } })).toBe(35);
  });

  it('respeta el máximo de participantes', async () => {
    const room = await import('@/app/actions/room');
    expect((await room.importRoomMembers(roster.roomId, 'C001\nC002')).success).toBe(false);
    expect((await room.addRoomMember(roster.roomId, 'C001')).success).toBe(true);
    expect((await room.addRoomMember(roster.roomId, 'C002')).success).toBe(false);
  });

  it('regenerar cambia el código y quitar lo desactiva y retira al participante', async () => {
    const room = await import('@/app/actions/room');
    const member = await prisma.roomMember.findFirstOrThrow({ where: { room_id: roster.roomId, label: 'A001' } });
    const regen = await room.regenerateMemberCode(roster.roomId, member.id);
    expect(regen.success).toBe(true);
    const after = await prisma.roomMember.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.access_code_hash).not.toBe(member.access_code_hash);
    expect(after.access_code_hash).toBe(hashMemberCode(regen.success ? regen.data!.issued.code : ''));

    const p = await prisma.participant.create({ data: { room_id: roster.roomId, nickname: 'm-x', pin_hash: 'x', blind_code: 'Participante 09' } });
    await prisma.roomMember.update({ where: { id: member.id }, data: { participant_id: p.id } });
    expect((await room.removeRoomMember(roster.roomId, member.id)).success).toBe(true);
    expect((await prisma.roomMember.findUniqueOrThrow({ where: { id: member.id } })).is_removed).toBe(true);
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: p.id } })).is_retired).toBe(true);

    const list = await room.getRoomMembers(roster.roomId);
    const item = list.success ? list.data!.members.find((m) => m.id === member.id) : undefined;
    expect(item).toEqual({ id: member.id, label: 'A001', joined: true, isRemoved: true, addedRound: 1 });
    expect(JSON.stringify(list)).not.toContain('Participante 09');
  });

  it('otro anfitrión no puede ver ni cambiar la lista; una sala abierta no tiene lista', async () => {
    const room = await import('@/app/actions/room');
    const other = await createRoomFixture(prisma, { participants: 0, status: 'DRAFT' });
    fixtures.push(other);
    state.hostId = other.hostId;
    expect((await room.getRoomMembers(roster.roomId)).success).toBe(false);
    expect((await room.addRoomMember(roster.roomId, 'Z001')).success).toBe(false);
    const open = await room.addRoomMember(other.roomId, 'Z001');
    expect(open).toMatchObject({ success: false, error: 'Esta sala no usa una lista de participantes.' });
    state.hostId = roster.hostId;
  });
});
