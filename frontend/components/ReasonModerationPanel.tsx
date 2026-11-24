'use client';

/**
 * components/ReasonModerationPanel.tsx
 * Host: read the reasons of a round without their authors and hide the
 * inappropriate ones (team request 2026-11-24). A hidden reason leaves the
 * participants' feedback and only its author is told; the selection still
 * counts. Works while the round is open (before the reasons are shown) and
 * afterwards; hiding can be undone.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { getReasonsForModeration, setReasonHidden, type ModerationData } from '@/app/actions/moderation';

export default function ReasonModerationPanel({ roomId, refreshKey }: { roomId: string; refreshKey: string }) {
  const [data, setData] = useState<ModerationData | null>(null);
  const [round, setRound] = useState<number | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (r?: number) => {
      const res = await getReasonsForModeration(roomId, r);
      if (res.success && res.data) setData(res.data);
    },
    [roomId]
  );

  useEffect(() => {
    load(round);
  }, [load, round, refreshKey]);

  const toggle = async (reasonId: string, hide: boolean) => {
    setBusyId(reasonId);
    try {
      const res = await setReasonHidden(roomId, reasonId, hide);
      if (!res.success) {
        toast.error(res.error || 'No se pudo cambiar la razón.');
        return;
      }
      toast.success(hide ? 'Razón oculta. Su autor verá un aviso; su selección sigue contando.' : 'La razón se vuelve a mostrar.');
      await load(data?.round ?? undefined);
    } finally {
      setBusyId(null);
    }
  };

  const total = data?.options.reduce((n, o) => n + o.reasons.length, 0) ?? 0;

  return (
    <section className="space-y-3" aria-labelledby="moderation-title">
      <div>
        <h2 id="moderation-title" className="text-sm font-semibold text-ink">
          Moderación de razones
        </h2>
        <p className="text-xs text-ink-2 mt-0.5">
          Revisa las razones sin saber quién las escribió. Si una es ofensiva o inadecuada, ocúltala: no aparecerá en la
          retroalimentación y su autor verá un aviso. Su selección sigue contando.
        </p>
      </div>

      {!data ? (
        <div className="h-16 rounded-[6px] bg-subtle" aria-hidden="true" />
      ) : data.round === null ? (
        <p className="text-xs text-ink-2">Las razones aparecen aquí cuando se abre la primera ronda.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ronda">
            {data.rounds.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRound(r)}
                aria-pressed={r === data.round}
                className={`min-h-[32px] px-3 rounded-[6px] text-xs font-mono transition-colors ${
                  r === data.round ? 'bg-ink text-paper font-medium' : 'bg-paper border border-line text-ink hover:bg-subtle'
                }`}
              >
                Ronda {r}
              </button>
            ))}
            <span className="text-xs text-ink-2 ml-1">
              {total} {total === 1 ? 'razón' : 'razones'}
              {data.hiddenCount > 0 ? ` · ${data.hiddenCount} ${data.hiddenCount === 1 ? 'oculta' : 'ocultas'}` : ''}
            </span>
          </div>

          {total === 0 ? (
            <p className="text-xs text-ink-2">Nadie escribió razones en esta ronda todavía.</p>
          ) : (
            <div className="space-y-2">
              {data.options
                .filter((o) => o.reasons.length > 0)
                .map((o) => (
                  <details key={o.id} className="group border border-line rounded-[6px] bg-paper" open>
                    <summary className="flex items-center justify-between gap-3 cursor-pointer select-none px-3 py-2 text-xs font-semibold text-ink">
                      <span className="truncate">{o.title}</span>
                      <span className="flex items-center gap-2 shrink-0 font-normal text-ink-2">
                        {o.reasons.length}
                        <ChevronDown className="w-4 h-4 stroke-[1.5] group-open:rotate-180 transition-transform" aria-hidden="true" />
                      </span>
                    </summary>
                    <ul className="divide-y divide-line border-t border-line">
                      {o.reasons.map((r) => (
                        <li key={r.id} className={`flex items-start gap-3 px-3 py-2 text-xs ${r.hidden ? 'bg-danger/5' : ''}`}>
                          <span
                            className={`shrink-0 mt-px px-1.5 py-px rounded-[3px] text-[10px] font-semibold ${
                              r.side === 'FOR' ? 'bg-good/10 text-good' : 'bg-danger/10 text-danger'
                            }`}
                          >
                            {r.side === 'FOR' ? 'A favor' : 'En contra'}
                          </span>
                          <span className={`flex-1 min-w-0 break-words ${r.hidden ? 'text-ink-2 line-through' : 'text-ink'}`}>{r.text}</span>
                          {r.hidden && <span className="shrink-0 text-[11px] font-semibold text-danger">Oculta</span>}
                          <button
                            type="button"
                            onClick={() => toggle(r.id, !r.hidden)}
                            disabled={busyId === r.id}
                            className="shrink-0 inline-flex items-center gap-1 min-h-[28px] px-2 rounded-[4px] border border-line text-[11px] font-medium text-ink hover:bg-subtle disabled:opacity-40"
                          >
                            {r.hidden ? <Eye className="w-3.5 h-3.5 stroke-[1.5]" /> : <EyeOff className="w-3.5 h-3.5 stroke-[1.5]" />}
                            {r.hidden ? 'Mostrar de nuevo' : 'Ocultar'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
