/**
 * tieBreak.ts
 * Declared tie-break rules for the collective ranking (PT-16, AGENTS.md E-1).
 *
 * NONE            → the weak order is returned untouched (mid-ranks kept).
 * LEXICOGRAPHIC   → tied options follow the order in which the host listed
 *                   them (order_index).
 * REASON_BALANCE  → tied options are ordered by (reasons for − reasons against)
 *                   in the round, highest first; options still tied (for
 *                   example, no reasons at all) are ordered by a seeded random
 *                   permutation. The seed is stored in the report, so the same
 *                   seed reproduces the same ranking (plan de mejora P0.4).
 *
 * With a rule other than NONE the result is a strict order: each tied group
 * that occupied positions [start..end] gets start, start+1, ..., end.
 * Scores are not changed. The rule is deterministic: same inputs, same output.
 */

import type { WeakOrder } from './types';

export type TieBreakRule = 'NONE' | 'LEXICOGRAPHIC' | 'REASON_BALANCE';

export interface TieBreakInput {
  rule: TieBreakRule;
  /** Option ids in the order the host listed them (order_index ascending) */
  optionOrder: string[];
  /** Reasons for minus reasons against per option; required for REASON_BALANCE */
  reasonBalance?: Record<string, number>;
  /** 32-bit seed for the last-resort random order; required for REASON_BALANCE */
  seed?: number;
}

export interface TieBreakReport {
  rule: TieBreakRule;
  /** True when at least one tied group was resolved by the rule */
  applied: boolean;
  /** Groups of option ids that were tied before the rule (in host order) */
  tiedGroups: string[][];
  /** True when the seeded random order decided at least one remaining tie */
  fallbackUsed?: boolean;
  /** Seed used for the last-resort random order (REASON_BALANCE only) */
  seed?: number;
  /** The weak order before the rule (id and mid-rank), to recompute both variants */
  weakOrder?: Array<{ id: string; midRank: number }>;
}

/** Deterministic 32-bit PRNG (mulberry32): same seed, same sequence. */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle with the given generator. Input order is canonicalized by id
 * first only so the result depends on the seed, not on how the array arrived. */
function seededShuffle<T extends { id: string }>(items: T[], rand: () => number): T[] {
  const out = [...items].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Groups of ids sharing the same mid-rank, each group with more than one id. */
export function findTiedGroups(ranking: WeakOrder[], optionOrder: string[] = []): string[][] {
  const orderIndex = new Map(optionOrder.map((id, i) => [id, i]));
  const byRank = new Map<number, string[]>();
  for (const item of ranking) {
    const list = byRank.get(item.midRank) ?? [];
    list.push(item.id);
    byRank.set(item.midRank, list);
  }
  return [...byRank.entries()]
    .filter(([, ids]) => ids.length > 1)
    .sort(([a], [b]) => a - b)
    .map(([, ids]) =>
      [...ids].sort((x, y) => (orderIndex.get(x) ?? Infinity) - (orderIndex.get(y) ?? Infinity) || x.localeCompare(y))
    );
}

export function applyTieBreak(
  ranking: WeakOrder[],
  input: TieBreakInput
): { ranking: WeakOrder[]; report: TieBreakReport } {
  const tiedGroups = findTiedGroups(ranking, input.optionOrder);

  if (input.rule === 'NONE' || tiedGroups.length === 0) {
    return { ranking, report: { rule: input.rule, applied: false, tiedGroups } };
  }

  if (input.rule === 'REASON_BALANCE' && (!input.reasonBalance || input.seed === undefined)) {
    throw new Error('REASON_BALANCE tie-break requires reasonBalance and seed.');
  }

  const weakOrder = ranking.map((r) => ({ id: r.id, midRank: r.midRank }));
  const orderIndex = new Map(input.optionOrder.map((id, i) => [id, i]));
  const hostOrder = (a: WeakOrder, b: WeakOrder) =>
    (orderIndex.get(a.id) ?? Infinity) - (orderIndex.get(b.id) ?? Infinity) || a.id.localeCompare(b.id);
  const balance = (id: string) => input.reasonBalance?.[id] ?? 0;
  const rand = input.rule === 'REASON_BALANCE' ? seededRandom(input.seed!) : null;
  let fallbackUsed = false;

  // Walk the weak order by mid-rank; resolve each tied group with the rule
  const byRank = [...ranking].sort((a, b) => a.midRank - b.midRank || a.id.localeCompare(b.id));
  const ordered: WeakOrder[] = [];
  for (let i = 0; i < byRank.length; ) {
    let j = i;
    while (j < byRank.length && byRank[j].midRank === byRank[i].midRank) j++;
    const group = byRank.slice(i, j);
    if (group.length === 1) {
      ordered.push(group[0]);
    } else if (input.rule === 'LEXICOGRAPHIC') {
      ordered.push(...[...group].sort(hostOrder));
    } else {
      // REASON_BALANCE: higher balance first; equal balances by the seeded random order
      const balances = [...new Set(group.map((g) => balance(g.id)))].sort((a, b) => b - a);
      for (const value of balances) {
        const sub = group.filter((g) => balance(g.id) === value);
        if (sub.length > 1) fallbackUsed = true;
        ordered.push(...(sub.length > 1 ? seededShuffle(sub, rand!) : sub));
      }
    }
    i = j;
  }
  const strict = ordered.map((item, k) => ({ id: item.id, midRank: k + 1, score: item.score }));

  const report: TieBreakReport = { rule: input.rule, applied: true, tiedGroups, weakOrder };
  if (input.rule === 'REASON_BALANCE') {
    report.seed = input.seed;
    report.fallbackUsed = fallbackUsed;
  }
  return { ranking: strict, report };
}
