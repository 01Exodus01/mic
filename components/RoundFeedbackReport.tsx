'use client';

/**
 * components/RoundFeedbackReport.tsx
 * Round feedback for a participant (PT-19), shared by the feedback screen and
 * the "results of the previous round" panel on the vote screen (PT-20).
 *
 * Shows the participant's own concordance and, per option (collapsible), their
 * position, the group position (ties as "1.º y 2.º empatadas", or the declared
 * tie-break rule) and every reason for and against, verbatim, signed with the
 * blind code. Nothing is summarized or shortened.
 */

import React from 'react';

export interface FeedbackOption {
  id: string;
  title?: string;
  description?: string;
}

export interface FeedbackReason {
  blindCode: string;
  position: number;
  text: string;
}

export interface FeedbackLegacyArgument {
  blindCode?: string;
  codigoCiego?: string;
  position?: number;
  justification?: string;
}

export interface FeedbackReportData {
  round?: number;
  collective_ranking?: Array<{ id: string; midRank: number }>;
  arguments_json?: Record<string, FeedbackLegacyArgument[]>;
  reasonsByOption?: Record<string, { reasonsFor: FeedbackReason[]; reasonsAgainst: FeedbackReason[] }>;
  tieBreak?: { rule: string; applied: boolean };
  myConcordance?: { voted: boolean; cix: number | null };
  myPositions?: Record<string, number>;
}

const TIE_BREAK_NOTE: Record<string, string> = {
  LEXICOGRAPHIC: 'Hubo empates y se desempataron por el orden de la lista de opciones.',
  REASON_BALANCE: 'Hubo empates y se desempataron por las razones (más a favor que en contra).',
};

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

function ReasonList({ title, reasons }: { title: string; reasons: FeedbackReason[] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-[#14171A] mb-1.5">
        {title} <span className="font-mono font-normal text-[#5A554E]">({reasons.length})</span>
      </h4>
      {reasons.length === 0 ? (
        <p className="text-xs text-[#5A554E]">Nadie escribió razones {title === 'A favor' ? 'a favor' : 'en contra'}.</p>
      ) : (
        <ul className="space-y-2">
          {reasons.map((r, i) => (
            <li key={i} className="p-3 rounded-[6px] border border-[#D9D5CC] bg-[#F6F4EF] text-xs space-y-1">
              <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-[#5A554E]">
                <span className="font-semibold text-[#14171A]">{formatParticipantSignature(r.blindCode)}</span>
                <span>Le dio el {r.position}.º lugar</span>
              </div>
              <p className="text-[#14171A] leading-relaxed whitespace-pre-wrap break-words">{r.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Compact line next to an option on the vote screen (PT-20): group position in
 * the previous round and, on demand, its reasons for and against.
 */
export function OptionPreviousRound({ optionId, report }: { optionId: string; report: FeedbackReportData }) {
  const ranking = report.collective_ranking ?? [];
  const midRank = ranking.find((r) => r.id === optionId)?.midRank;
  if (midRank === undefined) return null;
  const reasons = report.reasonsByOption?.[optionId] ?? { reasonsFor: [], reasonsAgainst: [] };
  const total = reasons.reasonsFor.length + reasons.reasonsAgainst.length;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer select-none min-h-[44px] flex items-center text-[#5A554E]">
        Ronda anterior: grupo {formatRankPosition(midRank, ranking).label} · {total} {total === 1 ? 'razón' : 'razones'}
      </summary>
      <div className="space-y-3 pt-1">
        <ReasonList title="A favor" reasons={reasons.reasonsFor} />
        <ReasonList title="En contra" reasons={reasons.reasonsAgainst} />
      </div>
    </details>
  );
}

export default function RoundFeedbackReport({
  options,
  report,
  defaultOpen = false,
}: {
  options: FeedbackOption[];
  report: FeedbackReportData;
  defaultOpen?: boolean;
}) {
  const ranking = report.collective_ranking ?? [];
  const sorted = [...options].sort(
    (a, b) => (ranking.find((r) => r.id === a.id)?.midRank ?? 99) - (ranking.find((r) => r.id === b.id)?.midRank ?? 99)
  );
  const own = report.myConcordance;
  const tieNote = report.tieBreak?.applied ? TIE_BREAK_NOTE[report.tieBreak.rule] : undefined;

  return (
    <div className="space-y-4">
      <section className="p-4 rounded-[6px] border border-[#D9D5CC] bg-white">
        <h3 className="font-heading text-base font-bold text-[#14171A]">Tu nivel de concordancia</h3>
        {own?.voted && own.cix !== null ? (
          <p className="mt-1 text-xs text-[#5A554E]">
            Qué tanto se parece tu orden al orden del grupo:{' '}
            <span className="font-mono text-base font-bold text-[#14171A]">{Math.round(own.cix * 100)}%</span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-[#5A554E]">No votaste en esta ronda, así que no hay un nivel de concordancia tuyo.</p>
        )}
      </section>

      {tieNote && <p className="text-xs text-[#14171A] p-3 rounded-[6px] border border-[#D9D5CC] bg-white">{tieNote}</p>}

      <div className="space-y-2">
        {sorted.map((option) => {
          const title = option.title;
          const description = option.description;
          const midRank = ranking.find((r) => r.id === option.id)?.midRank;
          const group = midRank !== undefined ? formatRankPosition(midRank, ranking).label : 'Sin posición';
          const mine = report.myPositions?.[option.id];
          const reasons = report.reasonsByOption?.[option.id] ?? { reasonsFor: [], reasonsAgainst: [] };
          const legacy = (report.arguments_json?.[option.id] ?? []).filter((a) => a.justification);
          const total = reasons.reasonsFor.length + reasons.reasonsAgainst.length + legacy.length;

          return (
            <details key={option.id} open={defaultOpen} className="rounded-[6px] border border-[#D9D5CC] bg-white">
              <summary className="cursor-pointer select-none p-4 min-h-[44px]">
                <span className="font-sans font-semibold text-sm text-[#14171A]">{title}</span>
                <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[#5A554E] font-mono">
                  <span>Grupo: {group}</span>
                  <span>Tú: {mine ? `${mine}.º` : 'sin voto'}</span>
                  <span>Razones: {total}</span>
                </span>
              </summary>
              <div className="px-4 pb-4 space-y-4 border-t border-[#D9D5CC] pt-3">
                {description && <p className="text-xs text-[#5A554E] leading-relaxed">{description}</p>}
                <ReasonList title="A favor" reasons={reasons.reasonsFor} />
                <ReasonList title="En contra" reasons={reasons.reasonsAgainst} />
                {legacy.length > 0 && (
                  <ReasonList
                    title="Razones"
                    reasons={legacy.map((a) => ({
                      blindCode: a.blindCode || a.codigoCiego || '',
                      position: a.position ?? 0,
                      text: a.justification || '',
                    }))}
                  />
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
