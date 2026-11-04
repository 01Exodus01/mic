/**
 * __tests__/integration/schemaAdditions.test.ts
 * PT-07 / PT-08: additive schema. Static checks always run. The database part
 * runs only when TEST_DATABASE_URL points to a migrated PostgreSQL database
 * (it creates and deletes its own rows).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const schema = fs.readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  return match ? match[0] : '';
}

describe('PT-07: esquema de razones, historial y bitácora', () => {
  it('Vote.justification es opcional y Vote tiene razones', () => {
    const vote = modelBlock('Vote');
    expect(vote).toMatch(/justification\s+String\?/);
    expect(vote).toMatch(/reasons\s+VoteReason\[\]/);
  });

  it('VoteReason se borra en cascada con su voto y limita el texto a 200', () => {
    const block = modelBlock('VoteReason');
    expect(block).toMatch(/onDelete: Cascade/);
    expect(block).toMatch(/text\s+String\s+@db\.VarChar\(200\)/);
    expect(block).toMatch(/side\s+ReasonSide/);
  });

  it('VoteRevision y RoomEvent existen con sus índices', () => {
    expect(modelBlock('VoteRevision')).toMatch(/@@unique\(\[participant_id, round, version\]\)/);
    expect(modelBlock('RoomEvent')).toMatch(/@@index\(\[room_id, created_at\]\)/);
  });

  it('ninguna migración borra tablas ni columnas', () => {
    const dir = path.resolve(__dirname, '../../prisma/migrations');
    for (const folder of fs.readdirSync(dir).filter((f) => /^\d{14}_/.test(f))) {
      const sql = fs.readFileSync(path.join(dir, folder, 'migration.sql'), 'utf8');
      expect(sql, folder).not.toMatch(/DROP\s+TABLE/i);
      expect(sql, folder).not.toMatch(/DROP\s+COLUMN/i);
    }
  });
});

const dbUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!dbUrl)('PT-07: filas en las tablas nuevas (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const suffix = Date.now().toString(36);
  let roomId = '';
  let participantId = '';
  let voteId = '';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    const host = await prisma.user.create({
      data: { email: `pt07-${suffix}@example.test`, name: 'Host PT07', password_hash: 'x' },
    });
    const room = await prisma.room.create({
      data: {
        pin: suffix.slice(-6).toUpperCase().padStart(6, 'Z'),
        title: 'Sala PT-07',
        host_id: host.id,
        options: { create: [0, 1, 2].map((i) => ({ title: `Opción ${i}`, description: '', order_index: i })) },
      },
      include: { options: true },
    });
    roomId = room.id;
    const participant = await prisma.participant.create({
      data: { room_id: room.id, nickname: 'Ana', pin_hash: 'x', blind_code: 'Participante 01' },
    });
    participantId = participant.id;
    const vote = await prisma.vote.create({
      data: { participant_id: participant.id, round: 1, option_id: room.options[0].id, position: 1 },
    });
    voteId = vote.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: `pt07-${suffix}@example.test` } });
      await prisma.$disconnect();
    }
  });

  it('acepta un voto sin razón y razones a favor y en contra', async () => {
    await prisma.voteReason.createMany({
      data: [
        { vote_id: voteId, side: 'FOR', text: 'Primera a favor', order_index: 0 },
        { vote_id: voteId, side: 'FOR', text: 'Segunda a favor', order_index: 1 },
        { vote_id: voteId, side: 'AGAINST', text: 'Una en contra', order_index: 0 },
      ],
    });
    const reasons = await prisma.voteReason.findMany({ where: { vote_id: voteId }, orderBy: [{ side: 'asc' }, { order_index: 'asc' }] });
    expect(reasons.map((r) => r.text)).toEqual(['Primera a favor', 'Segunda a favor', 'Una en contra']);
    const vote = await prisma.vote.findUnique({ where: { id: voteId } });
    expect(vote?.justification).toBeNull();
  });

  it('guarda versiones del voto y eventos de la sala', async () => {
    await prisma.voteRevision.create({
      data: { room_id: roomId, participant_id: participantId, round: 1, version: 1, snapshot: { positions: [] } },
    });
    await expect(
      prisma.voteRevision.create({
        data: { room_id: roomId, participant_id: participantId, round: 1, version: 1, snapshot: {} },
      })
    ).rejects.toThrow();
    const event = await prisma.roomEvent.create({
      data: { room_id: roomId, round: 1, type: 'vote_submitted', actor: 'PARTICIPANT', participant_id: participantId },
    });
    expect(event.created_at).toBeInstanceOf(Date);
  });

  it('las razones se borran en cascada con su voto', async () => {
    await prisma.vote.delete({ where: { id: voteId } });
    expect(await prisma.voteReason.count({ where: { vote_id: voteId } })).toBe(0);
  });
});

describe('PT-08: configuración por sala, lista y consentimiento', () => {
  it('los valores por defecto reproducen el comportamiento anterior', () => {
    const room = modelBlock('Room');
    expect(room).toMatch(/access_mode\s+AccessMode\s+@default\(OPEN_PIN\)/);
    expect(room).toMatch(/allow_late_join\s+Boolean\s+@default\(false\)/);
    expect(room).toMatch(/consent_required\s+Boolean\s+@default\(false\)/);
    expect(room).toMatch(/close_when_all_voted\s+Boolean\s+@default\(false\)/);
    expect(room).toMatch(/tie_break_rule\s+TieBreakRule\s+@default\(NONE\)/);
    expect(room).toMatch(/concordance_variant\s+ConcordanceVariant\s+@default\(WITH_TIES\)/);
    expect(modelBlock('Participant')).toMatch(/joined_round\s+Int\s+@default\(1\)/);
  });

  it('la etiqueta del estudiante solo vive en RoomMember', () => {
    expect(modelBlock('RoomMember')).toMatch(/label\s+String/);
    for (const model of ['Vote', 'VoteReason', 'VoteRevision', 'RoomEvent', 'Participant', 'RoundReport']) {
      expect(modelBlock(model), model).not.toMatch(/\blabel\b/);
    }
  });
});

describe.skipIf(!dbUrl)('PT-08: valores por defecto en la base (PostgreSQL)', () => {
  it('una sala creada sin configuración queda abierta, cerrada a tardíos, sin consentimiento ni desempate', async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    const suffix = (Date.now() + 1).toString(36);
    try {
      const host = await prisma.user.create({
        data: { email: `pt08-${suffix}@example.test`, name: 'Host PT08', password_hash: 'x' },
      });
      const room = await prisma.room.create({
        data: { pin: suffix.slice(-6).toUpperCase().padStart(6, 'Y'), title: 'Sala PT-08', host_id: host.id },
      });
      expect(room).toMatchObject({
        access_mode: 'OPEN_PIN',
        allow_late_join: false,
        consent_required: false,
        consent_text: null,
        close_when_all_voted: false,
        tie_break_rule: 'NONE',
        concordance_variant: 'WITH_TIES',
      });
      const participant = await prisma.participant.create({
        data: { room_id: room.id, nickname: 'Ana', pin_hash: 'x', blind_code: 'Participante 01' },
      });
      expect(participant.joined_round).toBe(1);
      const member = await prisma.roomMember.create({
        data: { room_id: room.id, label: 'A001', access_code_hash: 'a'.repeat(64), participant_id: participant.id },
      });
      await expect(
        prisma.roomMember.create({ data: { room_id: room.id, label: 'A001', access_code_hash: 'b'.repeat(64) } })
      ).rejects.toThrow();
      expect(member.added_round).toBe(1);
      await prisma.consentRecord.create({ data: { participant_id: participant.id, room_id: room.id, text_version: 1 } });
      expect(await prisma.consentRecord.count({ where: { room_id: room.id } })).toBe(1);
      await prisma.user.delete({ where: { id: host.id } });
    } finally {
      await prisma.$disconnect();
    }
  });
});
