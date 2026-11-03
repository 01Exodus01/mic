'use client';

import { useState, useEffect, useId } from 'react';
import { RoundDurationSchema } from '@/lib/validations';
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
];

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
  const [customInput, setCustomInput] = useState(isPreset ? '' : String(value));
  const [customError, setCustomError] = useState<string | null>(null);
  const inputId = useId();

  // Keep customInput synced if value changes externally
  useEffect(() => {
    const matching = PRESETS.find((p) => p.value === value);
    if (matching) {
      setIsCustom(false);
    } else {
      setIsCustom(true);
      setCustomInput(String(value));
    }
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
    const parsed = parseInt(customInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 10080) {
      onChange(parsed);
    } else {
      const defaultCustom = 45;
      setCustomInput(String(defaultCustom));
      onChange(defaultCustom);
    }
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setCustomInput(raw);
    const num = parseInt(raw, 10);
    const validation = RoundDurationSchema.safeParse(num);
    if (!validation.success) {
      setCustomError('La duración debe estar entre 1 y 10080 minutos.');
    } else {
      setCustomError(null);
      onChange(validation.data);
    }
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
            Minutos (1 a 10080):
          </label>
          <input
            id={inputId}
            type="number"
            min={1}
            max={10080}
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
