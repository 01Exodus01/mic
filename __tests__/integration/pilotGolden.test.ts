/**
 * __tests__/integration/pilotGolden.test.ts
 * Golden test of the normalized export with the pilot room R7PUEM (plan de
 * mejora de los reportes, P3.5) plus the invariants every export must satisfy.
 *
 * Golden values from the plan: round 1 Borda 3-3-3 (Condorcet cycle, resolved
 * by the tie-break), CIX 0.5556 and mean tau 0.1111; round 2 ranking
 * …0003 > …0004 > …0002, CIX 0.6667, mean tau 0.3333, delta 0.1111.
 */

import { describe, it, expect } from 'vitest';
import { buildExportTables } from '@/lib/export/tables';
import { tableToCsv, type CsvTable } from '@/lib/export/format';
import { runAggregationEngine } from '@/lib/algorithms/engine';
import { computeVoterCIX } from '@/lib/algorithms/kendallTau';
import { loadPilotDataset, PILOT_OPTIONS } from '../fixtures/pilot_R7PUEM/loadPilot';

const [O2, O3, O4] = PILOT_OPTIONS;
const tables = buildExportTables(loadPilotDataset());
const table = (name: string) => tables.find((t) => t.name === name) as CsvTable;
const rowsOf = (name: string) => {
  const t = table(name);
  return t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i]])));
};

describe('Piloto R7PUEM: valores de referencia', () => {
  it('P0.1: collective_cix, mean_tau y delta_cix por ronda', () => {
    const rm = rowsOf('round_metrics.csv');
    expect(rm.map((r) => [r.round, r.collective_cix, r.mean_tau, r.delta_cix])).toEqual([
      [1, 0.5556, 0.1111, 0],
      [2, 0.6667, 0.3333, 0.1111],
    ]);
    expect(table('round_metrics.csv').headers).not.toContain('collective_tau');
    expect(table('round_metrics.csv').headers).not.toContain('delta_tau');
  });

  it('P0.2: redondeo único de 4 decimales, ningún valor a 3 decimales', () => {
    for (const name of ['round_metrics.csv', 'voter_round_metrics.csv', 'option_round_scores.csv', 'rooms.csv']) {
      const csv = tableToCsv(table(name));
      for (const line of csv.split('\r\n').slice(1)) {
        for (const cell of line.split(',')) {
          if (/^-?\d+\.\d+$/.test(cell)) expect(cell.split('.')[1].length, `${name}: ${cell}`).toBe(4);
        }
      }
    }
    // delta of round 2 printed with 4 decimals; exact values keep 4 decimals too
    expect(tableToCsv(table('round_metrics.csv'))).toContain(',0.1111,');
    expect(tableToCsv(table('voter_round_metrics.csv'))).toContain(',0.5000,');
    expect(tableToCsv(table('voter_round_metrics.csv'))).toContain('-0.3333');
    expect(tableToCsv(table('voter_round_metrics.csv'))).not.toContain("'-0.3333");
  });

  it('P0.3: Borda 3-3-3 en la ronda 1, empate detectado y regla que lo resolvió', () => {
    const scores = rowsOf('option_round_scores.csv').filter((r) => r.round === 1);
    expect(scores.map((r) => r.borda_score)).toEqual([3, 3, 3]);
    expect(scores.find((r) => r.option_id === O2)!.tied_with).toBe([O3, O4].sort().join(';'));
    const r1 = rowsOf('round_metrics.csv')[0];
    expect(r1.tie_detected).toBe('true');
    // Pilot computed with r-fast-cr-2: no reasons, so the host's list order decided
    expect(r1.tie_resolved_by).toBe('REASON_BALANCE+LIST_ORDER');
    expect(r1.tie_seed).toBe('');
  });

  it('ronda 2: orden …0003 > …0004 > …0002 sin empate, y el motor lo reproduce', () => {
    const r2 = rowsOf('round_metrics.csv')[1];
    expect(r2.collective_ranking).toBe(`${O3}:1 > ${O4}:2 > ${O2}:3`);
    expect(r2.tie_detected).toBe('false');
    const ds = loadPilotDataset();
    const ballots = new Map<string, Map<string, number>>();
    for (const v of ds.votes.filter((x) => x.round === 2)) {
      const b = ballots.get(v.participant_id) ?? new Map<string, number>();
      b.set(v.option_id, v.position);
      ballots.set(v.participant_id, b);
    }
    const out = runAggregationEngine({
      optionIds: PILOT_OPTIONS, ballots, method: 'BORDA', minMembers: 3, tauThreshold: 0.8, currentRound: 2, maxRounds: 3,
      tieBreak: { rule: 'REASON_BALANCE', optionOrder: PILOT_OPTIONS, reasonBalance: {}, seed: 1 },
      concordanceVariant: 'WITHOUT_TIES',
    });
    expect([...out.result!.ranking].sort((a, b) => a.midRank - b.midRank).map((r) => r.id)).toEqual([O3, O4, O2]);
    expect(Number(out.result!.tauStar.toFixed(4))).toBe(0.6667);
  });

  it('P0.5: versión del procedimiento y de la app en rooms.csv', () => {
    const room = rowsOf('rooms.csv')[0];
    expect(room.procedure_version).toBe('r-fast-cr-2');
    expect(room.app_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(room.room_name).toBe('Sala piloto R7PUEM');
    expect(table('rooms.csv').headers).not.toContain('course');
    expect(table('rooms.csv').headers).not.toContain('group_label');
  });

  it('P0.6: votes_long no tiene justification_text ni columnas de configuración', () => {
    const h = table('votes_long.csv').headers;
    expect(h).not.toContain('justification_text');
    for (const cfg of ['method', 'tie_break_rule', 'concordance_variant', 'room_status']) expect(h).not.toContain(cfg);
  });

  it('P1.2: el participante 36 aparece con su ronda de ingreso y sin votos', () => {
    const p36 = rowsOf('participants.csv').find((p) => p.blind_code === 'Participante 36')!;
    expect(p36).toMatchObject({ joined_round: 2, status: 'NEVER_VOTED', voted_rounds: '' });
    const r2 = rowsOf('rounds.csv')[1];
    // Joined after round 2 closed: not counted among round 2 participants
    expect(r2.n_joined).toBe(3);
  });

  it('P1.3: la ronda 1 cerró porque votaron todos, con 30 minutos configurados', () => {
    const r1 = rowsOf('rounds.csv')[0];
    expect(r1).toMatchObject({ closed_reason: 'ALL_VOTED', configured_minutes: 30, n_voted: 3, effective_voters: 3, n_excluded: 0, status: 'REPORTED' });
    expect(rowsOf('round_metrics.csv').map((r) => [r.consensus_reached, r.stop_reason])).toEqual([
      ['false', 'CONTINUE'],
      ['false', 'CONTINUE'],
    ]);
  });

  it('P1.5: P35 no cambió entre rondas: changed_vs_prev_round false y distancia 0', () => {
    const p35 = rowsOf('votes_long.csv').filter((v) => v.blind_code === 'Participante 35' && v.round === 2);
    expect(p35.map((v) => v.changed_vs_prev_round)).toEqual(['false', 'false', 'false']);
    const m = rowsOf('voter_round_metrics.csv').find((r) => r.blind_code === 'Participante 35' && r.round === 2)!;
    expect(m.kendall_distance_to_prev_round).toBe(0);
    // Round 1 has no previous round
    expect(rowsOf('voter_round_metrics.csv').find((r) => r.blind_code === 'Participante 35' && r.round === 1)!.kendall_distance_to_prev_round).toBe('');
  });

  it('P1.6 parcial: la variante sin empates no exporta tau_c ni gamma', () => {
    expect(table('voter_round_metrics.csv').headers).not.toContain('tau_c');
    expect(table('voter_round_metrics.csv').headers).not.toContain('gamma');
  });

  it('P2.5: eventos con nombres unificados y datos aplanados, sin JSON', () => {
    const ev = rowsOf('events.csv');
    expect(ev.map((e) => e.type)).not.toContain('room_started');
    expect(ev.filter((e) => e.type === 'round_opened').map((e) => [e.round, e.minutes])).toEqual([[1, 30], [2, 15]]);
    expect(table('events.csv').headers).not.toContain('data');
    expect(table('events.csv').headers).toContain('changed_vs_prev_version');
    const csv = tableToCsv(table('events.csv'));
    expect(csv).not.toMatch(/[{}]/);
    // report_viewed of round 1 seen during round 2: report_round 1, round 2
    const p35view = ev.find((e) => e.type === 'report_delivered' && e.blind_code === 'Participante 35')!;
    expect([p35view.round, p35view.report_round]).toEqual([2, 1]);
    expect(Number(p35view.t_since_round_open_s)).toBeGreaterThan(0);
  });
});

describe('Invariantes del export (piloto)', () => {
  const rm = rowsOf('round_metrics.csv');
  const vm = rowsOf('voter_round_metrics.csv');
  const scores = rowsOf('option_round_scores.csv');
  const options = new Set(rowsOf('options.csv').map((o) => o.option_id));
  const participants = new Set(rowsOf('participants.csv').map((p) => p.blind_code));

  it('1. collective_cix = (mean_tau + 1) / 2', () => {
    for (const r of rm) expect(Math.abs(Number(r.collective_cix) - (Number(r.mean_tau) + 1) / 2)).toBeLessThanOrEqual(0.0001);
  });

  it('2. cix del votante = (tau + 1) / 2', () => {
    for (const r of vm) expect(Math.abs(Number(r.cix) - (Number(r.tau_b) + 1) / 2)).toBeLessThanOrEqual(0.0001);
  });

  it('3. suma de Borda por ronda = votantes × m(m−1)/2', () => {
    const m = options.size;
    for (const r of rm) {
      const sum = scores.filter((s) => s.round === r.round).reduce((a, s) => a + Number(s.borda_score), 0);
      expect(sum).toBe(Number(r.effective_voters) * ((m * (m - 1)) / 2));
    }
  });

  it('4. el orden del grupo es coherente con Borda o con el desempate registrado', () => {
    for (const r of rm) {
      const s = scores.filter((x) => x.round === r.round);
      for (const a of s) {
        for (const b of s) {
          if (Number(a.borda_score) > Number(b.borda_score)) expect(Number(a.final_rank)).toBeLessThan(Number(b.final_rank));
          if (Number(a.borda_score) === Number(b.borda_score) && a.option_id !== b.option_id) {
            expect(String(a.tied_with).split(';')).toContain(b.option_id);
            expect(r.tie_resolved_by).not.toBe('');
          }
        }
      }
    }
  });

  it('5. delta_cix(r) = cix(r) − cix(r−1); ronda 1 = 0', () => {
    expect(rm[0].delta_cix).toBe(0);
    for (let i = 1; i < rm.length; i++) {
      expect(Math.abs(Number(rm[i].delta_cix) - (Number(rm[i].collective_cix) - Number(rm[i - 1].collective_cix)))).toBeLessThanOrEqual(0.0001);
    }
  });

  it('6. todo option_id de votos y razones existe en options.csv', () => {
    for (const v of rowsOf('votes_long.csv')) expect(options.has(v.option_id)).toBe(true);
    for (const r of rowsOf('reasons.csv')) expect(options.has(r.option_id)).toBe(true);
  });

  it('7. todo blind_code de votos existe en participants.csv', () => {
    for (const v of rowsOf('votes_long.csv')) expect(participants.has(v.blind_code)).toBe(true);
  });

  it('8. con órdenes sin empates, tau_b = tau_c = gamma', () => {
    const ds = loadPilotDataset();
    const report = ds.reports.find((r) => r.round === 2)!;
    for (const v of ['p-09', 'p-21', 'p-35']) {
      const ballot = new Map(ds.votes.filter((x) => x.round === 2 && x.participant_id === v).map((x) => [x.option_id, x.position]));
      const m = computeVoterCIX(ballot, report.collective_ranking as unknown as never, v);
      expect(m.tauB).toBeCloseTo(m.stuartTauC!, 12);
      expect(m.tauB).toBeCloseTo(m.gamma!, 12);
    }
  });
});

describe('P1.6: ambas variantes con regla de desempate (piloto)', () => {
  it('exporta tau-b contra el orden con empates además del oficial sin empates', () => {
    const vm = rowsOf('voter_round_metrics.csv');
    expect(table('voter_round_metrics.csv').headers).toEqual(expect.arrayContaining(['tau_b_weak_order', 'cix_weak_order']));
    // Round 1 was a total tie before the rule: tau-b against it is 0 (CIX 0.5) for everybody
    expect(vm.filter((r) => r.round === 1).map((r) => [r.tau_b_weak_order, r.cix_weak_order])).toEqual([[0, 0.5], [0, 0.5], [0, 0.5]]);
    // Round 2 had no ties: both variants coincide
    for (const r of vm.filter((x) => x.round === 2)) expect(r.tau_b_weak_order).toBe(r.tau_b);
    const rm = rowsOf('round_metrics.csv');
    expect(rm.map((r) => [r.mean_tau_weak_order, r.collective_cix_weak_order])).toEqual([[0, 0.5], [0.3333, 0.6667]]);
  });
});
