/**
 * frontend/__tests__/integration/reasonModeration.test.ts
 * Team request 2026-11-24: the host hides inappropriate reasons without
 * knowing who wrote them. A hidden reason leaves everyone's feedback, only its
 * author is told (with the text), the selection keeps counting, and the
 * research export keeps it flagged (never its text in publication mode).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
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

const OFFENSIVE = 'Texto ofensivo de prueba';

describe.skipIf(!hasTestDb)('moderación de razones (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let fx: RoomFixture;
  let other: RoomFixture;
  const as = (i: number) => {
    state.session = { participantId: fx.participantIds[i], roomId: fx.roomId, nickname: `Persona ${i + 1}`, blindCode: fx.blindCodes[i] };
  };
  const ballot = (i: number, reasons: Record<number, string[]> = {}) =>
    fx.optionIds.map((optionId, k) => ({ optionId, position: ((k + i) % 3) + 1, reasonsFor: reasons[k] ?? [] }));
  const allReasonTexts = (view: { latestReport: { reasonsByOption: Record<string, { reasonsFor: Array<{ text: string }> }> } | null }) =>
    Object.values(view.latestReport?.reasonsByOption ?? {}).flatMap((o) => o.reasonsFor.map((r) => r.text));

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    fx = await createRoomFixture(prisma, { participants: 3, room: { tau_threshold: 0.99, max_rounds: 3 } });
    other = await createRoomFixture(prisma, { participants: 1 });
    state.hostId = fx.hostId;
    const p = await import('@/app/actions/participant');
    as(0);
    expect((await p.submitVote(ballot(0, { 0: [OFFENSIVE, 'Razón correcta de la misma persona'] }))).success).toBe(true);
    as(1);
    expect((await p.submitVote(ballot(1, { 0: ['Razón de otra persona'] }))).success).toBe(true);
    as(2);
    expect((await p.submitVote(ballot(2))).success).toBe(true);
  });

  afterAll(async () => {
    await cleanupFixture(prisma, fx);
    await cleanupFixture(prisma, other);
    await prisma.$disconnect();
  });

  it('el anfitrión ve las razones de la ronda abierta sin autor, ordenadas por texto', async () => {
    const m = await import('@/app/actions/moderation');
    const res = await m.getReasonsForModeration(fx.roomId);
    if (!res.success || !res.data) throw new Error('moderation list failed');
    expect(res.data.round).toBe(1);
    const texts = res.data.options[0].reasons.map((r) => r.text);
    expect(texts).toEqual(['Razón correcta de la misma persona', 'Razón de otra persona', OFFENSIVE]);
    const json = JSON.stringify(res.data);
    for (const id of fx.participantIds) expect(json).not.toContain(id);
    for (const code of fx.blindCodes) expect(json).not.toContain(code);
  });

  it('ocultar durante la ronda: el autor ve el aviso con el texto; nadie más', async () => {
    const m = await import('@/app/actions/moderation');
    const list = await m.getReasonsForModeration(fx.roomId);
    const target = list.success && list.data?.options[0].reasons.find((r) => r.text === OFFENSIVE);
    if (!target) throw new Error('reason not listed');
    expect((await m.setReasonHidden(fx.roomId, target.id, true)).success).toBe(true);

    const p = await import('@/app/actions/participant');
    as(0);
    const mine = await p.getParticipantRoomView();
    expect(mine.success && mine.data?.myHiddenReasons).toEqual([{ round: 1, optionTitle: 'Opción 1', side: 'FOR', text: OFFENSIVE }]);
    as(1);
    const theirs = await p.getParticipantRoomView();
    expect(theirs.success && theirs.data?.myHiddenReasons).toEqual([]);
    // The log keeps who and where, never the text
    const ev = await prisma.roomEvent.findFirstOrThrow({ where: { room_id: fx.roomId, type: 'reason_hidden' } });
    expect(JSON.stringify(ev.data)).not.toContain(OFFENSIVE);
  });

  it('volver a enviar la misma razón la mantiene oculta', async () => {
    const p = await import('@/app/actions/participant');
    as(0);
    expect((await p.submitVote(ballot(0, { 0: [OFFENSIVE, 'Razón correcta de la misma persona', 'Una razón nueva'] }))).success).toBe(true);
    const m = await import('@/app/actions/moderation');
    const list = await m.getReasonsForModeration(fx.roomId);
    const reasons = list.success ? list.data!.options[0].reasons : [];
    expect(reasons.find((r) => r.text === OFFENSIVE)?.hidden).toBe(true);
    expect(reasons.filter((r) => r.hidden)).toHaveLength(1);
  });

  it('al cerrar la ronda la razón no aparece en la retroalimentación y la selección cuenta', async () => {
    const room = await import('@/app/actions/room');
    expect((await room.closeRoundManually(fx.roomId)).success).toBe(true);
    const report = await prisma.roundReport.findUniqueOrThrow({ where: { room_id_round: { room_id: fx.roomId, round: 1 } } });
    expect(report.effective_voters).toBe(3);

    const p = await import('@/app/actions/participant');
    for (const i of [0, 1]) {
      as(i);
      const view = await p.getParticipantRoomView();
      if (!view.success || !view.data) throw new Error('view failed');
      const texts = allReasonTexts(view.data as never);
      expect(texts).not.toContain(OFFENSIVE);
      expect(texts).toContain('Razón de otra persona');
      expect(texts).toContain('Razón correcta de la misma persona');
    }
  });

  it('deshacer: la razón vuelve a la retroalimentación', async () => {
    const m = await import('@/app/actions/moderation');
    const list = await m.getReasonsForModeration(fx.roomId, 1);
    const target = list.success && list.data?.options[0].reasons.find((r) => r.text === OFFENSIVE);
    if (!target) throw new Error('reason not listed');
    expect((await m.setReasonHidden(fx.roomId, target.id, false)).success).toBe(true);
    const p = await import('@/app/actions/participant');
    as(1);
    const view = await p.getParticipantRoomView();
    expect(allReasonTexts(view.success ? (view.data as never) : { latestReport: null })).toContain(OFFENSIVE);
    as(0);
    expect(((await p.getParticipantRoomView()) as { data?: { myHiddenReasons: unknown[] } }).data?.myHiddenReasons).toEqual([]);
    expect((await m.setReasonHidden(fx.roomId, target.id, true)).success).toBe(true);
  });

  it('solo el anfitrión del grupo, y solo razones de su grupo', async () => {
    const m = await import('@/app/actions/moderation');
    const list = await m.getReasonsForModeration(fx.roomId, 1);
    const target = list.success ? list.data!.options[0].reasons[0] : null;
    state.hostId = other.hostId;
    expect((await m.getReasonsForModeration(fx.roomId)).success).toBe(false);
    expect((await m.setReasonHidden(other.roomId, target!.id, true)).success).toBe(false);
    state.hostId = null;
    expect((await m.setReasonHidden(fx.roomId, target!.id, true)).success).toBe(false);
    state.hostId = fx.hostId;
  });

  it('el export de investigación la conserva marcada; el de publicación nunca trae su texto', async () => {
    const { loadExportDataset } = await import('@mic/backend/export/dataset');
    const { exportTables } = await import('@mic/backend/export/bundle');
    const ds = await loadExportDataset(prisma, fx.roomId);
    const rowsOf = (tables: ReturnType<typeof exportTables>) => {
      const t = tables.find((x) => x.name === 'reasons.csv')!;
      return t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i]])));
    };
    const research = rowsOf(exportTables(ds!, { mode: 'research', includeText: true }));
    const flagged = research.filter((r) => r.moderated === 'true');
    expect(flagged.map((r) => r.text)).toEqual([OFFENSIVE]);
    expect(flagged[0].moderated_at).not.toBe('');
    const publication = rowsOf(exportTables(ds!, { mode: 'publication', includeText: true }));
    expect(publication.find((r) => r.moderated === 'true')!.text).toBe('');
    expect(publication.some((r) => r.text === 'Razón de otra persona')).toBe(true);
  });
});
