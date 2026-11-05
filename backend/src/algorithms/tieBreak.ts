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
 * PAIRWISE_MAJORITY → fixed cascade for every room since r-fast-cr-4
 *                   (AGENTS.md E-12):
 *                   1. pairwise majority in the current round: within the tied
 *                      group, an option beats another when more counted
 *                      ballots ranked it above the other. Options are ordered
 *                      by how many of the other tied options they beat
 *                      (Copeland score inside the group); options with the
 *                      same score are ordered again with the same rule among
 *                      themselves only;
 *                   2. lexicographic order of the option title, only when the
 *                      pairwise majority leaves them tied (equal head to head,
 *                      or a cycle). Titles compare ignoring case and accents
 *                      (Spanish collation), then exactly, then by option id.
 *
 * With a rule other than NONE the result is a strict order: each tied group
 * that occupied positions [start..end] gets start, start+1, ..., end.
 * Scores are not changed. The rule is deterministic: same inputs, same output.
 */

import type { WeakOrder } from './types';

export type TieBreakRule = 'NONE' | 'LEXICOGRAPHIC' | 'REASON_BALANCE' | 'PAIRWISE_MAJORITY';

export interface TieBreakInput {
  rule: TieBreakRule;
  /** Option ids in the order the host listed them (order_index ascending) */
  optionOrder: string[];
  /** Reasons for minus reasons against per option; required for REASON_BALANCE */
  reasonBalance?: Record<string, number>;
  /** 32-bit seed for the last-resort random order; required for REASON_BALANCE */
  seed?: number;
  /** Counted ballots of the round (option id → position); required for PAIRWISE_MAJORITY */
  ballots?: Array<Map<string, number>>;
  /** Option titles; required for PAIRWISE_MAJORITY (last step of the cascade) */
  optionTitles?: Record<string, string>;
}

export interface TieBreakReport {
  rule: TieBreakRule;
  /** True when at least one tied group was resolved by the rule */
  applied: boolean;
  /** Groups of option ids that were tied before the rule (in host order) */
  tiedGroups: string[][];
  /** True when the last step decided at least one remaining tie: the seeded
   * random order (REASON_BALANCE) or the option title (PAIRWISE_MAJORITY) */
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

/** Title order: Spanish collation ignoring case and accents, then exact, then id. */
function titleOrder(titles: Record<string, string>) {
  return (a: string, b: string): number => {
    const ta = titles[a] ?? '';
    const tb = titles[b] ?? '';
    return ta.localeCompare(tb, 'es', { sensitivity: 'base' }) || (ta < tb ? -1 : ta > tb ? 1 : 0) || a.localeCompare(b);
  };
}

/**
 * PAIRWISE_MAJORITY on one tied group: Copeland score inside the group, the
 * options with equal score ordered again among themselves, and the title when
 * the majority no longer separates them. Returns the ids in order and whether
 * the title had to decide.
 */
function pairwiseMajorityOrder(
  ids: string[],
  ballots: Array<Map<string, number>>,
  byTitle: (a: string, b: string) => number
): { order: string[]; titleUsed: boolean } {
  if (ids.length < 2) return { order: [...ids], titleUsed: false };
  const prefers = (a: string, b: string) =>
    ballots.reduce((n, ballot) => n + ((ballot.get(a) ?? Infinity) < (ballot.get(b) ?? Infinity) ? 1 : 0), 0);
  const wins = new Map(ids.map((id) => [id, 0]));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const ab = prefers(ids[i], ids[j]);
      const ba = prefers(ids[j], ids[i]);
      if (ab > ba) wins.set(ids[i], wins.get(ids[i])! + 1);
      else if (ba > ab) wins.set(ids[j], wins.get(ids[j])! + 1);
    }
  }
  const scores = [...new Set(wins.values())].sort((a, b) => b - a);
  // The majority does not separate any of them (all tied head to head, or a cycle)
  if (scores.length === 1) return { order: [...ids].sort(byTitle), titleUsed: true };
  const order: string[] = [];
  let titleUsed = false;
  for (const score of scores) {
    const sub = ids.filter((id) => wins.get(id) === score);
    const res = pairwiseMajorityOrder(sub, ballots, byTitle);
    order.push(...res.order);
    titleUsed ||= res.titleUsed;
  }
  return { order, titleUsed };
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
  if (input.rule === 'PAIRWISE_MAJORITY' && (!input.ballots || !input.optionTitles)) {
    throw new Error('PAIRWISE_MAJORITY tie-break requires ballots and optionTitles.');
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
    } else if (input.rule === 'PAIRWISE_MAJORITY') {
      const byId = new Map(group.map((g) => [g.id, g]));
      const res = pairwiseMajorityOrder(
        group.map((g) => g.id).sort(),
        input.ballots!,
        titleOrder(input.optionTitles!)
      );
      if (res.titleUsed) fallbackUsed = true;
      ordered.push(...res.order.map((id) => byId.get(id)!));
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
  if (input.rule === 'PAIRWISE_MAJORITY') report.fallbackUsed = fallbackUsed;
  return { ranking: strict, report };
}
