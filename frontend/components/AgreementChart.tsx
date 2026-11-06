'use client';

/**
 * components/AgreementChart.tsx
 * Host panel: how the group's level of concordance (collective CIX, τ*)
 * progresses round after round, against the required agreement.
 *
 * One series → no legend (the title names it). Line 2px with 8px points,
 * dashed reference line for the required agreement, recessive grid, the last
 * value labeled directly, a tooltip on hover/focus of each point, and the same
 * data as a table for screen readers.
 */

import React, { useEffect, useRef, useState } from 'react';

export interface AgreementPoint {
  round: number;
  /** Collective level of concordance, 0..1 */
  value: number;
}

const H = 200;
const PAD = { top: 16, right: 44, bottom: 30, left: 40 };
const SERIES = '#E4572E';
const INK = '#14171A';
const MUTED = '#5A554E';
const GRID = '#EBE7DF';

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function AgreementChart({
  points,
  threshold,
  maxRounds,
}: {
  points: AgreementPoint[];
  threshold: number;
  maxRounds: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the real width of its box so text stays 11px on every screen
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setW(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rounds = Math.max(maxRounds, points[points.length - 1]?.round ?? 1, 2);
  const x = (r: number) => PAD.left + ((r - 1) / (rounds - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v) * (H - PAD.top - PAD.bottom);
  const sorted = [...points].sort((a, b) => a.round - b.round);
  const path = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.round)},${y(p.value)}`).join(' ');
  const last = sorted[sorted.length - 1];

  return (
    <figure className="space-y-2">
      <figcaption className="text-xs font-semibold text-[#14171A]">
        Nivel de acuerdo del grupo por ronda
        <span className="font-normal text-[#5A554E]"> · la línea punteada es el acuerdo requerido ({pct(threshold)})</span>
      </figcaption>
      <div ref={boxRef} className="relative">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`Nivel de acuerdo por ronda: ${sorted.map((p) => `ronda ${p.round} ${pct(p.value)}`).join(', ')}. Acuerdo requerido ${pct(threshold)}.`}>
          {/* recessive grid and y axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED} fontFamily="ui-monospace, monospace">
                {pct(t)}
              </text>
            </g>
          ))}
          {/* x axis: every round up to the maximum */}
          {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
            <text key={r} x={x(r)} y={H - 8} textAnchor="middle" fontSize={11} fill={MUTED} fontFamily="ui-monospace, monospace">
              R{r}
            </text>
          ))}
          {/* required agreement */}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(threshold)} y2={y(threshold)} stroke={INK} strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={W - PAD.right + 4} y={y(threshold)} dy="0.32em" fontSize={11} fill={INK} fontFamily="ui-monospace, monospace">
            {pct(threshold)}
          </text>
          {/* series */}
          {sorted.length > 1 && <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {sorted.map((p, i) => (
            <g
              key={p.round}
              tabIndex={0}
              role="button"
              aria-label={`Ronda ${p.round}: ${pct(p.value)}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="outline-none"
            >
              {/* hit target bigger than the mark */}
              <circle cx={x(p.round)} cy={y(p.value)} r={14} fill="transparent" />
              <circle cx={x(p.round)} cy={y(p.value)} r={hover === i ? 6 : 4.5} fill={SERIES} stroke="#FFFFFF" strokeWidth={2} />
            </g>
          ))}
          {/* direct label on the latest value only */}
          {last && hover === null && (
            <text x={x(last.round)} y={y(last.value) - 12} textAnchor="middle" fontSize={12} fontWeight={700} fill={INK} fontFamily="ui-monospace, monospace">
              {pct(last.value)}
            </text>
          )}
        </svg>
        {hover !== null && sorted[hover] && (
          <div
            role="tooltip"
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-[4px] border border-[#D9D5CC] bg-white px-2 py-1 text-xs text-[#14171A] shadow-sm whitespace-nowrap"
            style={{ left: `${(x(sorted[hover].round) / W) * 100}%`, top: `${(y(sorted[hover].value) / H) * 100}%`, marginTop: -10 }}
          >
            Ronda {sorted[hover].round}: <strong className="font-mono">{pct(sorted[hover].value)}</strong>
            {hover > 0 && (
              <span className="text-[#5A554E]">
                {' '}({sorted[hover].value - sorted[hover - 1].value >= 0 ? '+' : '−'}
                {Math.abs(Math.round((sorted[hover].value - sorted[hover - 1].value) * 100))} pts)
              </span>
            )}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Nivel de acuerdo por ronda</caption>
        <thead>
          <tr>
            <th>Ronda</th>
            <th>Nivel de acuerdo</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.round}>
              <td>{p.round}</td>
              <td>{pct(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
