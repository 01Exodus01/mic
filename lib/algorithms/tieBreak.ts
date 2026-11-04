/**
 * tieBreak.ts
 * Declared tie-break rules for the collective ranking (PT-16, AGENTS.md E-1).
 *
 * NONE            → the weak order is returned untouched (mid-ranks kept).
 * LEXICOGRAPHIC   → tied options follow the order in which the host listed
 *                   them (order_index).
 * REASON_BALANCE  → tied options are ordered by (reasons for − reasons against)
 *                   in the round, highest first; remaining ties follow the
 *                   host's order.
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
}

export interface TieBreakReport {
  rule: TieBreakRule;
  /** True when at least one tied group was resolved by the rule */
  applied: boolean;
  /** Groups of option ids that were tied before the rule (in host order) */
  tiedGroups: string[][];
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

  if (input.rule === 'REASON_BALANCE' && !input.reasonBalance) {
    throw new Error('REASON_BALANCE tie-break requires reasonBalance.');
  }

  const orderIndex = new Map(input.optionOrder.map((id, i) => [id, i]));
  const hostOrder = (a: WeakOrder, b: WeakOrder) =>
    (orderIndex.get(a.id) ?? Infinity) - (orderIndex.get(b.id) ?? Infinity) || a.id.localeCompare(b.id);
  const balance = (id: string) => input.reasonBalance?.[id] ?? 0;

  const withinGroup = (a: WeakOrder, b: WeakOrder) => {
    if (input.rule === 'REASON_BALANCE') {
      const diff = balance(b.id) - balance(a.id);
      if (diff !== 0) return diff;
    }
    return hostOrder(a, b);
  };

  // Sort by mid-rank, then by the rule inside each tied group; strict positions follow
  const sorted = [...ranking].sort((a, b) => a.midRank - b.midRank || withinGroup(a, b));
  const strict = sorted.map((item, i) => ({ id: item.id, midRank: i + 1, score: item.score }));

  return { ranking: strict, report: { rule: input.rule, applied: true, tiedGroups } };
}
