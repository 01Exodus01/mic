'use client';

/**
 * components/RoundSchedulePanel.tsx
 * Host: schedule when the next round opens and closes (before round 1, or
 * between rounds). The round then opens by itself (backend/src/round-schedule.ts).
 * With a schedule in place it shows it and lets the host remove it.
 */

import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock } from 'lucide-react';
import DurationPicker, { formatClosingMoment, toLocalInputValue } from '@/components/DurationPicker';
import { cancelScheduledRound, scheduleRound } from '@/app/actions/room';
import { MAX_ROUND_MINUTES } from '@mic/backend/shared/validations';

interface Props {
  roomId: string;
  /** Number of the round to schedule */
  round: number;
  scheduledOpenAt: string | Date | null;
  scheduledDeadline: string | Date | null;
  serverTime?: string;
  disabled?: boolean;
  onChanged: () => void | Promise<void>;
}

const MINUTE = 60 * 1000;

export default function RoundSchedulePanel({ roomId, round, scheduledOpenAt, scheduledDeadline, serverTime, disabled, onChanged }: Props) {
  const startId = useId();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [closesAt, setClosesAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const now = serverTime ? new Date(serverTime).getTime() : Date.now();
  const startDate = start ? new Date(start) : null;
  const startError =
    start && (!startDate || Number.isNaN(startDate.getTime()))
      ? 'Elige la fecha y hora de inicio.'
      : startDate && startDate.getTime() - now < MINUTE
        ? 'La hora de inicio tiene que ser al menos un minuto después de ahora.'
        : startDate && startDate.getTime() - now > MAX_ROUND_MINUTES * MINUTE
          ? 'Se puede programar hasta 30 días antes.'
          : null;
  const timingOk = closesAt === null ? minutes >= 1 && minutes <= MAX_ROUND_MINUTES : closesAt !== '';
  const ready = Boolean(startDate) && !startError && timingOk;

  const openForm = () => {
    // Suggest the next quarter hour at least 15 minutes from now
    const d = new Date(now + 15 * MINUTE);
    d.setSeconds(0, 0);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
    setStart(toLocalInputValue(d));
    setClosesAt(null);
    setOpen(true);
  };

  const save = async () => {
    if (!startDate || !ready) return;
    setBusy(true);
    try {
      const res = await scheduleRound(roomId, {
        opensAt: startDate.toISOString(),
        timing: closesAt === null ? minutes : { closesAt },
      });
      if (!res.success) {
        toast.error(res.error || 'No se pudo programar la ronda.');
        return;
      }
      toast.success(`Ronda ${round} programada para el ${formatClosingMoment(res.data ? new Date(res.data.opensAt) : startDate)}.`);
      setOpen(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await cancelScheduledRound(roomId);
      if (res.success) {
        toast.success('Se quitó la programación.');
        await onChanged();
      } else {
        toast.error(res.error || 'No se pudo quitar la programación.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (scheduledOpenAt && scheduledDeadline) {
    return (
      <div className="p-3.5 rounded-[6px] border border-good/40 bg-good/5 space-y-2" role="status">
        <p className="text-xs text-ink flex items-start gap-2">
          <CalendarClock className="w-4 h-4 stroke-[1.5] text-good shrink-0 mt-px" aria-hidden="true" />
          <span>
            La Ronda {round} se abrirá sola el <strong>{formatClosingMoment(new Date(scheduledOpenAt))}</strong> y cerrará el{' '}
            <strong>{formatClosingMoment(new Date(scheduledDeadline))}</strong>.
          </span>
        </p>
        <button
          type="button"
          onClick={remove}
          disabled={busy || disabled}
          className="text-xs text-danger hover:underline disabled:opacity-40"
        >
          Quitar la programación
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openForm}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:underline disabled:opacity-40"
      >
        <CalendarClock className="w-4 h-4 stroke-[1.5]" aria-hidden="true" />
        Programar la Ronda {round} para más tarde
      </button>
    );
  }

  return (
    <div className="p-3.5 rounded-[6px] border border-line bg-paper space-y-3">
      <div>
        <h3 className="text-xs font-semibold text-ink">Programar la Ronda {round}</h3>
        <p className="text-xs text-ink-2 mt-0.5">Se abre y se cierra sola a las horas que elijas.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={startId} className="block text-xs font-medium text-ink">
          Fecha y hora de inicio
        </label>
        <input
          id={startId}
          type="datetime-local"
          step={60}
          min={toLocalInputValue(new Date(now + MINUTE))}
          max={toLocalInputValue(new Date(now + MAX_ROUND_MINUTES * MINUTE))}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          aria-invalid={Boolean(startError)}
          aria-describedby={startError ? `${startId}-error` : undefined}
          className={`h-10 px-2.5 rounded-[6px] border bg-paper text-sm font-mono text-ink focus:outline-none ${
            startError ? 'border-danger' : 'border-line focus:border-brand'
          }`}
        />
        {startError && (
          <p id={`${startId}-error`} role="alert" className="text-xs text-danger">
            {startError}
          </p>
        )}
      </div>
      {startDate && !startError && (
        <DurationPicker
          key={start}
          value={minutes}
          onChange={setMinutes}
          closesAt={closesAt}
          onClosesAtChange={setClosesAt}
          mode="from_start"
          baseDeadline={startDate}
          label={`Duración de la Ronda ${round}`}
        />
      )}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={busy || disabled || !ready}
          className="px-4 py-2 rounded-[6px] bg-ink hover:bg-ink/90 text-paper text-xs font-semibold disabled:opacity-40"
        >
          {busy ? 'Programando...' : `Programar Ronda ${round}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-2 hover:text-ink hover:underline">
          Cancelar
        </button>
      </div>
    </div>
  );
}
