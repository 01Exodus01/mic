/**
 * backend/__tests__/algorithms/pairwiseMajority.test.ts
 * AGENTS.md E-12: fixed tie-break cascade of every new room (r-fast-cr-4).
 *  1. pairwise majority among the tied options, on the counted ballots of the
 *     round (Copeland score inside the tied group, applied again inside equal
 *     scores);
 *  2. option title (Spanish collation, ignoring case and accents) only when the
 *     majority leaves them tied.
 */

import { describe, it, expect } from 'vitest';
import { runAggregationEngine } from '@mic/backend/algorithms/engine';
import { applyTieBreak } from '@mic/backend/algorithms/tieBreak';
import type { Ballot, WeakOrder } from '@mic/backend/algorithms/types';

const ballot = (order: string[]): Ballot => new Map(order.map((id, i) => [id, i + 1]));
const weak = (ranks: Record<string, number>): WeakOrder[] =>
  Object.entries(ranks).map(([id, midRank]) => ({ id, midRank, score: 0 }));
const order = (r: WeakOrder[]) => [...r].sort((a, b) => a.midRank - b.midRank).map((x) => x.id);

function breakTies(ranking: WeakOrder[], ballots: string[][], titles: Record<string, string>) {
  return applyTieBreak(ranking, {
    rule: 'PAIRWISE_MAJORITY',
    optionOrder: Object.keys(titles),
    ballots: ballots.map(ballot),
    optionTitles: titles,
  });
}

describe('E-12: mayoría pareada entre las opciones empatadas', () => {
  it('dos empatadas: va primero la que más participantes pusieron antes', () => {
    // A and B tied (e.g. same Borda score); 2 of 3 ballots put B above A
    const res = breakTies(weak({ A: 1.5, B: 1.5, C: 3 }), [['B', 'A', 'C'], ['C', 'B', 'A'], ['A', 'C', 'B']], {
      A: 'Alfa', B: 'Beta', C: 'Gamma',
    });
    expect(order(res.ranking)).toEqual(['B', 'A', 'C']);
    expect(res.ranking.map((r) => r.midRank).sort()).toEqual([1, 2, 3]);
    expect(res.report).toMatchObject({ rule: 'PAIRWISE_MAJORITY', applied: true, tiedGroups: [['A', 'B']], fallbackUsed: false });
  });

  it('las opciones fuera del empate no se mueven', () => {
    const res = breakTies(weak({ A: 1, B: 2.5, C: 2.5, D: 4 }), [['A', 'C', 'B', 'D'], ['A', 'C', 'B', 'D'], ['A', 'B', 'C', 'D']], {
      A: 'a', B: 'b', C: 'c', D: 'd',
    });
    expect(order(res.ranking)).toEqual(['A', 'C', 'B', 'D']);
  });

  it('ciclo de Condorcet entre tres: la mayoría no separa y decide el título', () => {
    // A>B, B>C, C>A, each 2 to 1: every option beats one other (Copeland 1, 1, 1)
    const res = breakTies(weak({ A: 2, B: 2, C: 2 }), [['A', 'B', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B']], {
      A: 'Torneo', B: 'biblioteca', C: 'Huerto',
    });
    // case is ignored: biblioteca < Huerto < Torneo
    expect(order(res.ranking)).toEqual(['B', 'C', 'A']);
    expect(res.report.fallbackUsed).toBe(true);
  });

  it('cascada parcial: la mayoría separa a una y el título ordena a las que siguen igualadas', () => {
    // A beats B and C (3 to 1 each); B and C tie head to head (2 to 2)
    const res = breakTies(
      weak({ A: 2, B: 2, C: 2 }),
      [['A', 'B', 'C'], ['A', 'C', 'B'], ['B', 'A', 'C'], ['C', 'A', 'B']],
      { A: 'Zeta', B: 'Mural', C: 'Árbol' }
    );
    // A: beats B (3-1) and C (3-1); B vs C 2-2 → title, ignoring the accent: Árbol < Mural
    expect(order(res.ranking)).toEqual(['A', 'C', 'B']);
    expect(res.report.fallbackUsed).toBe(true);
  });

  it('se aplica otra vez dentro de un subgrupo (cuatro empatadas)', () => {
    // A beats everyone; D loses to everyone; B beats C head to head
    const res = breakTies(
      weak({ A: 2.5, B: 2.5, C: 2.5, D: 2.5 }),
      [['A', 'B', 'C', 'D'], ['A', 'C', 'B', 'D'], ['B', 'A', 'C', 'D']],
      { A: 'd', B: 'c', C: 'b', D: 'a' }
    );
    expect(order(res.ranking)).toEqual(['A', 'B', 'C', 'D']);
    expect(res.report.fallbackUsed).toBe(false);
  });

  it('mismas entradas, mismo resultado, sin importar el orden de las boletas', () => {
    const ballots = [['A', 'B', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B']];
    const titles = { A: 'uno', B: 'dos', C: 'tres' };
    const a = breakTies(weak({ A: 2, B: 2, C: 2 }), ballots, titles);
    const b = breakTies(weak({ C: 2, A: 2, B: 2 }), [...ballots].reverse(), titles);
    expect(order(a.ranking)).toEqual(order(b.ranking));
  });

  it('exige las boletas y los títulos', () => {
    expect(() => applyTieBreak(weak({ A: 1.5, B: 1.5 }), { rule: 'PAIRWISE_MAJORITY', optionOrder: ['A', 'B'] })).toThrow(
      /requires ballots and optionTitles/
    );
  });
});

describe('E-12: dentro del motor', () => {
  const titles = { A: 'Huerto escolar', B: 'Biblioteca abierta', C: 'Torneo deportivo' };

  it('Borda 3-3-3 con ciclo (como la ronda 1 del piloto): orden alfabético, sin empates', () => {
    const ballots = new Map([['p1', ballot(['A', 'B', 'C'])], ['p2', ballot(['B', 'C', 'A'])], ['p3', ballot(['C', 'A', 'B'])]]);
    const out = runAggregationEngine({
      optionIds: ['A', 'B', 'C'], ballots, method: 'BORDA', minMembers: 3, tauThreshold: 0.8, currentRound: 1, maxRounds: 3,
      tieBreak: { rule: 'PAIRWISE_MAJORITY', optionOrder: ['A', 'B', 'C'], optionTitles: titles },
      concordanceVariant: 'WITHOUT_TIES',
    });
    expect(order(out.result!.ranking)).toEqual(['B', 'A', 'C']);
    expect(out.result!.concordanceVariant).toBe('WITHOUT_TIES');
  });

  it('Borda empatado pero con mayoría clara: decide la mayoría, no el título', () => {
    // Borda (m − position): A = 2 + 2 + 0 = 4, B = 1 + 1 + 2 = 4, C = 1; A above B on 2 of 3 ballots
    const ballots = new Map([
      ['p1', ballot(['A', 'B', 'C'])],
      ['p2', ballot(['A', 'B', 'C'])],
      ['p3', ballot(['B', 'C', 'A'])],
    ]);
    const out = runAggregationEngine({
      optionIds: ['A', 'B', 'C'], ballots, method: 'BORDA', minMembers: 3, tauThreshold: 0.8, currentRound: 1, maxRounds: 3,
      tieBreak: { rule: 'PAIRWISE_MAJORITY', optionOrder: ['A', 'B', 'C'], optionTitles: titles },
      concordanceVariant: 'WITHOUT_TIES',
    });
    const tied = out.result!.tieBreak!.tiedGroups;
    expect(tied).toEqual([['A', 'B']]);
    // A over B by majority even though 'Biblioteca' (B) comes first alphabetically
    expect(order(out.result!.ranking).indexOf('A')).toBeLessThan(order(out.result!.ranking).indexOf('B'));
    expect(out.result!.tieBreak!.fallbackUsed).toBe(false);
  });
});
