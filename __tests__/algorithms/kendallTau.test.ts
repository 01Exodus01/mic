/**
 * __tests__/algorithms/kendallTau.test.ts
 * Tests for Grupo 4: Métrica y algoritmos (D1, AUD-10, AUD-24)
 * Validates Kendall tau-b and Stuart tau-c against scipy.stats.kendalltau across 500 cases.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { computeVoterCIX, computeGroupConsensus } from '@/lib/algorithms/kendallTau';
import { bordaCount } from '@/lib/algorithms/borda';
import { schulzeMethod } from '@/lib/algorithms/schulze';
import { assignMidRanks } from '@/lib/algorithms/midRanks';
import type { Ballot, WeakOrder } from '@/lib/algorithms/types';

describe('Grupo 4: Métrica y algoritmos (D1, AUD-10, AUD-24)', () => {
  describe('D1: Comparación contra SciPy (500 casos con y sin empates)', () => {
    it('verifica tau_b y stuart_tau_c contra scipy.stats.kendalltau con diferencia < 1e-9', () => {
      const fixturePath = path.resolve(__dirname, '../fixtures/scipy_500_cases.json');
      const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

      expect(cases.length).toBe(500);

      let maxDiffB = 0;
      let maxDiffC = 0;

      for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const ballot: Ballot = new Map();
        const collective: WeakOrder[] = [];

        for (let j = 0; j < c.n; j++) {
          const id = `opt_${j}`;
          ballot.set(id, c.ballot[j]);
          collective.push({ id, midRank: c.collective[j], score: 0 });
        }

        const res = computeVoterCIX(ballot, collective, `voter_${i}`);

        const diffB = Math.abs((res.tauB ?? 0) - c.tau_b);
        const diffC = Math.abs((res.stuartTauC ?? 0) - c.tau_c);

        if (diffB > maxDiffB) maxDiffB = diffB;
        if (diffC > maxDiffC) maxDiffC = diffC;

        if (diffB >= 1e-9) {
          throw new Error(
            `[PARADA D1] Caso ${i} superó 1e-9 en tau_b: esperado=${c.tau_b}, obtenido=${res.tauB}, diff=${diffB}`
          );
        }

        if (diffC >= 1e-9) {
          throw new Error(
            `[PARADA D1] Caso ${i} superó 1e-9 en stuart_tau_c: esperado=${c.tau_c}, obtenido=${res.stuartTauC}, diff=${diffC}`
          );
        }

        // Todos los valores de CIX deben estar estrictamente en [0, 1]
        expect(res.cix).toBeGreaterThanOrEqual(0);
        expect(res.cix).toBeLessThanOrEqual(1);
      }

      expect(maxDiffB).toBeLessThan(1e-9);
      expect(maxDiffC).toBeLessThan(1e-9);
    });
  });

  describe('D1: Casos fijos documentados', () => {
    const ballot5: Ballot = new Map([
      ['A', 1],
      ['B', 2],
      ['C', 3],
      ['D', 4],
      ['E', 5],
    ]);

    it('5 opciones, boleta consistente: un empate doble en el grupo da tau_b = 0.9487', () => {
      const groupDoubleTie: WeakOrder[] = [
        { id: 'A', midRank: 1.5, score: 0 },
        { id: 'B', midRank: 1.5, score: 0 },
        { id: 'C', midRank: 3, score: 0 },
        { id: 'D', midRank: 4, score: 0 },
        { id: 'E', midRank: 5, score: 0 },
      ];
      const res = computeVoterCIX(ballot5, groupDoubleTie, 'p1');
      expect(Number((res.tauB ?? 0).toFixed(4))).toBe(0.9487);
    });

    it('5 opciones, boleta consistente: bloques de 3 y 2 dan tau_b = 0.7746', () => {
      const group3and2: WeakOrder[] = [
        { id: 'A', midRank: 2, score: 0 },
        { id: 'B', midRank: 2, score: 0 },
        { id: 'C', midRank: 2, score: 0 },
        { id: 'D', midRank: 4.5, score: 0 },
        { id: 'E', midRank: 4.5, score: 0 },
      ];
      const res = computeVoterCIX(ballot5, group3and2, 'p2');
      expect(Number((res.tauB ?? 0).toFixed(4))).toBe(0.7746);
    });

    it('5 opciones, boleta consistente: bloques de 1 y 4 dan tau_b = 0.6325', () => {
      const group1and4: WeakOrder[] = [
        { id: 'A', midRank: 1, score: 0 },
        { id: 'B', midRank: 3.5, score: 0 },
        { id: 'C', midRank: 3.5, score: 0 },
        { id: 'D', midRank: 3.5, score: 0 },
        { id: 'E', midRank: 3.5, score: 0 },
      ];
      const res = computeVoterCIX(ballot5, group1and4, 'p3');
      expect(Number((res.tauB ?? 0).toFixed(4))).toBe(0.6325);
    });

    it('3 opciones, grupo (A~B)>C y boleta A>B>C: tau_b = 0.8165', () => {
      const ballot3: Ballot = new Map([
        ['A', 1],
        ['B', 2],
        ['C', 3],
      ]);
      const group3: WeakOrder[] = [
        { id: 'A', midRank: 1.5, score: 0 },
        { id: 'B', midRank: 1.5, score: 0 },
        { id: 'C', midRank: 3, score: 0 },
      ];
      const res = computeVoterCIX(ballot3, group3, 'p4');
      expect(Number((res.tauB ?? 0).toFixed(4))).toBe(0.8165);
    });

    it('sin empates, las tres métricas coinciden: idéntica = 1, invertida = -1', () => {
      const ballot: Ballot = new Map([
        ['A', 1],
        ['B', 2],
        ['C', 3],
      ]);
      const identicalGroup: WeakOrder[] = [
        { id: 'A', midRank: 1, score: 10 },
        { id: 'B', midRank: 2, score: 5 },
        { id: 'C', midRank: 3, score: 0 },
      ];
      const resIdentical = computeVoterCIX(ballot, identicalGroup, 'p_id');
      expect(resIdentical.tauB).toBe(1);
      expect(resIdentical.stuartTauC).toBe(1);
      expect(resIdentical.gamma).toBe(1);
      expect(resIdentical.cix).toBe(1);

      const invertedGroup: WeakOrder[] = [
        { id: 'A', midRank: 3, score: 0 },
        { id: 'B', midRank: 2, score: 5 },
        { id: 'C', midRank: 1, score: 10 },
      ];
      const resInverted = computeVoterCIX(ballot, invertedGroup, 'p_inv');
      expect(resInverted.tauB).toBe(-1);
      expect(resInverted.stuartTauC).toBe(-1);
      expect(resInverted.gamma).toBe(-1);
      expect(resInverted.cix).toBe(0);
    });

    it('empate total da CIX = 0.50 por convención documentada', () => {
      const ballot: Ballot = new Map([
        ['A', 1],
        ['B', 2],
        ['C', 3],
      ]);
      const totalTieGroup: WeakOrder[] = [
        { id: 'A', midRank: 2, score: 0 },
        { id: 'B', midRank: 2, score: 0 },
        { id: 'C', midRank: 2, score: 0 },
      ];
      const res = computeVoterCIX(ballot, totalTieGroup, 'p_tie');
      expect(res.cix).toBe(0.5);
      expect(res.stuartCix).toBe(0.5);
      expect(res.gammaCix).toBe(0.5);
      expect(res.tauB).toBe(0);
    });
  });

  describe('AUD-10: Rango medio (n+1)/2 con 0 boletas', () => {
    it('bordaCount con 0 boletas asigna (n+1)/2 a todas las opciones', () => {
      const optionIds3 = ['opt1', 'opt2', 'opt3'];
      const ranking3 = bordaCount([], optionIds3);
      expect(ranking3.length).toBe(3);
      for (const item of ranking3) {
        expect(item.midRank).toBe(2); // (3+1)/2 = 2
        expect(item.score).toBe(0);
      }

      const optionIds4 = ['a', 'b', 'c', 'd'];
      const ranking4 = bordaCount([], optionIds4);
      for (const item of ranking4) {
        expect(item.midRank).toBe(2.5); // (4+1)/2 = 2.5
        expect(item.score).toBe(0);
      }
    });

    it('schulzeMethod con 0 boletas asigna (n+1)/2 a todas las opciones', () => {
      const optionIds = ['x', 'y', 'z', 'w'];
      const ranking = schulzeMethod([], optionIds);
      expect(ranking.length).toBe(4);
      for (const item of ranking) {
        expect(item.midRank).toBe(2.5); // (4+1)/2 = 2.5
        expect(item.score).toBe(0);
      }
    });
  });

  describe('AUD-24: Serialización determinística por ID sin alterar rangos medios', () => {
    it('assignMidRanks ordena opciones empatadas por ID ascendentemente manteniendo idéntico midRank', () => {
      const items = [
        { id: 'opt_B', score: 10 },
        { id: 'opt_A', score: 10 },
        { id: 'opt_C', score: 10 },
      ];

      const ranked = assignMidRanks(items);

      // Todos deben tener exactamente midRank = (1+2+3)/3 = 2
      expect(ranked.every((r) => r.midRank === 2)).toBe(true);

      // Serialización determinística por ID
      expect(ranked.map((r) => r.id)).toEqual(['opt_A', 'opt_B', 'opt_C']);
    });

    it('preserva el ordenamiento por puntaje superior antes del desempate lexicográfico', () => {
      const items = [
        { id: 'opt_Z', score: 5 },
        { id: 'opt_A', score: 20 },
        { id: 'opt_Y', score: 10 },
        { id: 'opt_X', score: 10 },
      ];

      const ranked = assignMidRanks(items);

      expect(ranked[0]).toEqual({ id: 'opt_A', midRank: 1, score: 20 });
      expect(ranked[1]).toEqual({ id: 'opt_X', midRank: 2.5, score: 10 });
      expect(ranked[2]).toEqual({ id: 'opt_Y', midRank: 2.5, score: 10 });
      expect(ranked[3]).toEqual({ id: 'opt_Z', midRank: 4, score: 5 });
    });
  });
});
