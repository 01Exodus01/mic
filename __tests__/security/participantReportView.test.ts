/**
 * __tests__/security/participantReportView.test.ts
 * PT-02: the report delivered to a participant must not expose per-voter
 * metrics (`__metrics`), participant ids or other voters' cix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ROOM_ID = 'room-1';
const PARTICIPANT_A = 'participant-a-id';
const PARTICIPANT_B = 'participant-b-id';
const OPTION_IDS = ['opt-1', 'opt-2', 'opt-3'];

const sessionState: { current: { participantId: string; roomId: string; nickname: string; blindCode: string } | null } = {
  current: null,
};

const storedReport = {
  id: 'report-1',
  room_id: ROOM_ID,
  round: 1,
  effective_voters: 3,
  obtained_tau: 0.42,
  created_at: new Date('2026-11-04T10:00:00Z'),
  collective_ranking: [
    { id: 'opt-1', midRank: 1.5, score: 4 },
    { id: 'opt-2', midRank: 1.5, score: 4 },
    { id: 'opt-3', midRank: 3, score: 1 },
  ],
  arguments_json: {
    'opt-1': [
      {
        blindCode: 'P-07',
        codigoCiego: 'P-07',
        position: 1,
        posicion: 1,
        justification: 'Razón textual de A sobre la opción 1',
        justificacion: 'Razón textual de A sobre la opción 1',
        participantId: PARTICIPANT_A,
      },
      {
        blindCode: 'P-12',
        position: 2,
        justification: 'Razón textual de B sobre la opción 1',
      },
    ],
    'opt-2': [],
    'opt-3': [],
    __metrics: {
      tauStar: 0.42,
      stuartTauStar: 0.4,
      gammaTauStar: 0.5,
      voters: [
        { participantId: PARTICIPANT_A, tauB: 0.33, cix: 0.6650001, stuartTauC: 0.3, stuartCix: 0.65, gamma: 0.4, gammaCix: 0.7 },
        { participantId: PARTICIPANT_B, tauB: -0.33, cix: 0.3350001, stuartTauC: -0.3, stuartCix: 0.35, gamma: -0.4, gammaCix: 0.3 },
      ],
    },
  },
};

vi.mock('next/headers', () => ({ headers: () => new Headers(), cookies: () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

vi.mock('@/lib/participant-session', () => ({
  getParticipantSession: async () => sessionState.current,
  createParticipantSession: async () => undefined,
  clearParticipantSession: async () => undefined,
}));

vi.mock('@/lib/round-processor', () => ({
  checkAndProcessExpiredDeadline: async () => undefined,
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    participant: {
      findFirst: async ({ where }: { where: { id: string; room_id: string } }) =>
        [PARTICIPANT_A, PARTICIPANT_B, 'participant-c-id'].includes(where.id) && where.room_id === ROOM_ID
          ? { id: where.id, room_id: ROOM_ID, is_retired: false }
          : null,
    },
    room: {
      findUnique: async () => ({
        id: ROOM_ID,
        title: 'Sala de prueba',
        status: 'ROUND_FEEDBACK',
        current_round: 1,
        max_rounds: 3,
        deadline: null,
        method: 'BORDA',
        tau_threshold: 0.8,
        options: OPTION_IDS.map((id, i) => ({
          id,
          room_id: ROOM_ID,
          title: `Opción ${i + 1}`,
          description: '',
          order_index: i,
        })),
        reports: [storedReport],
      }),
    },
    roundVoterMetric: {
      // PT-30: no stored row, so the view falls back to __metrics
      findUnique: async () => null,
    },
    roomEvent: {
      // PT-12: report already logged as viewed, so no write is attempted here
      findFirst: async () => ({ id: 'event-1' }),
    },
    vote: {
      findMany: async ({ where }: { where: { participant_id: string } }) => [
        {
          id: `vote-${where.participant_id}`,
          participant_id: where.participant_id,
          round: 1,
          option_id: 'opt-1',
          position: 1,
          justification: 'Mi propia razón',
          created_at: new Date('2026-11-04T09:00:00Z'),
          reasons: [],
        },
      ],
    },
  },
}));

async function viewAs(participantId: string, blindCode: string) {
  sessionState.current = { participantId, roomId: ROOM_ID, nickname: 'Nombre', blindCode };
  const { getParticipantRoomView } = await import('@/app/actions/participant');
  const res = await getParticipantRoomView();
  if (!res.success || !res.data) throw new Error('view failed');
  return res.data;
}

describe('PT-02: vista del informe para participantes', () => {
  beforeEach(() => {
    sessionState.current = null;
  });

  it('no entrega __metrics, participantId ni cix en el informe', async () => {
    const data = await viewAs(PARTICIPANT_A, 'P-07');
    const reportJson = JSON.stringify(data.latestReport);

    expect(reportJson).not.toContain('__metrics');
    expect(reportJson).not.toContain('participantId');
    // PT-19: the only cix delivered is the requester's own, under myConcordance
    const { myConcordance, ...rest } = data.latestReport!;
    expect(JSON.stringify(rest)).not.toContain('cix');
    expect(myConcordance).toEqual({ voted: true, cix: 0.6650001 });
    expect(reportJson).not.toContain(PARTICIPANT_A);
    expect(reportJson).not.toContain(PARTICIPANT_B);
    expect(Object.keys(data.latestReport!.arguments_json).sort()).toEqual([...OPTION_IDS].sort());
  });

  it('un participante no recibe datos del otro en ninguna parte de la respuesta', async () => {
    const dataA = await viewAs(PARTICIPANT_A, 'P-07');
    const dataB = await viewAs(PARTICIPANT_B, 'P-12');

    const fullA = JSON.stringify(dataA);
    const fullB = JSON.stringify(dataB);

    expect(fullA).not.toContain(PARTICIPANT_B);
    expect(fullB).not.toContain(PARTICIPANT_A);
    expect(fullA).not.toContain('0.3350001');
    expect(fullB).not.toContain('0.6650001');
    expect(dataA.myVotes.every((v) => v.participant_id === PARTICIPANT_A)).toBe(true);
    expect(dataB.myVotes.every((v) => v.participant_id === PARTICIPANT_B)).toBe(true);
  });

  it('conserva las claves que lee la pantalla de retroalimentación con el texto intacto', async () => {
    const data = await viewAs(PARTICIPANT_A, 'P-07');
    const report = data.latestReport!;

    expect(report.obtained_tau).toBe(0.42);
    expect(report.tau_obtenido).toBe(0.42);
    expect(report.collective_ranking).toEqual(storedReport.collective_ranking);
    expect(report.ranking_colectivo).toEqual(storedReport.collective_ranking);
    expect(report.arguments_json['opt-1']).toEqual([
      {
        blindCode: 'P-07',
        codigoCiego: 'P-07',
        position: 1,
        justification: 'Razón textual de A sobre la opción 1',
        justificacion: 'Razón textual de A sobre la opción 1',
      },
      {
        blindCode: 'P-12',
        codigoCiego: 'P-12',
        position: 2,
        justification: 'Razón textual de B sobre la opción 1',
        justificacion: 'Razón textual de B sobre la opción 1',
      },
    ]);
    expect(report.argumentos_json).toEqual(report.arguments_json);
  });
});

describe('PT-19: cada participante ve solo su nivel de concordancia', () => {
  it('A recibe su cix y no el de B; B recibe el suyo y no el de A', async () => {
    const dataA = await viewAs(PARTICIPANT_A, 'P-07');
    const dataB = await viewAs(PARTICIPANT_B, 'P-12');
    expect(dataA.latestReport!.myConcordance).toEqual({ voted: true, cix: 0.6650001 });
    expect(dataB.latestReport!.myConcordance).toEqual({ voted: true, cix: 0.3350001 });
    expect(JSON.stringify(dataA)).not.toContain('0.3350001');
    expect(JSON.stringify(dataB)).not.toContain('0.6650001');
  });

  it('quien no votó en la ronda recibe "sin voto" en lugar de un cix', async () => {
    const data = await viewAs('participant-c-id', 'P-20');
    expect(data.latestReport!.myConcordance).toEqual({ voted: false, cix: null });
    expect(JSON.stringify(data)).not.toContain('0.6650001');
    expect(JSON.stringify(data)).not.toContain('0.3350001');
  });

  it('entrega sus propias posiciones de la ronda del informe', async () => {
    const data = await viewAs(PARTICIPANT_A, 'P-07');
    expect(data.latestReport!.myPositions).toEqual({ 'opt-1': 1 });
    expect(data.latestReport!.tieBreak).toEqual({ rule: 'NONE', applied: false });
    expect(data.latestReport!.reasonsByOption['opt-1']).toEqual({ reasonsFor: [], reasonsAgainst: [] });
  });
});
