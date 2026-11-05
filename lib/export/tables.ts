/**
 * lib/export/tables.ts
 * Normalized export (plan de mejora de los reportes, r-FAST-CR).
 *
 * One granularity per file; every derived value can be recomputed from the
 * raw data in the same export; options only by option_id; blind codes only.
 * The builders are pure functions of an ExportDataset.
 */

import { computeVoterCIX } from '@/lib/algorithms/kendallTau';
import type { WeakOrder } from '@/lib/algorithms/types';
import { PROCEDURE_VERSION } from '@/lib/round-processor';
import { APP_VERSION, EXPORT_TIMEZONE, bool, isoUtc, metric, snakeCase, type Cell, type CsvTable } from './format';
import type { ExportDataset, ExportEvent, ExportReport } from './dataset';

// ── Report JSON helpers ──────────────────────────────────────────────────────

interface ReportExtras {
  countedVoters: Set<string>;
  tieBreak: { rule?: string; applied?: boolean; tiedGroups?: string[][]; seed?: number; fallbackUsed?: boolean; weakOrder?: Array<{ id: string; midRank: number }> } | null;
  variant: string | null;
  procedure: { version?: string; tauThreshold?: number; maxRounds?: number } | null;
}

function extras(report: ExportReport): ReportExtras {
  const json = (report.arguments_json ?? {}) as Record<string, unknown>;
  const metrics = json.__metrics as { voters?: Array<{ participantId?: string }> } | undefined;
  return {
    countedVoters: new Set((metrics?.voters ?? []).map((v) => v.participantId ?? '')),
    tieBreak: (json.__tieBreak as ReportExtras['tieBreak']) ?? null,
    variant: ((json.__concordance as { variant?: string } | undefined)?.variant) ?? null,
    procedure: (json.__procedure as ReportExtras['procedure']) ?? null,
  };
}

function finalRanking(report: ExportReport): WeakOrder[] {
  return (Array.isArray(report.collective_ranking) ? report.collective_ranking : []) as unknown as WeakOrder[];
}

/** The order before the tie-break rule. Stored since r-fast-cr-3; rebuilt from the tied groups before. */
export function weakOrderOf(report: ExportReport): Array<{ id: string; midRank: number }> {
  const ranking = finalRanking(report);
  const tb = extras(report).tieBreak;
  if (tb?.weakOrder?.length) return tb.weakOrder;
  if (!tb?.applied || !tb.tiedGroups?.length) return ranking.map((r) => ({ id: r.id, midRank: r.midRank }));
  const finalRank = new Map(ranking.map((r) => [r.id, r.midRank]));
  const mid = new Map<string, number>();
  for (const group of tb.tiedGroups) {
    const avg = group.reduce((s, id) => s + (finalRank.get(id) ?? 0), 0) / group.length;
    for (const id of group) mid.set(id, avg);
  }
  return ranking.map((r) => ({ id: r.id, midRank: mid.get(r.id) ?? r.midRank }));
}

// ── Shared derived data ──────────────────────────────────────────────────────

type Ballot = Map<string, number>;

export function deriveContext(ds: ExportDataset) {
  const optionIds = ds.options.map((o) => o.id);
  const blindCode = new Map(ds.participants.map((p) => [p.id, p.blind_code]));
  const reportByRound = new Map(ds.reports.map((r) => [r.round, r]));

  const ballots = new Map<number, Map<string, Ballot>>();
  for (const v of ds.votes) {
    const byP = ballots.get(v.round) ?? new Map<string, Ballot>();
    const ballot = byP.get(v.participant_id) ?? new Map<string, number>();
    ballot.set(v.option_id, v.position);
    byP.set(v.participant_id, ballot);
    ballots.set(v.round, byP);
  }
  // Only complete ballots count as a vote
  for (const byP of ballots.values()) {
    for (const [pid, b] of byP) if (b.size !== optionIds.length) byP.delete(pid);
  }

  const lastRound = Math.max(
    ds.room.status === 'DRAFT' ? 0 : ds.room.current_round,
    ...ds.reports.map((r) => r.round),
    0
  );
  const rounds = Array.from({ length: lastRound }, (_, i) => i + 1);
  const timeline = buildTimeline(ds, rounds);

  return { optionIds, blindCode, reportByRound, ballots, rounds, timeline };
}

interface RoundTimeline {
  openedAt: Date | null;
  configuredMinutes: number | null;
  extensionMinutes: number;
  closedAt: Date | null;
  closedReason: string;
}

function num(data: unknown, key: string): number | null {
  const v = (data as Record<string, unknown> | null)?.[key];
  return typeof v === 'number' ? v : null;
}

function buildTimeline(ds: ExportDataset, rounds: number[]): Map<number, RoundTimeline> {
  const out = new Map<number, RoundTimeline>();
  for (const r of rounds) {
    const inRound = ds.events.filter((e) => e.round === r);
    const open = inRound.find((e) => e.type === 'room_started' || e.type === 'round_opened') ?? null;
    const extensionMinutes = inRound
      .filter((e) => e.type === 'deadline_extended')
      .reduce((sum, e) => sum + (num(e.data, 'minutes') ?? 0), 0);
    const closes = inRound.filter((e) => e.type === 'round_closed');
    const close = closes[closes.length - 1] ?? null;
    const configuredMinutes = open ? num(open.data, 'minutes') : null;

    let closedReason = '';
    if (close) {
      const stored = (close.data as Record<string, unknown> | null)?.reason;
      if (typeof stored === 'string') closedReason = stored;
      else if (close.actor === 'HOST') closedReason = 'HOST';
      else if (open && configuredMinutes !== null) {
        // Events before the reason was recorded: closing well before the deadline means everybody voted
        const deadline = open.created_at.getTime() + (configuredMinutes + extensionMinutes) * 60_000;
        closedReason = close.created_at.getTime() < deadline - 2_000 ? 'ALL_VOTED' : 'TIMEOUT';
      } else closedReason = 'TIMEOUT';
    }
    out.set(r, {
      openedAt: open?.created_at ?? null,
      configuredMinutes,
      extensionMinutes,
      closedAt: close?.created_at ?? null,
      closedReason,
    });
  }
  return out;
}

type Ctx = ReturnType<typeof deriveContext>;

function procedureVersionOf(report: ExportReport | undefined): string {
  if (!report) return '';
  return extras(report).procedure?.version ?? 'r-fast-cr-1';
}

// ── rooms.csv ────────────────────────────────────────────────────────────────

export function roomsTable(ds: ExportDataset): CsvTable {
  const r = ds.room;
  const latest = ds.reports[ds.reports.length - 1];
  return {
    name: 'rooms.csv',
    headers: [
      'room_id', 'room_name', 'method', 'concordance_variant', 'tie_break_rule', 'tie_break_fallback',
      'consensus_threshold', 'max_rounds', 'late_participants_policy', 'early_close', 'consent_required',
      'access_mode', 'room_status', 'procedure_version', 'app_version', 'created_at', 'timezone',
    ],
    rows: [[
      r.id,
      r.title,
      r.method,
      r.concordance_variant,
      r.tie_break_rule,
      r.tie_break_rule === 'REASON_BALANCE' ? 'SEEDED_RANDOM' : '',
      metric(r.tau_threshold),
      r.max_rounds,
      r.allow_late_join ? 'ALLOWED' : 'CLOSED_COHORT',
      bool(r.close_when_all_voted),
      bool(r.consent_required),
      r.access_mode,
      r.status,
      latest ? procedureVersionOf(latest) : PROCEDURE_VERSION,
      APP_VERSION,
      isoUtc(r.created_at),
      EXPORT_TIMEZONE,
    ]],
  };
}

// ── options.csv ──────────────────────────────────────────────────────────────

export function optionsTable(ds: ExportDataset): CsvTable {
  return {
    name: 'options.csv',
    headers: ['option_id', 'display_order_default'],
    rows: ds.options.map((o) => [o.id, o.order_index + 1]),
  };
}

// ── participants.csv ─────────────────────────────────────────────────────────

export function participantsTable(ds: ExportDataset, ctx: Ctx): CsvTable {
  const exclusion = new Map<string, { round: number | null; reason: string }>();
  for (const e of ds.events) {
    if (!e.participant_id) continue;
    if (e.type === 'participant_expelled') exclusion.set(e.participant_id, { round: e.round, reason: 'EXPELLED' });
    if (e.type === 'member_removed') exclusion.set(e.participant_id, { round: e.round, reason: 'REMOVED_FROM_LIST' });
  }
  const consentAt = new Map<string, Date>();
  for (const c of ds.consents) {
    const prev = consentAt.get(c.participant_id);
    if (!prev || c.accepted_at < prev) consentAt.set(c.participant_id, c.accepted_at);
  }
  return {
    name: 'participants.csv',
    headers: [
      'blind_code', 'joined_round', 'first_joined_at', 'voted_rounds', 'status',
      'excluded_from_round', 'exclusion_reason', 'consent_accepted', 'consent_at',
    ],
    rows: ds.participants.map((p) => {
      const voted = ctx.rounds.filter((r) => ctx.ballots.get(r)?.has(p.id));
      const ex = exclusion.get(p.id);
      const status = p.is_retired ? 'EXCLUDED' : voted.length === 0 ? 'NEVER_VOTED' : 'ACTIVE';
      return [
        p.blind_code,
        p.joined_round,
        isoUtc(p.created_at),
        voted.join(';'),
        status,
        p.is_retired ? ex?.round ?? '' : '',
        p.is_retired ? ex?.reason ?? 'EXPELLED' : '',
        bool(ds.room.consent_required ? consentAt.has(p.id) : null),
        isoUtc(consentAt.get(p.id)),
      ];
    }),
  };
}

// ── rounds.csv ───────────────────────────────────────────────────────────────

export function roundsTable(ds: ExportDataset, ctx: Ctx): CsvTable {
  return {
    name: 'rounds.csv',
    headers: [
      'round', 'opened_at', 'configured_minutes', 'extension_minutes', 'closed_at', 'closed_reason',
      'n_joined', 'n_voted', 'effective_voters', 'n_excluded', 'status',
    ],
    rows: ctx.rounds.map((r) => {
      const t = ctx.timeline.get(r)!;
      const report = ctx.reportByRound.get(r);
      const nVoted = ctx.ballots.get(r)?.size ?? 0;
      const joinedBy = t.closedAt;
      const nJoined = ds.participants.filter(
        (p) => p.joined_round <= r && (!joinedBy || p.created_at <= joinedBy)
      ).length;
      const status = report
        ? 'REPORTED'
        : r === ds.room.current_round
          ? ds.room.status
          : 'UNREPORTED';
      return [
        r,
        isoUtc(t.openedAt),
        t.configuredMinutes ?? '',
        t.extensionMinutes,
        isoUtc(t.closedAt),
        t.closedReason,
        nJoined,
        nVoted,
        report ? report.effective_voters : '',
        report ? nVoted - report.effective_voters : '',
        status,
      ];
    }),
  };
}

// ── votes_long.csv ───────────────────────────────────────────────────────────

export function votesLongTable(ds: ExportDataset, ctx: Ctx): CsvTable {
  const version = new Map(ds.revisions.map((r) => [`${r.round}:${r.participant_id}`, r._max.version]));
  const rows: Cell[][] = [];
  const sorted = [...ds.votes].sort(
    (a, b) =>
      a.round - b.round ||
      (ctx.blindCode.get(a.participant_id) ?? '').localeCompare(ctx.blindCode.get(b.participant_id) ?? '') ||
      a.position - b.position
  );
  for (const v of sorted) {
    const prev = ctx.ballots.get(v.round - 1)?.get(v.participant_id);
    const prevPos = prev?.get(v.option_id);
    rows.push([
      ds.room.id,
      v.round,
      ctx.blindCode.get(v.participant_id) ?? '',
      v.option_id,
      v.position,
      v.displayed_position ?? '',
      isoUtc(v.created_at),
      version.get(`${v.round}:${v.participant_id}`) ?? '',
      prevPos === undefined ? '' : bool(prevPos !== v.position),
    ]);
  }
  return {
    name: 'votes_long.csv',
    headers: [
      'room_id', 'round', 'blind_code', 'option_id', 'position', 'displayed_position',
      'submitted_at', 'vote_version', 'changed_vs_prev_round',
    ],
    rows,
  };
}

// ── voter_round_metrics.csv ──────────────────────────────────────────────────

/** Discordant pairs between two strict ballots of the same person (0 = same order). */
export function kendallDistance(a: Ballot, b: Ballot): number {
  const ids = [...a.keys()];
  let d = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const x = Math.sign(a.get(ids[i])! - a.get(ids[j])!);
      const y = Math.sign((b.get(ids[i]) ?? 0) - (b.get(ids[j]) ?? 0));
      if (x * y < 0) d++;
    }
  }
  return d;
}

export interface VoterRoundMetric {
  participantId: string;
  round: number;
  tauB: number;
  cix: number;
  tauC: number;
  gamma: number;
  counted: boolean;
  /** tau-b against the order before the tie-break rule (P1.6); null when the room has no rule */
  tauBWeak: number | null;
}

/** Stored metrics (RoundVoterMetric) first; otherwise recomputed against the report's ranking. */
export function voterMetricsOf(ds: ExportDataset, ctx: Ctx): VoterRoundMetric[] {
  const stored = new Map(ds.voterMetrics.map((m) => [`${m.round}:${m.participant_id}`, m]));
  const hasRule = ds.room.tie_break_rule !== 'NONE';
  const out: VoterRoundMetric[] = [];
  for (const r of ctx.rounds) {
    const report = ctx.reportByRound.get(r);
    if (!report) continue;
    const counted = extras(report).countedVoters;
    const weak = hasRule
      ? weakOrderOf(report).map((w) => ({ id: w.id, midRank: w.midRank, score: 0 }))
      : null;
    for (const [pid, ballot] of ctx.ballots.get(r) ?? []) {
      const tauBWeak = weak ? computeVoterCIX(ballot, weak, pid).tauB ?? 0 : null;
      const s = stored.get(`${r}:${pid}`);
      if (s) {
        out.push({ participantId: pid, round: r, tauB: s.tau_b, cix: s.cix, tauC: s.stuart_tau_c, gamma: s.gamma, counted: true, tauBWeak });
        continue;
      }
      const m = computeVoterCIX(ballot, finalRanking(report), pid);
      out.push({
        participantId: pid,
        round: r,
        tauB: m.tauB ?? 0,
        cix: m.cix,
        tauC: m.stuartTauC ?? 0,
        gamma: m.gamma ?? 0,
        counted: counted.has(pid),
        tauBWeak,
      });
    }
  }
  return out;
}

export function voterRoundMetricsTable(ds: ExportDataset, ctx: Ctx): CsvTable {
  const withTies = ds.room.concordance_variant === 'WITH_TIES';
  const hasRule = ds.room.tie_break_rule !== 'NONE';
  const reasonCount = new Map<string, { for: number; against: number }>();
  for (const v of ds.votes) {
    const key = `${v.round}:${v.participant_id}`;
    const c = reasonCount.get(key) ?? { for: 0, against: 0 };
    for (const r of v.reasons) r.side === 'FOR' ? c.for++ : c.against++;
    reasonCount.set(key, c);
  }
  const headers = ['blind_code', 'round', 'counted_in_round', 'tau_b', 'cix'];
  if (withTies) headers.push('tau_c', 'gamma');
  // P1.6: with a tie-break rule, also the variant against the order with ties
  if (hasRule) headers.push('tau_b_weak_order', 'cix_weak_order');
  headers.push('kendall_distance_to_prev_round', 'reasons_for_count', 'reasons_against_count');

  const rows = voterMetricsOf(ds, ctx)
    .sort((a, b) => a.round - b.round || (ctx.blindCode.get(a.participantId) ?? '').localeCompare(ctx.blindCode.get(b.participantId) ?? ''))
    .map((m) => {
      const now = ctx.ballots.get(m.round)?.get(m.participantId);
      const prev = ctx.ballots.get(m.round - 1)?.get(m.participantId);
      const c = reasonCount.get(`${m.round}:${m.participantId}`) ?? { for: 0, against: 0 };
      const row: Cell[] = [ctx.blindCode.get(m.participantId) ?? '', m.round, bool(m.counted), metric(m.tauB), metric(m.cix)];
      if (withTies) row.push(metric(m.tauC), metric(m.gamma));
      if (hasRule) row.push(metric(m.tauBWeak), metric(m.tauBWeak === null ? null : (m.tauBWeak + 1) / 2));
      row.push(now && prev ? kendallDistance(now, prev) : '', c.for, c.against);
      return row;
    });
  return { name: 'voter_round_metrics.csv', headers, rows };
}

// ── option_round_scores.csv ──────────────────────────────────────────────────

/** Borda points (m − position) of the counted ballots, for every method. */
export function bordaScores(ctx: Ctx, report: ExportReport): Map<string, number> {
  const counted = extras(report).countedVoters;
  const m = ctx.optionIds.length;
  const scores = new Map(ctx.optionIds.map((id) => [id, 0]));
  for (const [pid, ballot] of ctx.ballots.get(report.round) ?? []) {
    if (!counted.has(pid)) continue;
    for (const [id, pos] of ballot) scores.set(id, (scores.get(id) ?? 0) + (m - pos));
  }
  return scores;
}

export function optionRoundScoresTable(ds: ExportDataset, ctx: Ctx): CsvTable {
  const rows: Cell[][] = [];
  for (const report of ds.reports) {
    const scores = bordaScores(ctx, report);
    const final = new Map(finalRanking(report).map((r) => [r.id, r.midRank]));
    const weak = weakOrderOf(report);
    const weakRank = new Map(weak.map((w) => [w.id, w.midRank]));
    for (const id of ctx.optionIds) {
      const tied = weak.filter((w) => w.id !== id && w.midRank === weakRank.get(id)).map((w) => w.id).sort();
      rows.push([report.round, id, scores.get(id) ?? 0, metric(final.get(id)), tied.join(';')]);
    }
  }
  return { name: 'option_round_scores.csv', headers: ['round', 'option_id', 'borda_score', 'final_rank', 'tied_with'], rows };
}

// ── round_metrics.csv ────────────────────────────────────────────────────────

function tieResolvedBy(ds: ExportDataset, report: ExportReport): string {
  const tb = extras(report).tieBreak;
  if (!tb?.tiedGroups?.length) return '';
  if (!tb.applied || tb.rule === 'NONE') return 'NONE';
  if (tb.rule === 'LEXICOGRAPHIC') return 'LEXICOGRAPHIC';
  if (tb.seed !== undefined) return tb.fallbackUsed ? 'REASON_BALANCE+SEEDED_RANDOM' : 'REASON_BALANCE';
  // Before r-fast-cr-3 the remaining ties after the balance followed the host's list order
  const counted = extras(report).countedVoters;
  const balance = new Map<string, number>();
  for (const v of ds.votes) {
    if (v.round !== report.round || !counted.has(v.participant_id)) continue;
    for (const r of v.reasons) balance.set(v.option_id, (balance.get(v.option_id) ?? 0) + (r.side === 'FOR' ? 1 : -1));
  }
  const residual = tb.tiedGroups.some((g) => new Set(g.map((id) => balance.get(id) ?? 0)).size < g.length);
  return residual ? 'REASON_BALANCE+LIST_ORDER' : 'REASON_BALANCE';
}

export function roundMetricsTable(ds: ExportDataset, ctx: Ctx): CsvTable {
  const metrics = voterMetricsOf(ds, ctx);
  const hasRule = ds.room.tie_break_rule !== 'NONE';
  const rows: Cell[][] = [];
  let prevCix: number | null = null;
  for (const r of ctx.rounds) {
    const report = ctx.reportByRound.get(r);
    if (!report) {
      const stop = ds.room.status === 'CANCELLED' && r === ds.room.current_round ? 'CANCELLED' : 'INSUFFICIENT_VOTES';
      const pending = r === ds.room.current_round && ['ROUND_OPEN', 'DRAFT', 'PROCESSING'].includes(ds.room.status);
      rows.push([r, '', '', '', '', '', '', '', '', '', pending ? '' : stop, '', '', ...(hasRule ? ['', ''] : [])]);
      continue;
    }
    const ex = extras(report);
    const counted = metrics.filter((m) => m.round === r && m.counted);
    const meanTau = counted.length ? counted.reduce((s, m) => s + m.tauB, 0) / counted.length : null;
    const meanTauWeak =
      hasRule && counted.length ? counted.reduce((s, m) => s + (m.tauBWeak ?? 0), 0) / counted.length : null;
    const cix = report.obtained_tau;
    const threshold = ex.procedure?.tauThreshold ?? ds.room.tau_threshold;
    const maxRounds = ex.procedure?.maxRounds ?? ds.room.max_rounds;
    const reached = cix >= threshold;
    const stop = reached ? 'CONSENSUS' : r >= maxRounds ? 'MAX_ROUNDS' : 'CONTINUE';
    const ranking = [...finalRanking(report)]
      .sort((a, b) => a.midRank - b.midRank || a.id.localeCompare(b.id))
      .map((x) => `${x.id}:${x.midRank}`)
      .join(' > ');
    rows.push([
      r,
      report.effective_voters,
      metric(meanTau),
      metric(cix),
      metric(prevCix === null ? 0 : cix - prevCix),
      ranking,
      bool(Boolean(ex.tieBreak?.tiedGroups?.length)),
      tieResolvedBy(ds, report),
      ex.tieBreak?.seed ?? '',
      bool(reached),
      stop,
      procedureVersionOf(report),
      ex.variant ?? ds.room.concordance_variant,
      ...(hasRule ? [metric(meanTauWeak), metric(meanTauWeak === null ? null : (meanTauWeak + 1) / 2)] : []),
    ]);
    prevCix = cix;
  }
  return {
    name: 'round_metrics.csv',
    headers: [
      'round', 'effective_voters', 'mean_tau', 'collective_cix', 'delta_cix', 'collective_ranking',
      'tie_detected', 'tie_resolved_by', 'tie_seed', 'consensus_reached', 'stop_reason',
      'procedure_version', 'concordance_variant',
      ...(hasRule ? ['mean_tau_weak_order', 'collective_cix_weak_order'] : []),
    ],
    rows,
  };
}

// ── reasons.csv ──────────────────────────────────────────────────────────────

export function reasonsTable(ds: ExportDataset, ctx: Ctx, opts: { includeText: boolean }): CsvTable {
  const rows: Cell[][] = [];
  const sorted = [...ds.votes].sort(
    (a, b) =>
      a.round - b.round ||
      (ctx.blindCode.get(a.participant_id) ?? '').localeCompare(ctx.blindCode.get(b.participant_id) ?? '') ||
      a.position - b.position
  );
  for (const v of sorted) {
    const code = ctx.blindCode.get(v.participant_id) ?? '';
    if (v.justification) {
      rows.push([`legacy-${v.id}`, v.round, code, v.option_id, 'LEGACY', 0, opts.includeText ? v.justification : '', isoUtc(v.created_at)]);
    }
    for (const r of [...v.reasons].sort((a, b) => a.side.localeCompare(b.side) || a.order_index - b.order_index)) {
      rows.push([r.id, v.round, code, v.option_id, r.side, r.order_index, opts.includeText ? r.text : '', isoUtc(r.created_at)]);
    }
  }
  return {
    name: 'reasons.csv',
    headers: ['reason_id', 'round', 'blind_code', 'option_id', 'side', 'order', 'text', 'created_at'],
    rows,
  };
}

// ── events.csv ───────────────────────────────────────────────────────────────

/** Event type names in the export (P2.5): one name for opening a round. */
export function exportEventType(type: string): string {
  if (type === 'room_started') return 'round_opened';
  if (type === 'report_viewed') return 'report_delivered';
  return type;
}

/** Flattened data keys; vote_submitted.changed is renamed so it is not read as "vs previous round". */
function flatKey(type: string, key: string): string {
  if (type === 'vote_submitted' && key === 'changed') return 'changed_vs_prev_version';
  return snakeCase(key);
}

export function eventsTable(ds: ExportDataset, ctx: Ctx): CsvTable {
  const openTimes = ctx.rounds.map((r) => ({ round: r, at: ctx.timeline.get(r)?.openedAt ?? null }));
  const contextRound = (e: ExportEvent): number | null => {
    if (e.type !== 'report_viewed') return e.round;
    // report_viewed stored the report's round; the room round is the latest opened before it
    const opened = openTimes.filter((o) => o.at && o.at <= e.created_at).map((o) => o.round);
    return opened.length ? Math.max(...opened) : e.round;
  };

  const flat = ds.events.map((e) => {
    const data = (e.data && typeof e.data === 'object' && !Array.isArray(e.data) ? e.data : {}) as Record<string, unknown>;
    const cols: Record<string, Cell> = {};
    for (const [k, v] of Object.entries(data)) {
      cols[flatKey(e.type, k)] = typeof v === 'object' && v !== null ? JSON.stringify(v) : (v as Cell);
    }
    return { e, cols };
  });
  const dataKeys = [...new Set(flat.flatMap((f) => Object.keys(f.cols)))].sort();

  const rows = flat.map(({ e, cols }) => {
    const round = contextRound(e);
    const opened = round !== null ? ctx.timeline.get(round)?.openedAt ?? null : null;
    const since = opened ? (e.created_at.getTime() - opened.getTime()) / 1000 : null;
    return [
      e.id,
      isoUtc(e.created_at),
      since === null ? '' : Number(since.toFixed(3)),
      round ?? '',
      e.type === 'report_viewed' ? e.round ?? '' : '',
      exportEventType(e.type),
      e.actor,
      e.participant_id ? ctx.blindCode.get(e.participant_id) ?? '' : '',
      ...dataKeys.map((k) => (typeof cols[k] === 'boolean' ? bool(cols[k] as boolean) : cols[k] ?? '')),
    ] as Cell[];
  });

  return {
    name: 'events.csv',
    headers: ['event_id', 'created_at', 't_since_round_open_s', 'round', 'report_round', 'type', 'actor', 'blind_code', ...dataKeys],
    rows,
  };
}

// ── All tables ───────────────────────────────────────────────────────────────

export interface ExportOptions {
  includeText: boolean;
}

export function buildExportTables(ds: ExportDataset, opts: ExportOptions = { includeText: true }): CsvTable[] {
  const ctx = deriveContext(ds);
  return [
    roomsTable(ds),
    optionsTable(ds),
    participantsTable(ds, ctx),
    roundsTable(ds, ctx),
    votesLongTable(ds, ctx),
    voterRoundMetricsTable(ds, ctx),
    optionRoundScoresTable(ds, ctx),
    roundMetricsTable(ds, ctx),
    reasonsTable(ds, ctx, opts),
    eventsTable(ds, ctx),
  ];
}
