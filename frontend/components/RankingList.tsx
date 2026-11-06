'use client';

/**
 * components/RankingList.tsx
 * Editable ranking of the selection screen: one compact row per option
 * (position, title, a preview of the description, reasons on demand, up/down
 * buttons and a drag handle).
 *
 * - Dragging uses Pointer Events (mouse, pen and touch alike): the row "lifts"
 *   (scale + shadow) and follows the pointer while the rows it passes slide out
 *   of its way. Near the top or bottom edge the page scrolls by itself, and the
 *   mouse wheel keeps working while dragging.
 * - Every change of order (drag, buttons) is animated with FLIP: rows glide from
 *   where they were to where they end up.
 * - The reasons and the full description of one option open below its row, one
 *   option at a time.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Plus } from 'lucide-react';

export interface RankingItem {
  id: string;
  title?: string;
  description?: string;
}

export type MoveMethod = 'buttons' | 'drag' | 'touch';

interface RankingListProps {
  items: RankingItem[];
  /** Move the option at `from` to `to` (0-based). */
  onMove: (from: number, to: number, method: MoveMethod) => void;
  disabled?: boolean;
  /** Reasons written per option, shown on the row's button */
  reasonCounts: Record<string, { for: number; against: number }>;
  /** Content of the open option: full description, previous round, reasons */
  renderDetails: (item: RankingItem) => React.ReactNode;
  /** Height of the fixed bar at the bottom of the screen (auto-scroll stops above it) */
  bottomInset?: number;
  /** Option whose details are open (one at a time), controlled by the page */
  openId: string | null;
  onOpenChange: (id: string | null) => void;
}

interface DragState {
  id: string;
  from: number;
  over: number;
  startY: number;
  startScroll: number;
  dy: number;
  /** Document tops and heights of every row when the drag started */
  tops: number[];
  heights: number[];
  pointerType: string;
}

const GAP = 8; // space-y-2
const EDGE = 72; // px from the edge where auto-scroll starts
const MAX_SPEED = 16; // px per frame

export default function RankingList({
  items,
  onMove,
  disabled = false,
  reasonCounts,
  renderDetails,
  bottomInset = 150,
  openId,
  onOpenChange,
}: RankingListProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const pointerY = useRef(0);
  const rafRef = useRef<number | null>(null);
  /** Visual tops right before an order change, for the FLIP animation */
  const beforeTops = useRef<Map<string, number> | null>(null);

  const captureTops = () => {
    const map = new Map<string, number>();
    rowRefs.current.forEach((el, id) => map.set(id, el.getBoundingClientRect().top));
    beforeTops.current = map;
  };

  // FLIP: after the order changed, start each row where it was and glide to its place
  const orderKey = items.map((i) => i.id).join('|');
  useLayoutEffect(() => {
    const before = beforeTops.current;
    beforeTops.current = null;
    if (!before) return;
    rowRefs.current.forEach((el, id) => {
      const old = before.get(id);
      if (old === undefined) return;
      const delta = old - el.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      void el.offsetHeight; // apply the starting position before animating
      el.style.transition = 'transform 220ms cubic-bezier(0.2, 0, 0, 1)';
      el.style.transform = '';
    });
  }, [orderKey]);

  // Which index the dragged row would take, from the row centers at drag start
  const overIndex = (d: DragState, dy: number): number => {
    const center = d.tops[d.from] + d.heights[d.from] / 2 + dy;
    let idx = 0;
    for (let i = 0; i < d.tops.length; i++) {
      if (i === d.from) continue;
      if (d.tops[i] + d.heights[i] / 2 < center) idx++;
    }
    return idx;
  };

  const update = (clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = clientY - d.startY + (window.scrollY - d.startScroll);
    const next = { ...d, dy, over: overIndex(d, dy) };
    dragRef.current = next;
    setDrag(next);
  };

  // Auto-scroll while the pointer is near the top or bottom edge
  const tick = () => {
    const d = dragRef.current;
    if (!d) return;
    const y = pointerY.current;
    const bottomEdge = window.innerHeight - bottomInset;
    let speed = 0;
    if (y < EDGE) speed = -Math.ceil(((EDGE - y) / EDGE) * MAX_SPEED);
    else if (y > bottomEdge - EDGE) speed = Math.ceil(((y - (bottomEdge - EDGE)) / EDGE) * MAX_SPEED);
    if (speed !== 0) {
      window.scrollBy(0, speed);
      update(y);
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  // Wheel or scrollbar during a drag: keep the row under the pointer
  useEffect(() => {
    if (!drag) return;
    const onScroll = () => update(pointerY.current);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const startDrag = (e: React.PointerEvent, index: number) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const tops: number[] = [];
    const heights: number[] = [];
    items.forEach((it) => {
      const el = rowRefs.current.get(it.id);
      const r = el?.getBoundingClientRect();
      tops.push((r?.top ?? 0) + window.scrollY);
      heights.push(r?.height ?? 0);
    });
    const d: DragState = {
      id: items[index].id,
      from: index,
      over: index,
      startY: e.clientY,
      startScroll: window.scrollY,
      dy: 0,
      tops,
      heights,
      pointerType: e.pointerType,
    };
    pointerY.current = e.clientY;
    dragRef.current = d;
    setDrag(d);
    rafRef.current = requestAnimationFrame(tick);
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    pointerY.current = e.clientY;
    update(e.clientY);
  };

  const endDrag = () => {
    const d = dragRef.current;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    dragRef.current = null;
    if (!d) return;
    captureTops(); // from where the rows are on screen now (transforms included)
    setDrag(null);
    if (d.over !== d.from) onMove(d.from, d.over, d.pointerType === 'touch' ? 'touch' : 'drag');
  };

  const moveBy = (index: number, delta: number) => {
    const to = index + delta;
    if (disabled || to < 0 || to >= items.length) return;
    captureTops();
    onMove(index, to, 'buttons');
  };

  // Offset of each row while dragging: the dragged one follows the pointer,
  // the rows it passes move one slot the other way
  const offsetOf = (index: number): number => {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    const slot = drag.heights[drag.from] + GAP;
    if (drag.from < drag.over && index > drag.from && index <= drag.over) return -slot;
    if (drag.over < drag.from && index >= drag.over && index < drag.from) return slot;
    return 0;
  };

  return (
    <ol className="space-y-2" aria-label="Tu orden de las opciones">
      {items.map((item, index) => {
        const isDragged = drag?.id === item.id;
        const isOpen = openId === item.id && !drag;
        const counts = reasonCounts[item.id] ?? { for: 0, against: 0 };
        const total = counts.for + counts.against;
        const offset = offsetOf(index);
        return (
          <li
            key={item.id}
            ref={(el) => {
              if (el) rowRefs.current.set(item.id, el);
              else rowRefs.current.delete(item.id);
            }}
            style={
              drag
                ? {
                    transform: `translateY(${offset}px)${isDragged ? ' scale(1.02)' : ''}`,
                    transition: isDragged ? 'box-shadow 150ms' : 'transform 180ms cubic-bezier(0.2, 0, 0, 1)',
                  }
                : undefined
            }
            className={`relative rounded-[6px] border bg-white ${
              isDragged ? 'z-30 border-[#E4572E] shadow-[0_10px_24px_rgba(20,23,26,0.18)]' : 'z-0 border-[#D9D5CC]'
            }`}
          >
            <div className="flex items-start gap-2 pl-2.5 pr-1 py-1.5">
              <span className="font-mono text-lg font-bold text-[#14171A] w-6 shrink-0 pt-1.5 text-center" aria-hidden="true">
                {index + 1}
              </span>
              <div className="flex-1 min-w-0 py-1">
                <h2 className="font-sans font-semibold text-sm text-[#14171A] leading-snug break-words">
                  <span className="sr-only">Posición {index + 1}: </span>
                  {item.title}
                </h2>
                {item.description && (
                  <p className="text-xs text-[#14171A]/75 leading-snug mt-0.5 line-clamp-2 break-words">{item.description}</p>
                )}
                <button
                  type="button"
                  onClick={() => onOpenChange(isOpen ? null : item.id)}
                  aria-expanded={isOpen}
                  className={`mt-1 min-h-[32px] inline-flex items-center gap-1 rounded-[4px] px-2 -ml-2 text-xs font-medium transition-colors ${
                    total === 0 ? 'text-[#E4572E] hover:bg-[#E4572E]/10' : 'text-[#14171A] hover:bg-[#EBE7DF]'
                  }`}
                >
                  {total === 0 ? (
                    <>
                      <Plus className="w-3.5 h-3.5 stroke-[2]" aria-hidden="true" />
                      Agregar razones
                    </>
                  ) : (
                    <>
                      Razones:{' '}
                      <span className="font-mono text-[#2F7D4F]">+{counts.for}</span>
                      <span className="font-mono text-[#B42318]">−{counts.against}</span>
                    </>
                  )}
                  <ChevronDown className={`w-3.5 h-3.5 stroke-[1.5] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              </div>
              {!disabled && (
                <div className="flex items-center shrink-0">
                  <button
                    type="button"
                    onClick={() => moveBy(index, -1)}
                    disabled={index === 0}
                    className="w-10 h-11 flex items-center justify-center text-[#14171A] hover:bg-[#EBE7DF] rounded-[4px] disabled:opacity-20 transition-colors"
                    title="Subir opción"
                    aria-label={`Subir ${item.title ?? 'opción'}`}
                  >
                    <ArrowUp className="w-4 h-4 stroke-[1.5]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBy(index, 1)}
                    disabled={index === items.length - 1}
                    className="w-10 h-11 flex items-center justify-center text-[#14171A] hover:bg-[#EBE7DF] rounded-[4px] disabled:opacity-20 transition-colors"
                    title="Bajar opción"
                    aria-label={`Bajar ${item.title ?? 'opción'}`}
                  >
                    <ArrowDown className="w-4 h-4 stroke-[1.5]" />
                  </button>
                  <div
                    onPointerDown={(e) => startDrag(e, index)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className={`w-10 h-11 flex items-center justify-center text-[#14171A] touch-none select-none ${
                      isDragged ? 'cursor-grabbing' : 'cursor-grab'
                    }`}
                    title="Arrastrar para ordenar"
                    aria-hidden="true"
                  >
                    <GripVertical className="w-5 h-5 stroke-[1.5]" />
                  </div>
                </div>
              )}
            </div>
            {isOpen && <div className="px-3 pb-3 pt-2 border-t border-[#D9D5CC]">{renderDetails(item)}</div>}
          </li>
        );
      })}
    </ol>
  );
}
