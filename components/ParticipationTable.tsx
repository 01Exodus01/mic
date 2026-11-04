'use client';

/**
 * components/ParticipationTable.tsx
 * Host view of participation per round (PT-25): who joined and who voted in
 * each round. Only states; never positions, reasons or blind codes.
 */

import React, { useEffect, useState } from 'react';
import { getRoomParticipation, type ParticipationData, type ParticipationState } from '@/app/actions/room';

export const PARTICIPATION_LABELS: Record<ParticipationState, string> = {
  not_joined: 'No había ingresado',
  joined: 'Ingresó',
  voted: 'Votó',
  not_voted: 'No votó',
  retired: 'Retirado',
  removed: 'Quitada de la lista',
};

const STATE_CLASS: Record<ParticipationState, string> = {
  not_joined: 'text-[#5A554E]',
  joined: 'text-[#B7791F]',
  voted: 'text-[#2F7D4F] font-medium',
  not_voted: 'text-[#B42318]',
  retired: 'text-[#5A554E] line-through',
  removed: 'text-[#5A554E]',
};

export function ParticipationGrid({ data }: { data: ParticipationData }) {
  if (data.rounds.length === 0) {
    return <p className="text-xs text-[#5A554E]">La participación por ronda aparece cuando se abre la primera votación.</p>;
  }
  if (data.rows.length === 0) {
    return <p className="text-xs text-[#5A554E]">Todavía no hay participantes.</p>;
  }
  return (
    <div className="border border-[#D9D5CC] rounded-[6px] bg-white overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-[#D9D5CC] bg-[#F6F4EF] text-[#5A554E]">
            <th className="py-2 px-3 font-medium">Persona</th>
            {data.rounds.map((r) => (
              <th key={r} className="py-2 px-3 font-medium font-mono whitespace-nowrap">
                Ronda {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#D9D5CC]">
          {data.rows.map((row) => (
            <tr key={row.key}>
              <td className="py-2 px-3 text-[#14171A] whitespace-nowrap">{row.name}</td>
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
        <h2 className="font-heading text-lg font-bold text-[#14171A]">Participación por ronda</h2>
        <p className="text-xs text-[#5A554E] mt-0.5">Quién ingresó y quién votó en cada ronda. No muestra el contenido de ningún voto.</p>
      </div>
      {data ? <ParticipationGrid data={data} /> : <div className="h-16 rounded-[6px] bg-[#EBE7DF]" aria-hidden="true" />}
    </section>
  );
}
