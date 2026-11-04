/**
 * __tests__/algorithms/tieBreak.test.ts
 * PT-16: declared tie-break rules (AGENTS.md E-1, approval E-5).
 *  - NONE: output identical to the engine without a rule.
 *  - LEXICOGRAPHIC / REASON_BALANCE: strict, deterministic order; untied options
 *    keep their position; the report says which groups were tied.
 * Cases: double, triple and total ties for Borda, Schulze and Kemeny-Young.
 */

import { describe, it, expect } from 'vitest';
import { runAggregationEngine, type AggregationMethod } from '../../lib/algorithms/engine';
import { applyTieBreak, findTiedGroups } from '../../lib/algorithms/tieBreak';
import type { Ballot } from '../../lib/algorithms/types';

const ballot = (order: string[]): Ballot => new Map(order.map((id, i) => [id, i + 1]));
const METHODS: AggregationMethod[] = ['BORDA', 'SCHULZE', 'KEMENY_YOUNG'];

function run(method: AggregationMethod, optionIds: string[], orders: string[][], tieBreak?: Parameters<typeof runAggregationEngine>[0]['tieBreak']) {
  return runAggregationEngine({
    optionIds,
    ballots: new Map(orders.map((o, i) => [`v${i}`, ballot(o)])),
    method,
    minMembers: 1,
    tauThreshold: 0.99,
    currentRound: 1,
    maxRounds: 3,
    tieBreak,
  });
}

function isStrict(ranks: number[]) {
  return [...ranks].sort((a, b) => a - b).every((r, i) => r === i + 1);
}

// Profiles that produce ties for every method
const DOUBLE = { ids: ['A', 'B', 'C', 'D'], orders: [['A', 'B', 'C', 'D'], ['B', 'A', 'D', 'C']] }; // {A,B} and {C,D}
const TRIPLE = { ids: ['A', 'B', 'C', 'D'], orders: [['A', 'B', 'C', 'D'], ['B', 'C', 'A', 'D'], ['C', 'A', 'B', 'D']] }; // {A,B,C} then D
const TOTAL = { ids: ['A', 'B', 'C'], orders: [['A', 'B', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B']] }; // all tied

describe('PT-16: regla "ninguna" no cambia nada', () => {
  for (const method of METHODS) {
    it(`${method}: mismo resultado que sin regla, en todos los perfiles`, () => {
      for (const p of [DOUBLE, TRIPLE, TOTAL]) {
        const without = run(method, p.ids, p.orders);
        const withNone = run(method, p.ids, p.orders, { rule: 'NONE', optionOrder: p.ids });
        const { tieBreak, ...rest } = withNone.result!;
        expect(rest).toEqual(without.result);
        expect(withNone.shouldConclude).toBe(without.shouldConclude);
        expect(tieBreak?.applied).toBe(false);
        expect(tieBreak?.tiedGroups.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('PT-16: los perfiles producen empates sin regla', () => {
  for (const method of METHODS) {
    it(`${method}: empate doble, triple y total`, () => {
      expect(findTiedGroups(run(method, DOUBLE.ids, DOUBLE.orders).result!.ranking, DOUBLE.ids).length).toBeGreaterThanOrEqual(1);
      expect(findTiedGroups(run(method, TRIPLE.ids, TRIPLE.orders).result!.ranking, TRIPLE.ids)).toContainEqual(['A', 'B', 'C']);
      expect(findTiedGroups(run(method, TOTAL.ids, TOTAL.orders).result!.ranking, TOTAL.ids)).toEqual([['A', 'B', 'C']]);
    });
  }
});

describe('PT-16: regla lexicográfica', () => {
  for (const method of METHODS) {
    it(`${method}: orden estricto según el orden de la lista y posiciones no empatadas intactas`, () => {
      for (const p of [DOUBLE, TRIPLE, TOTAL]) {
        const before = run(method, p.ids, p.orders).result!.ranking;
        const out = run(method, p.ids, p.orders, { rule: 'LEXICOGRAPHIC', optionOrder: p.ids }).result!;
        expect(isStrict(out.ranking.map((r) => r.midRank))).toBe(true);
        expect(out.tieBreak).toMatchObject({ rule: 'LEXICOGRAPHIC', applied: true });
        expect(out.tieBreak!.tiedGroups).toEqual(findTiedGroups(before, p.ids));

        // Each tied group keeps its span of positions, ordered as the host listed them
        for (const group of out.tieBreak!.tiedGroups) {
          const mid = before.find((r) => r.id === group[0])!.midRank;
          const start = mid - (group.length - 1) / 2;
          group.forEach((id, k) => expect(out.ranking.find((r) => r.id === id)!.midRank).toBe(start + k));
        }
        // Options that were not tied keep their rank
        const tiedIds = new Set(out.tieBreak!.tiedGroups.flat());
        for (const r of before.filter((x) => !tiedIds.has(x.id))) {
          expect(out.ranking.find((x) => x.id === r.id)!.midRank).toBe(r.midRank);
        }
      }
    });

    it(`${method}: el orden de la lista manda, no el id`, () => {
      const hostOrder = ['C', 'B', 'A'];
      const out = run(method, TOTAL.ids, TOTAL.orders, { rule: 'LEXICOGRAPHIC', optionOrder: hostOrder }).result!;
      const byRank = [...out.ranking].sort((a, b) => a.midRank - b.midRank).map((r) => r.id);
      expect(byRank).toEqual(['C', 'B', 'A']);
    });
  }
});

describe('PT-16: regla de saldo de razones', () => {
  for (const method of METHODS) {
    it(`${method}: mayor saldo primero; si sigue el empate, orden de la lista`, () => {
      const out = run(method, TOTAL.ids, TOTAL.orders, {
        rule: 'REASON_BALANCE',
        optionOrder: ['A', 'B', 'C'],
        reasonBalance: { A: 1, B: 3, C: 1 },
      }).result!;
      const byRank = [...out.ranking].sort((a, b) => a.midRank - b.midRank).map((r) => r.id);
      expect(byRank).toEqual(['B', 'A', 'C']);
      expect(out.tieBreak).toMatchObject({ rule: 'REASON_BALANCE', applied: true });
    });
  }

  it('exige el saldo para aplicar la regla', () => {
    expect(() =>
      applyTieBreak([{ id: 'A', midRank: 1.5, score: 1 }, { id: 'B', midRank: 1.5, score: 1 }], {
        rule: 'REASON_BALANCE',
        optionOrder: ['A', 'B'],
      })
    ).toThrow();
  });
});

describe('PT-16: determinismo y medición sobre el orden final', () => {
  it('mismas entradas, mismo resultado', () => {
    const a = run('KEMENY_YOUNG', TRIPLE.ids, TRIPLE.orders, { rule: 'LEXICOGRAPHIC', optionOrder: TRIPLE.ids });
    const b = run('KEMENY_YOUNG', [...TRIPLE.ids].reverse(), TRIPLE.orders, { rule: 'LEXICOGRAPHIC', optionOrder: TRIPLE.ids });
    const norm = (r: typeof a) => [...r.result!.ranking].sort((x, y) => x.midRank - y.midRank).map((x) => [x.id, x.midRank]);
    expect(norm(a)).toEqual(norm(b));
  });

  it('sin empates la regla no actúa', () => {
    const out = run('BORDA', ['A', 'B', 'C'], [['A', 'B', 'C'], ['A', 'B', 'C']], { rule: 'LEXICOGRAPHIC', optionOrder: ['C', 'B', 'A'] }).result!;
    expect(out.tieBreak).toEqual({ rule: 'LEXICOGRAPHIC', applied: false, tiedGroups: [] });
    expect(out.ranking.find((r) => r.id === 'A')!.midRank).toBe(1);
  });

  it('el nivel de acuerdo se calcula sobre el orden ya desempatado', () => {
    const none = run('BORDA', TOTAL.ids, TOTAL.orders).result!;
    const lex = run('BORDA', TOTAL.ids, TOTAL.orders, { rule: 'LEXICOGRAPHIC', optionOrder: TOTAL.ids }).result!;
    // Total tie: tau-b convention gives 0.5 for everybody
    expect(none.tauStar).toBe(0.5);
    // Strict order A > B > C: voters A>B>C (tau 1), B>C>A (tau -1/3), C>A>B (tau -1/3)
    expect(lex.tauStar).toBeCloseTo((1 + 1 / 3 + 1 / 3) / 3, 12);
  });
});
