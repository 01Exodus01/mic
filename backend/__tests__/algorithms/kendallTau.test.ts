/**
 * __tests__/algorithms/kendallTau.test.ts
 * Tests for Grupo 4: Métrica y algoritmos (D1, AUD-10, AUD-24)
 * Validates Kendall tau-b and Stuart tau-c against scipy.stats.kendalltau across 500 cases.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { computeVoterCIX, computeGroupConsensus } from '@mic/backend/algorithms/kendallTau';
import { bordaCount } from '@mic/backend/algorithms/borda';
import { schulzeMethod } from '@mic/backend/algorithms/schulze';
import { assignMidRanks } from '@mic/backend/algorithms/midRanks';
import type { Ballot, WeakOrder } from '@mic/backend/algorithms/types';

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

// ─────────────────────────────────────────────────────────────────────────────
// PT-17: variante "sin empates" (Kendall estándar). Incluye el ejemplo resuelto
// a mano de Statistics How To, "Kendall's Tau (Kendall Rank Correlation
// Coefficient)": la página usa (C - D) / (C + D), que sin empates coincide con
// (C - D) / (n(n-1)/2) y con tau-b. Los otros casos se cuentan par por par.
// ─────────────────────────────────────────────────────────────────────────────
import {
  computeVoterCIX as cixOf,
  computeGroupConsensusForVariant,
  isStrictRanking,
} from '@mic/backend/algorithms/kendallTau';
import { runAggregationEngine as engineRun } from '@mic/backend/algorithms/engine';
import { RoomSettingsSchema, FIXED_TIE_BREAK_RULE, FIXED_CONCORDANCE_VARIANT } from '@mic/backend/shared/validations';

function strictOrder(ids: string[]) {
  return ids.map((id, i) => ({ id, midRank: i + 1, score: 0 }));
}

function bruteForceKendall(ballotRanks: number[], groupRanks: number[]) {
  let C = 0;
  let D = 0;
  for (let i = 0; i < ballotRanks.length; i++) {
    for (let j = i + 1; j < ballotRanks.length; j++) {
      const s = Math.sign(ballotRanks[i] - ballotRanks[j]) * Math.sign(groupRanks[i] - groupRanks[j]);
      if (s > 0) C++;
      else if (s < 0) D++;
    }
  }
  const n = ballotRanks.length;
  return (C - D) / ((n * (n - 1)) / 2);
}

describe('PT-17: Kendall estándar sobre un orden del grupo estricto', () => {
  it('Statistics How To: 12 candidatos, C = 61, D = 5, tau = 56/66 ≈ 0.85', () => {
    // Entrevistador 1: A B C D E F G H I J K L (1..12)
    // Entrevistador 2: A B D C F E H G J I L K
    const ids = 'ABCDEFGHIJKL'.split('');
    const interviewer2 = 'ABDCFEHGJILK'.split('');
    const ballot = new Map(interviewer2.map((id, i) => [id, i + 1]));
    const r = cixOf(ballot, strictOrder(ids), 'v');
    expect(r.concordant).toBe(61);
    expect(r.discordant).toBe(5);
    expect(r.tauB).toBeCloseTo(56 / 66, 12);
    expect(Number(r.tauB!.toFixed(2))).toBe(0.85);
    // Same value as the page's (C - D) / (C + D) because there are no ties
    expect(r.tauB).toBeCloseTo((r.concordant - r.discordant) / (r.concordant + r.discordant), 12);
    expect(r.gamma).toBeCloseTo(r.tauB!, 12);
    // Perfect agreement: (66 - 0) / (66 + 0) = 1
    expect(cixOf(new Map(ids.map((id, i) => [id, i + 1])), strictOrder(ids), 'v').tauB).toBe(1);
  });

  it('caso a mano, 4 opciones: C = 5, D = 1, tau = 4/6', () => {
    // Boleta A B C D; grupo A C B D. Pares: AB C, AC C, AD C, BC D, BD C, CD C.
    const ballot = new Map([['A', 1], ['B', 2], ['C', 3], ['D', 4]]);
    const r = cixOf(ballot, strictOrder(['A', 'C', 'B', 'D']), 'v');
    expect(r.concordant).toBe(5);
    expect(r.discordant).toBe(1);
    expect(r.tauB).toBeCloseTo(4 / 6, 12);
    expect(r.cix).toBeCloseTo((4 / 6 + 1) / 2, 12);
  });

  it('caso a mano, 5 opciones: C = 8, D = 2, tau = 0.6', () => {
    // Boleta A B C D E; grupo B A C E D. Discordantes: AB y DE; los otros 8 pares concuerdan.
    const ballot = new Map([['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5]]);
    const r = cixOf(ballot, strictOrder(['B', 'A', 'C', 'E', 'D']), 'v');
    expect([r.concordant, r.discordant]).toEqual([8, 2]);
    expect(r.tauB).toBeCloseTo(0.6, 12);
  });

  it('casos extremos: idéntico = 1, invertido = -1', () => {
    const ballot = new Map([['A', 1], ['B', 2], ['C', 3]]);
    expect(cixOf(ballot, strictOrder(['A', 'B', 'C']), 'v').tauB).toBe(1);
    expect(cixOf(ballot, strictOrder(['C', 'B', 'A']), 'v').tauB).toBe(-1);
  });

  it('en los casos estrictos de SciPy, tau-b coincide con (C - D) / (n(n-1)/2) y con SciPy', () => {
    const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/scipy_500_cases.json'), 'utf8')) as Array<{
      n: number; ballot: number[]; collective: number[]; tau_b: number;
    }>;
    const strict = cases.filter((c) => new Set(c.collective).size === c.n && c.collective.every(Number.isInteger));
    expect(strict.length).toBeGreaterThan(50);
    for (const c of strict) {
      const ids = c.ballot.map((_, i) => `o${i}`);
      const ballot = new Map(ids.map((id, i) => [id, c.ballot[i]]));
      const group = ids.map((id, i) => ({ id, midRank: c.collective[i], score: 0 }));
      const ours = cixOf(ballot, group, 'v').tauB!;
      expect(Math.abs(ours - bruteForceKendall(c.ballot, c.collective))).toBeLessThan(1e-12);
      expect(Math.abs(ours - c.tau_b)).toBeLessThan(1e-9);
    }
  });

  it('la variante sin empates rechaza un orden del grupo con empates', () => {
    const ballots = new Map([['v', new Map([['A', 1], ['B', 2], ['C', 3]])]]);
    const tied = [{ id: 'A', midRank: 1.5, score: 1 }, { id: 'B', midRank: 1.5, score: 1 }, { id: 'C', midRank: 3, score: 0 }];
    expect(isStrictRanking(tied)).toBe(false);
    expect(() => computeGroupConsensusForVariant(ballots, tied, 'WITHOUT_TIES')).toThrow();
    expect(computeGroupConsensusForVariant(ballots, tied, 'WITH_TIES').tauStar).toBeGreaterThan(0);
  });

  it('el motor rechaza "sin empates" con la regla "ninguna" y la registra con una regla', () => {
    const input = {
      optionIds: ['A', 'B', 'C'],
      ballots: new Map([
        ['v1', new Map([['A', 1], ['B', 2], ['C', 3]])],
        ['v2', new Map([['B', 1], ['C', 2], ['A', 3]])],
        ['v3', new Map([['C', 1], ['A', 2], ['B', 3]])],
      ]),
      method: 'BORDA' as const,
      minMembers: 3,
      tauThreshold: 0.8,
      currentRound: 1,
      maxRounds: 3,
    };
    expect(() => engineRun({ ...input, concordanceVariant: 'WITHOUT_TIES', tieBreak: { rule: 'NONE', optionOrder: ['A', 'B', 'C'] } })).toThrow();
    expect(() => engineRun({ ...input, concordanceVariant: 'WITHOUT_TIES' })).toThrow();
    const ok = engineRun({ ...input, concordanceVariant: 'WITHOUT_TIES', tieBreak: { rule: 'LEXICOGRAPHIC', optionOrder: ['A', 'B', 'C'] } });
    expect(ok.result!.concordanceVariant).toBe('WITHOUT_TIES');
    // Same numbers as tau-b on the same strict order
    const tauB = engineRun({ ...input, concordanceVariant: 'WITH_TIES', tieBreak: { rule: 'LEXICOGRAPHIC', optionOrder: ['A', 'B', 'C'] } });
    expect(ok.result!.tauStar).toBe(tauB.result!.tauStar);
  });

  it('E-12: las salas nuevas no eligen regla ni variante; lo que llegue se ignora', () => {
    expect(FIXED_TIE_BREAK_RULE).toBe('PAIRWISE_MAJORITY');
    expect(FIXED_CONCORDANCE_VARIANT).toBe('WITHOUT_TIES');
    const parsed = RoomSettingsSchema.parse({ tieBreakRule: 'NONE', concordanceVariant: 'WITH_TIES' });
    expect(parsed).not.toHaveProperty('tieBreakRule');
    expect(parsed).not.toHaveProperty('concordanceVariant');
  });
});

describe('Tau-c de Statistics How To: (C - D) / (T - t)', () => {
  // t = pares empatados. Con la boleta estricta, los únicos empates son del orden
  // del grupo, así que T - t = C + D: la fórmula de la página es la gamma de pares
  // decididos ya calculada (gamma_decided_pairs). No es la tau-c de Stuart.
  it('coincide con gamma en los 500 casos de SciPy, con y sin empates', () => {
    const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/scipy_500_cases.json'), 'utf8')) as Array<{
      n: number; ballot: number[]; collective: number[];
    }>;
    let withTies = 0;
    for (const c of cases) {
      const ids = c.ballot.map((_, i) => `o${i}`);
      const ballot = new Map(ids.map((id, i) => [id, c.ballot[i]]));
      const group = ids.map((id, i) => ({ id, midRank: c.collective[i], score: 0 }));
      const r = cixOf(ballot, group, 'v');
      const T = (c.n * (c.n - 1)) / 2;
      const t = r.tied ?? 0;
      if (t > 0) withTies++;
      const pageTauC = T - t === 0 ? 0 : (r.concordant - r.discordant) / (T - t);
      expect(Math.abs(pageTauC - (r.gamma ?? NaN))).toBeLessThan(1e-12);
    }
    expect(withTies).toBeGreaterThan(50);
  });
});
