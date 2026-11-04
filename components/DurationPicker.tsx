'use client';

import React, { useState, useEffect, useId } from 'react';
import { RoundDurationSchema, MAX_ROUND_MINUTES } from '@/lib/validations';
import { Clock } from 'lucide-react';

interface DurationPickerProps {
  value: number;
  onChange: (minutes: number) => void;
  serverTime?: string | Date | null;
  baseDeadline?: string | Date | null;
  mode?: 'from_now' | 'from_deadline';
  disabled?: boolean;
  className?: string;
  label?: string;
}

const PRESETS = [
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 h', value: 60 },
  { label: '24 h', value: 1440 },
  { label: '3 días', value: 4320 },
  { label: '1 semana', value: 10080 },
  { label: '2 semanas', value: 20160 },
];

const UNITS = [
  { key: 'min', label: 'minutos', minutes: 1 },
  { key: 'h', label: 'horas', minutes: 60 },
  { key: 'd', label: 'días', minutes: 1440 },
  { key: 'w', label: 'semanas', minutes: 10080 },
] as const;
type UnitKey = (typeof UNITS)[number]['key'];

/** Largest unit that divides the minutes exactly, for showing a custom value. */
function splitMinutes(total: number): { amount: number; unit: UnitKey } {
  for (const u of [...UNITS].reverse()) {
    if (total >= u.minutes && total % u.minutes === 0) return { amount: total / u.minutes, unit: u.key };
  }
  return { amount: total, unit: 'min' };
}

/** Deadline label: only the time when it is today, otherwise also the date (PT-28). */
export function formatDeadlineLabel(deadline: Date, now: Date = new Date()): string {
  const time = deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = deadline.toDateString() === now.toDateString();
  if (sameDay) return time;
  const date = deadline.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  return `${date} ${time}`;
}

/**
 * Countdown text that stays readable for rounds of several days (PT-28):
 * "2 d 03:15:20", "1:05:09", "04:59".
 */
export function formatCountdown(diffMs: number): string {
  const totalSecs = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const mmss = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  if (days > 0) return `${days} d ${String(hours).padStart(2, '0')}:${mmss}`;
  if (hours > 0) return `${hours}:${mmss}`;
  return mmss;
}

export default function DurationPicker({
  value,
  onChange,
  serverTime,
  baseDeadline,
  mode = 'from_now',
  disabled = false,
  className = '',
  label = 'Duración',
}: DurationPickerProps) {
  const isPreset = PRESETS.some((p) => p.value === value);
  const [isCustom, setIsCustom] = useState(!isPreset);
  const [customInput, setCustomInput] = useState(isPreset ? '' : String(splitMinutes(value).amount));
  const [customUnit, setCustomUnit] = useState<UnitKey>(isPreset ? 'min' : splitMinutes(value).unit);
  const [customError, setCustomError] = useState<string | null>(null);
  const inputId = useId();

  // Keep customInput synced if value changes externally
  useEffect(() => {
    const matching = PRESETS.find((p) => p.value === value);
    if (matching) {
      setIsCustom(false);
    } else {
      setIsCustom(true);
      const unitMinutes = UNITS.find((u) => u.key === customUnit)!.minutes;
      if (value % unitMinutes === 0) {
        setCustomInput(String(value / unitMinutes));
      } else {
        const split = splitMinutes(value);
        setCustomInput(String(split.amount));
        setCustomUnit(split.unit);
      }
    }
    // customUnit is read, not a trigger: only external value changes resync
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handlePresetClick = (mins: number) => {
    if (disabled) return;
    setIsCustom(false);
    setCustomError(null);
    onChange(mins);
  };

  const handleCustomToggle = () => {
    if (disabled) return;
    setIsCustom(true);
    const parsed = parseInt(customInput, 10) * UNITS.find((u) => u.key === customUnit)!.minutes;
    if (!isNaN(parsed) && parsed >= 1 && parsed <= MAX_ROUND_MINUTES) {
      onChange(parsed);
    } else {
      const defaultCustom = 45;
      setCustomInput(String(defaultCustom));
      setCustomUnit('min');
      onChange(defaultCustom);
    }
  };

  const applyCustom = (raw: string, unit: UnitKey) => {
    const num = Number(raw);
    const minutes = Number.isInteger(num) ? num * UNITS.find((u) => u.key === unit)!.minutes : NaN;
    const validation = RoundDurationSchema.safeParse(minutes);
    if (!validation.success) {
      setCustomError('La duración debe estar entre 1 minuto y 30 días.');
    } else {
      setCustomError(null);
      onChange(validation.data);
    }
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomInput(e.target.value);
    applyCustom(e.target.value, customUnit);
  };

  const handleUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const unit = e.target.value as UnitKey;
    setCustomUnit(unit);
    applyCustom(customInput, unit);
  };

  // Calculate live preview of deadline
  const baseMs = (() => {
    if (mode === 'from_deadline' && baseDeadline) {
      const d = new Date(baseDeadline).getTime();
      if (!isNaN(d) && d > Date.now()) return d;
    }
    if (serverTime) {
      const s = new Date(serverTime).getTime();
      if (!isNaN(s)) return s;
    }
    return Date.now();
  })();

  const previewDate = !customError && value >= 1 ? new Date(baseMs + value * 60000) : null;

  const formatPreview = (d: Date): string => {
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${mins}`;

    // If different calendar date, include date
    const today = new Date(baseMs);
    const isSameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();

    if (!isSameDay) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      return `${day}/${month} ${timeStr}`;
    }
    return timeStr;
  };

  return (
    <div className={`space-y-2.5 ${className}`}>
      {label && <label className="block text-xs font-medium text-[#14171A]">{label}</label>}

      {/* Preset pills and custom button */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Selección de duración">
        {PRESETS.map((p) => {
          const active = !isCustom && value === p.value;
          return (
            <button
              key={p.value}
              type="button"
              disabled={disabled}
              onClick={() => handlePresetClick(p.value)}
              className={`min-h-[36px] px-3 py-1.5 rounded-[6px] text-xs font-mono transition-colors disabled:opacity-40 ${
                active
                  ? 'bg-[#14171A] text-white font-medium'
                  : 'bg-white border border-[#D9D5CC] text-[#14171A] hover:bg-[#EBE7DF]'
              }`}
            >
              {p.label}
            </button>
          );
        })}

        <button
          type="button"
          disabled={disabled}
          onClick={handleCustomToggle}
          className={`min-h-[36px] px-3 py-1.5 rounded-[6px] text-xs font-sans transition-colors disabled:opacity-40 ${
            isCustom
              ? 'bg-[#14171A] text-white font-medium'
              : 'bg-white border border-[#D9D5CC] text-[#14171A] hover:bg-[#EBE7DF]'
          }`}
        >
          Personalizado
        </button>
      </div>

      {/* Custom input field */}
      {isCustom && (
        <div className="flex items-center gap-2 pt-1">
          <label htmlFor={inputId} className="text-xs text-[#5A554E] shrink-0">
            Duración (hasta 30 días):
          </label>
          <input
            id={inputId}
            type="number"
            min={1}
            max={MAX_ROUND_MINUTES / UNITS.find((u) => u.key === customUnit)!.minutes}
            step={1}
            disabled={disabled}
            value={customInput}
            onChange={handleCustomChange}
            aria-invalid={Boolean(customError)}
            aria-describedby={customError ? `${inputId}-error` : undefined}
            className={`w-28 h-9 px-2.5 rounded-[6px] border bg-white text-xs font-mono text-[#14171A] focus:outline-none transition-colors ${
              customError ? 'border-[#B42318] focus:border-[#B42318]' : 'border-[#D9D5CC] focus:border-[#E4572E]'
            }`}
          />
          <select
            aria-label="Unidad de la duración"
            disabled={disabled}
            value={customUnit}
            onChange={handleUnitChange}
            className="h-9 px-2 rounded-[6px] border border-[#D9D5CC] bg-white text-xs text-[#14171A] focus:outline-none focus:border-[#E4572E]"
          >
            {UNITS.map((u) => (
              <option key={u.key} value={u.key}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {customError && (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-[#B42318]">
          {customError}
        </p>
      )}

      {/* Live deadline preview */}
      {previewDate && (
        <div className="flex items-center gap-1.5 text-xs text-[#5A554E]">
          <Clock className="w-3.5 h-3.5 stroke-[1.5] text-[#5A554E]" />
          <span>
            Nueva hora límite:{' '}
            <strong className="font-mono font-semibold text-[#14171A]">
              {formatPreview(previewDate)}
            </strong>
          </span>
        </div>
      )}
    </div>
  );
}
