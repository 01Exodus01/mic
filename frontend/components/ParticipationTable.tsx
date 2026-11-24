'use client';

/**
 * components/ParticipationTable.tsx
 * Host view of participation per round (PT-25): who joined and who voted in
 * each round. Only states; never positions, reasons or blind codes.
 * Roster groups: one state per person (joined or not) and the rounds only as
 * totals, so a roster label cannot be matched with a blind code of the export.
 */

import React, { useEffect, useState } from 'react';
import { getRoomParticipation, type ParticipationData, type ParticipationState } from '@/app/actions/room';

export const PARTICIPATION_LABELS: Record<ParticipationState, string> = {
  not_joined: 'No había ingresado',
  joined: 'Ingresó',
  voted: 'Envió',
  not_voted: 'No envió',
  retired: 'Retirado',
  removed: 'Quitada de la lista',
};

const STATE_CLASS: Record<ParticipationState, string> = {
  not_joined: 'text-ink-2',
  joined: 'text-warn',
  voted: 'text-good font-medium',
  not_voted: 'text-danger',
  retired: 'text-ink-2 line-through',
  removed: 'text-ink-2',
};

function AggregateGrid({ data }: { data: ParticipationData }) {
  return (
    <div className="space-y-3">
      {data.totals.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Selecciones enviadas por ronda">
          {data.totals.map((t) => (
            <li key={t.round} className="border border-line rounded-[6px] bg-paper px-3 py-2 text-xs">
              <span className="font-mono text-ink-2">Ronda {t.round}</span>{' '}
              <span className="font-semibold text-ink">
                {t.sent} de {t.expected}
              </span>{' '}
              <span className="text-ink-2">enviaron</span>
            </li>
          ))}
        </ul>
      )}
      {data.rows.length === 0 ? (
        <p className="text-xs text-ink-2">Todavía no hay personas en la lista.</p>
      ) : (
        <div className="border border-line rounded-[6px] bg-paper overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-canvas text-ink-2">
                <th className="py-2 px-3 font-medium">Persona</th>
                <th className="py-2 px-3 font-medium">Ingreso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.rows.map((row) => (
                <tr key={row.key}>
                  <td className="py-2 px-3 text-ink whitespace-nowrap">{row.name}</td>
                  <td className={`py-2 px-3 whitespace-nowrap ${STATE_CLASS[row.states[0]]}`}>
                    {row.states[0] === 'not_joined' ? 'No ha ingresado' : PARTICIPATION_LABELS[row.states[0]]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-2">
        En los grupos con lista no se muestra quién envió en cada ronda, solo cuántos: así nadie puede relacionar a una persona de la lista con su código anónimo en los datos.
      </p>
    </div>
  );
}

export function ParticipationGrid({ data }: { data: ParticipationData }) {
  if (data.aggregateOnly) return <AggregateGrid data={data} />;
  if (data.rounds.length === 0) {
    return <p className="text-xs text-ink-2">La participación por ronda aparece cuando se abre la primera ronda.</p>;
  }
  if (data.rows.length === 0) {
    return <p className="text-xs text-ink-2">Todavía no hay participantes.</p>;
  }
  return (
    <div className="border border-line rounded-[6px] bg-paper overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-line bg-canvas text-ink-2">
            <th className="py-2 px-3 font-medium">Persona</th>
            {data.rounds.map((r) => (
              <th key={r} className="py-2 px-3 font-medium font-mono whitespace-nowrap">
                Ronda {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.rows.map((row) => (
            <tr key={row.key}>
              <td className="py-2 px-3 text-ink whitespace-nowrap">{row.name}</td>
              {row.states.map((s, i) => (
                <td key={i} className={`py-2 px-3 whitespace-nowrap ${STATE_CLASS[s]}`}>
                  {PARTICIPATION_LABELS[s]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ParticipationTable({ roomId, refreshKey }: { roomId: string; refreshKey: string }) {
  const [data, setData] = useState<ParticipationData | null>(null);

  useEffect(() => {
    let active = true;
    getRoomParticipation(roomId).then((res) => {
      if (active && res.success && res.data) setData(res.data);
    });
    return () => {
      active = false;
    };
  }, [roomId, refreshKey]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-heading text-lg font-bold text-ink">Participación por ronda</h2>
        <p className="text-xs text-ink-2 mt-0.5">
          {data?.aggregateOnly
            ? 'Quién ingresó y cuántas personas enviaron su selección en cada ronda.'
            : 'Quién ingresó y quién envió su selección en cada ronda. No muestra el contenido de ninguna selección.'}
        </p>
      </div>
      {data ? <ParticipationGrid data={data} /> : <div className="h-16 rounded-[6px] bg-subtle" aria-hidden="true" />}
    </section>
  );
}
