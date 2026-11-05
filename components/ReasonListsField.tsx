'use client';

/**
 * components/ReasonListsField.tsx
 * Optional reasons for and against one option (PT-14).
 * Two lists ("A favor", "En contra"), each with up to MAX_REASONS_PER_SIDE
 * entries of up to REASON_MAX_LENGTH characters. Nothing here is required.
 */

import React from 'react';
import { Plus, X } from 'lucide-react';
import {
  MAX_REASONS_PER_SIDE,
  REASON_MAX_LENGTH,
  getUnicodeLength,
  sanitizeText,
} from '@/lib/validations';

export type ReasonSideKey = 'for' | 'against';

export interface OptionReasons {
  for: string[];
  against: string[];
}

export const EMPTY_REASONS: OptionReasons = { for: [], against: [] };

const SIDE_LABEL: Record<ReasonSideKey, string> = {
  for: 'A favor',
  against: 'En contra',
};

const ADD_LABEL: Record<ReasonSideKey, string> = {
  for: 'Agregar razón a favor',
  against: 'Agregar razón en contra',
};

// ── Pure helpers (state transitions), exported for tests ─────────────────────

export function addReason(value: OptionReasons, side: ReasonSideKey): OptionReasons {
  if (value[side].length >= MAX_REASONS_PER_SIDE) return value;
  return { ...value, [side]: [...value[side], ''] };
}

export function removeReason(value: OptionReasons, side: ReasonSideKey, index: number): OptionReasons {
  return { ...value, [side]: value[side].filter((_, i) => i !== index) };
}

export function updateReason(
  value: OptionReasons,
  side: ReasonSideKey,
  index: number,
  text: string
): OptionReasons {
  return { ...value, [side]: value[side].map((t, i) => (i === index ? text : t)) };
}

/** Error text for one reason, or null. Empty reasons are allowed (they are dropped). */
export function reasonError(text: string): string | null {
  return getUnicodeLength(sanitizeText(text)) > REASON_MAX_LENGTH
    ? `Máximo ${REASON_MAX_LENGTH} caracteres por razón.`
    : null;
}

/** Non-empty, trimmed reasons, as they are sent to the server. */
export function cleanReasons(list: string[]): string[] {
  return list.map((t) => sanitizeText(t)).filter((t) => t.length > 0);
}

// ── Editable field ───────────────────────────────────────────────────────────

interface ReasonListsFieldProps {
  optionId: string;
  value: OptionReasons;
  onChange: (next: OptionReasons) => void;
  disabled?: boolean;
  /** P2.3 telemetry: a reason field was added on this side (no text is passed) */
  onFieldAdded?: (side: ReasonSideKey) => void;
  /** P2.3 telemetry: the participant typed in a reason of this side (no text is passed) */
  onTyping?: (side: ReasonSideKey) => void;
}

export default function ReasonListsField({
  optionId,
  value,
  onChange,
  disabled = false,
  onFieldAdded,
  onTyping,
}: ReasonListsFieldProps) {
  return (
    <fieldset className="mt-3 space-y-3" disabled={disabled}>
      <legend className="text-xs text-[#5A554E] leading-relaxed">
        Razones (opcional). Puedes escribir hasta {MAX_REASONS_PER_SIDE} a favor y {MAX_REASONS_PER_SIDE} en contra.
      </legend>
      {(['for', 'against'] as const).map((side) => {
        const list = value[side];
        const atLimit = list.length >= MAX_REASONS_PER_SIDE;
        return (
          <div key={side} className="space-y-2">
            <span className="block text-xs font-medium text-[#14171A]">{SIDE_LABEL[side]}</span>
            {list.map((text, index) => {
              const fieldId = `reason-${optionId}-${side}-${index}`;
              const err = reasonError(text);
              const length = getUnicodeLength(sanitizeText(text));
              return (
                <div key={index} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor={fieldId} className="text-[#5A554E]">
                      {SIDE_LABEL[side]} {index + 1}
                    </label>
                    <span className={`font-mono ${err ? 'text-[#B42318]' : 'text-[#5A554E]'}`}>
                      {length}/{REASON_MAX_LENGTH}
                    </span>
                  </div>
                  <div className="flex items-start gap-1">
                    <textarea
                      id={fieldId}
                      rows={2}
                      maxLength={REASON_MAX_LENGTH}
                      value={text}
                      onChange={(e) => {
                        onTyping?.(side);
                        onChange(updateReason(value, side, index, e.target.value));
                      }}
                      aria-invalid={Boolean(err)}
                      aria-describedby={err ? `${fieldId}-error` : undefined}
                      className={`flex-1 min-w-0 p-2.5 rounded-[6px] border bg-[#F6F4EF] text-sm text-[#14171A] focus:outline-none ${
                        err ? 'border-[#B42318]' : 'border-[#D9D5CC] focus:border-[#E4572E]'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => onChange(removeReason(value, side, index))}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#5A554E] hover:text-[#B42318]"
                      aria-label={`Quitar ${SIDE_LABEL[side].toLowerCase()} ${index + 1}`}
                    >
                      <X className="w-4 h-4 stroke-[1.5]" />
                    </button>
                  </div>
                  {err && (
                    <p id={`${fieldId}-error`} role="alert" className="text-xs text-[#B42318]">
                      {err}
                    </p>
                  )}
                </div>
              );
            })}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onFieldAdded?.(side);
                  onChange(addReason(value, side));
                }}
                disabled={atLimit}
                className="min-h-[44px] px-2 flex items-center gap-1.5 text-xs font-medium text-[#14171A] hover:text-[#E4572E] disabled:text-[#5A554E] disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4 stroke-[1.5]" />
                <span>{ADD_LABEL[side]}</span>
              </button>
              {atLimit && <span className="text-xs text-[#5A554E]">Llegaste al máximo de {MAX_REASONS_PER_SIDE}.</span>}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

// ── Read-only summary ────────────────────────────────────────────────────────

export function ReasonListsSummary({ value, legacyText }: { value: OptionReasons; legacyText?: string }) {
  const sides = (['for', 'against'] as const).filter((side) => value[side].length > 0);
  if (sides.length === 0 && !legacyText) {
    return <p className="text-xs text-[#5A554E]">Sin razones escritas.</p>;
  }
  return (
    <div className="space-y-2">
      {legacyText && (
        <p className="text-xs text-[#14171A] leading-relaxed bg-[#F6F4EF] p-2.5 rounded-[4px] border border-[#D9D5CC]/80 break-words">
          {legacyText}
        </p>
      )}
      {sides.map((side) => (
        <div key={side}>
          <span className="text-[11px] font-medium text-[#5A554E] block mb-1">{SIDE_LABEL[side]}</span>
          <ul className="space-y-1">
            {value[side].map((text, i) => (
              <li
                key={i}
                className="text-xs text-[#14171A] leading-relaxed bg-[#F6F4EF] p-2.5 rounded-[4px] border border-[#D9D5CC]/80 break-words"
              >
                {text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
