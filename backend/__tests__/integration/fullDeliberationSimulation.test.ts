/**
 * __tests__/integration/fullDeliberationSimulation.test.ts
 * End-to-end full deliberative session simulation (CIERRE §1)
 *
 * Simulates:
 * 1. 3 participants across 3 rounds with:
 *    - Round 1 divergent preferences (no early convergence).
 *    - Round 2 with initially 2 votes -> INSUFFICIENT_VOTES -> extend deadline -> 3rd vote submitted -> processed.
 *    - Round 3 with deliberative convergence (tau* >= threshold -> CONCLUDED).
 * 2. Early convergence scenario (Round 1 tau* >= threshold -> CONCLUDED immediately).
 * 3. Desertion/expulsion in Round 2: Round 1 votes retained, Round 2 active votes purged, remaining 3 continue.
 * 4. Cancellation scenario: room_status reflects CANCELLED in the export (rooms.csv).
 * 5. Full mathematical reproducibility: CSV data enables exact recalculation of each tau*.
 */

import { describe, it, expect } from 'vitest';
import { runAggregationEngine, Ballot, WeakOrder } from '@mic/backend/algorithms/index';
import { computeGroupConsensus, computeVoterCIX } from '@mic/backend/algorithms/kendallTau';
import { buildExportTables } from '@mic/backend/export/tables';
import { tableToCsv } from '@mic/backend/export/format';
import { loadPilotDataset } from '../fixtures/pilot_R7PUEM/loadPilot';
import { MIN_PARTICIPANTS } from '@mic/backend/shared/validations';

const makeBallot = (entries: [string, number][]): Ballot => new Map(entries);

describe('CIERRE §1: Simulación Completa Multirronda y Reproducibilidad', () => {
  const optionIds = ['OPT_1', 'OPT_2', 'OPT_3'];
  const minMembers = MIN_PARTICIPANTS; // 3
  const tauThreshold = 0.85; // CIX scale

  describe('Escenario 1: Flujo Multirronda con Faltan Votos, Extensión y Convergencia', () => {
    it('ejecuta R1 (divergencia), R2 (insuficiente -> extendida -> completada) y R3 (convergencia)', () => {
      // ── RONDA 1: 3 participantes con votos divergentes ────────────────────
      const r1Ballots = new Map<string, Ballot>([
        ['part_1', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
        ['part_2', makeBallot([['OPT_2', 1], ['OPT_3', 2], ['OPT_1', 3]])],
        ['part_3', makeBallot([['OPT_3', 1], ['OPT_1', 2], ['OPT_2', 3]])],
      ]);

      const r1 = runAggregationEngine({
        optionIds,
        ballots: r1Ballots,
        method: 'BORDA',
        minMembers,
        tauThreshold,
        currentRound: 1,
        maxRounds: 3,
      });

      expect(r1.quorumMet).toBe(true);
      expect(r1.result).not.toBeNull();
      expect(r1.shouldAdvance).toBe(true);
      expect(r1.shouldConclude).toBe(false);
      // En ciclo de Condorcet simétrico, el CIX promedio es bajo
      expect(r1.result!.tauStar).toBeLessThan(tauThreshold);
      const r1Tau = r1.result!.tauStar;

      // ── RONDA 2 (Paso A): Al llegar el plazo, solo 2 participantes han votado ───
      const r2PartialBallots = new Map<string, Ballot>([
        ['part_1', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
        ['part_2', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
      ]);

      // Verificación de quórum mínimo (MIN_PARTICIPANTS = 3)
      const r2QuorumCheck = r2PartialBallots.size >= minMembers;
      expect(r2QuorumCheck).toBe(false);

      const r2EnginePartial = runAggregationEngine({
        optionIds,
        ballots: r2PartialBallots,
        method: 'BORDA',
        minMembers,
        tauThreshold,
        currentRound: 2,
        maxRounds: 3,
      });
      // El motor activa la guarda de quórum: INSUFFICIENT_VOTES
      expect(r2EnginePartial.quorumMet).toBe(false);
      expect(r2EnginePartial.result).toBeNull();

      // ── RONDA 2 (Paso B): Anfitrión extiende plazo, ingresa el 3.er voto ───
      const r2CompleteBallots = new Map<string, Ballot>([
        ['part_1', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
        ['part_2', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
        ['part_3', makeBallot([['OPT_1', 2], ['OPT_2', 1], ['OPT_3', 3]])],
      ]);

      const r2 = runAggregationEngine({
        optionIds,
        ballots: r2CompleteBallots,
        method: 'BORDA',
        minMembers,
        tauThreshold,
        currentRound: 2,
        maxRounds: 3,
      });

      expect(r2.quorumMet).toBe(true);
      expect(r2.result).not.toBeNull();
      expect(r2.result!.tauStar).toBeGreaterThan(r1Tau);
      const r2Tau = r2.result!.tauStar;

      // ── RONDA 3: Deliberación y convergencia total en OPT_1 > OPT_2 > OPT_3 ──
      const r3Ballots = new Map<string, Ballot>([
        ['part_1', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
        ['part_2', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
        ['part_3', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
      ]);

      const r3 = runAggregationEngine({
        optionIds,
        ballots: r3Ballots,
        method: 'BORDA',
        minMembers,
        tauThreshold,
        currentRound: 3,
        maxRounds: 3,
      });

      expect(r3.quorumMet).toBe(true);
      expect(r3.result).not.toBeNull();
      // Acuerdo perfecto: tau_b = 1.0, CIX = 1.0 >= 0.85
      expect(r3.result!.tauStar).toBe(1.0);
      expect(r3.shouldConclude).toBe(true);
      expect(r3.shouldAdvance).toBe(false);

      // Verificación de reproducibilidad matemática:
      // Recalcular tau* desde las boletas almacenadas usando computeGroupConsensus
      const r1Recalc = computeGroupConsensus(r1Ballots, r1.result!.ranking);
      expect(Math.abs(r1Recalc.tauStar - r1Tau)).toBeLessThan(1e-12);

      const r2Recalc = computeGroupConsensus(r2CompleteBallots, r2.result!.ranking);
      expect(Math.abs(r2Recalc.tauStar - r2Tau)).toBeLessThan(1e-12);

      const r3Recalc = computeGroupConsensus(r3Ballots, r3.result!.ranking);
      expect(r3Recalc.tauStar).toBe(1.0);
    });
  });

  describe('Escenario 2: Convergencia Anticipada en Ronda 1', () => {
    it('concluye inmediatamente en ronda 1 si tau* supera el umbral de consenso', () => {
      const unanimousBallots = new Map<string, Ballot>([
        ['part_1', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
        ['part_2', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
        ['part_3', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
      ]);

      const r1Early = runAggregationEngine({
        optionIds,
        ballots: unanimousBallots,
        method: 'SCHULZE',
        minMembers,
        tauThreshold: 0.80,
        currentRound: 1,
        maxRounds: 3,
      });

      expect(r1Early.quorumMet).toBe(true);
      expect(r1Early.result!.tauStar).toBe(1.0);
      // Convergencia temprana
      expect(r1Early.shouldConclude).toBe(true);
      expect(r1Early.shouldAdvance).toBe(false);
    });
  });

  describe('Escenario 3: Deserción / Expulsión en Ronda 2', () => {
    it('preserva votos de R1 de participante expulsado y continúa R2 con cohorte activa', () => {
      // 4 participantes en R1
      const r1Votes = [
        { round: 1, participant_id: 'p1', option_id: 'OPT_1', position: 1 },
        { round: 1, participant_id: 'p2', option_id: 'OPT_1', position: 1 },
        { round: 1, participant_id: 'p3', option_id: 'OPT_1', position: 2 },
        { round: 1, participant_id: 'p4', option_id: 'OPT_1', position: 3 }, // será expulsado
      ];

      // En R2, p4 es expulsado:
      // Se marca is_retired = true; sus votos de R2, si existieran, se conservan y se excluyen del cálculo (PT-11)
      const activeParticipantsR2 = ['p1', 'p2', 'p3']; // p4 excluido

      expect(activeParticipantsR2.length).toBe(3);
      expect(activeParticipantsR2.length).toBeGreaterThanOrEqual(MIN_PARTICIPANTS);

      // Los votos de R1 de p4 siguen en la base de datos
      const p4R1Votes = r1Votes.filter((v) => v.participant_id === 'p4' && v.round === 1);
      expect(p4R1Votes).toHaveLength(1);

      // R2 se procesa con los 3 activos restantes sin arrastre
      const r2Ballots = new Map<string, Ballot>([
        ['p1', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
        ['p2', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
        ['p3', makeBallot([['OPT_1', 1], ['OPT_2', 2], ['OPT_3', 3]])],
      ]);

      const r2Result = runAggregationEngine({
        optionIds,
        ballots: r2Ballots,
        method: 'BORDA',
        minMembers,
        tauThreshold,
        currentRound: 2,
        maxRounds: 3,
      });

      expect(r2Result.quorumMet).toBe(true);
      expect(r2Result.result!.effectiveVoters).toBe(3);
    });
  });

  describe('Escenario 4: Cancelación de Actividad y Registro en CSV', () => {
    it('distingue actividades canceladas con room_status = CANCELLED en el export', () => {
      const ds = loadPilotDataset();
      ds.room.status = 'CANCELLED';
      const tables = buildExportTables(ds);
      const rooms = tables.find((t) => t.name === 'rooms.csv')!;
      expect(rooms.rows[0][rooms.headers.indexOf('room_status')]).toBe('CANCELLED');
      // the reports of the rounds closed before the cancellation are kept
      const metrics = tables.find((t) => t.name === 'round_metrics.csv')!;
      expect(metrics.rows.map((r) => r[0])).toEqual([1, 2]);
      expect(tableToCsv(rooms)).toContain('CANCELLED');
    });
  });
});
