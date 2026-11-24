'use client';

/**
 * components/HiddenReasonsNotice.tsx
 * Tells a participant which of their reasons the host hid for inappropriate
 * content (only they see it). The selection still counts.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface HiddenReason {
  round: number;
  optionTitle: string;
  side: 'FOR' | 'AGAINST';
  text: string;
}

export default function HiddenReasonsNotice({ reasons }: { reasons?: HiddenReason[] | null }) {
  if (!reasons || reasons.length === 0) return null;
  const one = reasons.length === 1;
  return (
    <div role="status" className="p-3.5 rounded-[6px] border border-warn/50 bg-warn/10 space-y-2">
      <p className="flex items-start gap-2 text-sm font-semibold text-ink">
        <AlertTriangle className="w-4 h-4 stroke-[1.5] text-warn shrink-0 mt-0.5" aria-hidden="true" />
        {one ? 'Una de tus razones no se mostrará al grupo' : 'Algunas de tus razones no se mostrarán al grupo'}
      </p>
      <p className="text-xs text-ink">
        El anfitrión {one ? 'la consideró inadecuada' : 'las consideró inadecuadas'}, por eso no {one ? 'se tendrá' : 'se tendrán'} en
        cuenta. Tu selección sí cuenta para el resultado.
      </p>
      <ul className="space-y-1">
        {reasons.map((r, i) => (
          <li key={i} className="text-xs text-ink-2">
            Ronda {r.round} · {r.optionTitle} · {r.side === 'FOR' ? 'a favor' : 'en contra'}:{' '}
            <span className="text-ink">«{r.text}»</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
