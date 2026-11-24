'use client';

/**
 * components/RoundFeedbackReport.tsx
 * Round feedback for a participant (PT-19), shared by the feedback screen and
 * the "results of the previous round" panel on the vote screen (PT-20).
 *
 * Follows the feedback step of r-FAST-CR (Algorithm 1, lines 12–16): first the
 * participant's own level of concordance, then, for each option in the order
 * of the collective ranking, "the suggested position is p_i due to F_i": the
 * option's place in the group order and its reasons, for and against, verbatim,
 * as plain lists per side (not signed, not grouped by participant). The
 * tie-break is not shown to participants (it is in the host panel and the CSV).
 * When the process has finished, the same order is the final result.
 */

import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';

export interface FeedbackOption {
  id: string;
  title?: string;
  description?: string;
}

/** Reasons are shown as a plain list per side, without the author (not grouped by participant). */
export interface FeedbackReason {
  text: string;
  /** Written by the participant who is reading (marked "Tu razón") */
  mine?: boolean;
}

export interface FeedbackLegacyArgument {
  justification?: string;
}

export interface FeedbackReportData {
  round?: number;
  collective_ranking?: Array<{ id: string; midRank: number }>;
  arguments_json?: Record<string, FeedbackLegacyArgument[]>;
  reasonsByOption?: Record<string, { reasonsFor: FeedbackReason[]; reasonsAgainst: FeedbackReason[] }>;
  tieBreak?: { rule: string; applied: boolean; fallbackUsed?: boolean };
  myConcordance?: { voted: boolean; cix: number | null };
  myPositions?: Record<string, number>;
}

/** "Participante 04" from the stored blind code. */
export function formatParticipantSignature(rawCode?: string): string {
  if (!rawCode) return 'Participante';
  const match = rawCode.match(/(\d+)/);
  if (match) return `Participante ${match[1].padStart(2, '0')}`;
  return rawCode.replace(/Sujeto_/i, 'Participante ').replace(/Evaluador\s*/i, 'Participante ');
}

/** Group position label with ties as in AGENTS.md ("1.º y 2.º empatadas"). */
export function formatRankPosition(
  midRank: number,
  allRanks: Array<{ id: string; midRank: number }>
): { label: string; isTied: boolean } {
  const k = allRanks.filter((r) => r.midRank === midRank).length;
  if (k > 1) {
    const start = Math.round(midRank - (k - 1) / 2);
    const positions = Array.from({ length: k }, (_, i) => `${start + i}.º`);
    return { label: `${positions.slice(0, -1).join(', ')} y ${positions[positions.length - 1]} empatadas`, isTied: true };
  }
  return { label: `${Math.round(midRank)}.º`, isTied: false };
}

const SIDE_STYLE = {
  FOR: {
    title: 'A favor',
    empty: 'Nadie escribió razones a favor.',
    Icon: Plus,
    box: 'border-good/40 bg-good/[0.06]',
    head: 'text-good',
    item: 'border-l-good',
  },
  AGAINST: {
    title: 'En contra',
    empty: 'Nadie escribió razones en contra.',
    Icon: Minus,
    box: 'border-danger/40 bg-danger/[0.05]',
    head: 'text-danger',
    item: 'border-l-danger',
  },
} as const;

/** One side of the reasons of an option: green "+" for, red "−" against. */
export function ReasonSideBlock({ side, reasons }: { side: 'FOR' | 'AGAINST'; reasons: FeedbackReason[] }) {
  const st = SIDE_STYLE[side];
  return (
    <div className={`rounded-[6px] border p-3 ${st.box}`}>
      <h4 className={`flex items-center gap-1.5 text-xs font-semibold mb-2 ${st.head}`}>
        <st.Icon className="w-3.5 h-3.5 stroke-[2]" aria-hidden="true" />
        {st.title} <span className="font-mono font-normal">({reasons.length})</span>
      </h4>
      {reasons.length === 0 ? (
        <p className="text-xs text-ink/80">{st.empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {reasons.map((r, i) => (
            <li
              key={i}
              className={`px-2.5 py-2 rounded-[4px] border-l-4 ${st.item} bg-paper text-xs text-ink leading-relaxed whitespace-pre-wrap break-words ${
                r.mine ? 'border-2 border-ink' : 'border border-line'
              }`}
            >
              {r.mine && (
                <span className="inline-block mr-1.5 mb-0.5 px-1.5 py-px rounded-[3px] bg-ink text-paper text-[10px] font-semibold tracking-wide align-middle">
                  Tu razón
                </span>
              )}
              {r.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Compact line next to an option on the vote screen (PT-20): the position the
 * previous round suggests for it and, on demand, its reasons for and against.
 */
export function OptionPreviousRound({
  optionId,
  report,
  onOpen,
}: {
  optionId: string;
  report: FeedbackReportData;
  /** P2.3 telemetry: called when the participant expands the reasons of others */
  onOpen?: (optionId: string) => void;
}) {
  const ranking = report.collective_ranking ?? [];
  const midRank = ranking.find((r) => r.id === optionId)?.midRank;
  if (midRank === undefined) return null;
  const reasons = report.reasonsByOption?.[optionId] ?? { reasonsFor: [], reasonsAgainst: [] };
  const total = reasons.reasonsFor.length + reasons.reasonsAgainst.length;
  return (
    <details
      className="mt-2 text-xs"
      onToggle={(e) => {
        if (e.currentTarget.open) onOpen?.(optionId);
      }}
    >
      <summary className="cursor-pointer select-none min-h-[40px] flex items-center text-ink">
        Ronda anterior: posición sugerida {formatRankPosition(midRank, ranking).label} · {total} {total === 1 ? 'razón' : 'razones'}
      </summary>
      <div className="space-y-2 pt-1">
        <ReasonSideBlock side="FOR" reasons={reasons.reasonsFor} />
        <ReasonSideBlock side="AGAINST" reasons={reasons.reasonsAgainst} />
      </div>
    </details>
  );
}

export default function RoundFeedbackReport({
  options,
  report,
  defaultOpen = false,
  final = false,
  onSectionOpen,
}: {
  options: FeedbackOption[];
  report: FeedbackReportData;
  defaultOpen?: boolean;
  /** The process finished: the order is the final result, not a suggestion */
  final?: boolean;
  /** P2.1 / P2.3 telemetry: called when the participant expands one option */
  onSectionOpen?: (optionId: string) => void;
}) {
  const ranking = report.collective_ranking ?? [];
  const sorted = [...options].sort(
    (a, b) => (ranking.find((r) => r.id === a.id)?.midRank ?? 99) - (ranking.find((r) => r.id === b.id)?.midRank ?? 99)
  );
  const own = report.myConcordance;
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(options.map((o) => [o.id, defaultOpen]))
  );
  const allOpen = sorted.length > 0 && sorted.every((o) => open[o.id]);
  const toggleAll = () => setOpen(Object.fromEntries(sorted.map((o) => [o.id, !allOpen])));

  return (
    <div className="space-y-4">
      <section className="p-4 rounded-[6px] border border-line bg-paper">
        <h3 className="font-heading text-base font-bold text-ink">Tu nivel de concordancia</h3>
        {own?.voted && own.cix !== null ? (
          <p className="mt-1 text-sm text-ink">
            Qué tanto se parece tu orden al orden del grupo:{' '}
            <span className="font-mono text-base font-bold">{Math.round(own.cix * 100)}%</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink">No enviaste tu selección en esta ronda, así que no hay un nivel de concordancia tuyo.</p>
        )}
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={toggleAll}
          className="min-h-[40px] px-3 rounded-[6px] border border-line bg-paper text-xs font-medium text-ink hover:bg-subtle"
        >
          {allOpen ? 'Ocultar todo' : 'Expandir todo'}
        </button>
      </div>

      <div className="space-y-2">
        {sorted.map((option) => {
          const title = option.title;
          const description = option.description;
          const midRank = ranking.find((r) => r.id === option.id)?.midRank;
          const position = midRank !== undefined ? formatRankPosition(midRank, ranking).label : 'Sin posición';
          const mine = report.myPositions?.[option.id];
          const reasons = report.reasonsByOption?.[option.id] ?? { reasonsFor: [], reasonsAgainst: [] };
          const legacy = (report.arguments_json?.[option.id] ?? []).filter((a) => a.justification);
          const total = reasons.reasonsFor.length + reasons.reasonsAgainst.length + legacy.length;
          const isOpen = Boolean(open[option.id]);

          return (
            <details
              key={option.id}
              open={isOpen}
              onToggle={(e) => {
                const next = e.currentTarget.open;
                if (next === isOpen) return;
                setOpen((prev) => ({ ...prev, [option.id]: next }));
                if (next && !defaultOpen) onSectionOpen?.(option.id);
              }}
              className="rounded-[6px] border border-line bg-paper"
            >
              <summary className="cursor-pointer select-none px-3 py-2.5 min-h-[44px] flex items-start gap-3">
                <span className="font-mono text-lg font-bold text-ink w-9 shrink-0 leading-tight">{position}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-sans font-semibold text-sm text-ink">{title}</span>
                  <span className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink/80 font-mono">
                    {/* The final position is already the number on the left */}
                    {!final && <span>Posición sugerida: {position}</span>}
                    <span>Tu posición: {mine ? `${mine}.º` : 'sin selección'}</span>
                    <span>Razones: {total}</span>
                  </span>
                </span>
              </summary>
              <div className="px-3 pb-3 space-y-2.5 border-t border-line pt-2.5">
                {description && <p className="text-xs text-ink/80 leading-relaxed">{description}</p>}
                <p className="text-xs font-medium text-ink">
                  {final ? `Quedó en la posición ${position} por estas razones:` : `Se sugiere la posición ${position} por estas razones:`}
                </p>
                <ReasonSideBlock side="FOR" reasons={reasons.reasonsFor} />
                <ReasonSideBlock side="AGAINST" reasons={reasons.reasonsAgainst} />
                {legacy.length > 0 && (
                  <div className="rounded-[6px] border border-line p-3">
                    <h4 className="text-xs font-semibold text-ink mb-2">Razones ({legacy.length})</h4>
                    <ul className="space-y-1.5">
                      {legacy.map((a, i) => (
                        <li key={i} className="px-2.5 py-2 rounded-[4px] border border-line bg-paper text-xs text-ink leading-relaxed whitespace-pre-wrap break-words">
                          {a.justification}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
