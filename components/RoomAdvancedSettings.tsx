'use client';

/**
 * components/RoomAdvancedSettings.tsx
 * Advanced room options at creation (PT-18) and their read-only summary for the
 * host panel. Defaults reproduce the behaviour before these options existed.
 */

import React from 'react';
import type { RoomSettings } from '@/lib/validations';

export type RoomSettingsValue = RoomSettings;

export const DEFAULT_ROOM_SETTINGS: RoomSettingsValue = {
  tieBreakRule: 'NONE',
  concordanceVariant: 'WITH_TIES',
  accessMode: 'OPEN_PIN',
  allowLateJoin: false,
  closeWhenAllVoted: false,
};

export const TIE_BREAK_LABELS: Record<RoomSettingsValue['tieBreakRule'], { name: string; help: string }> = {
  NONE: {
    name: 'Mantener los empates',
    help: 'Si dos opciones quedan igualadas, se muestran empatadas.',
  },
  LEXICOGRAPHIC: {
    name: 'Desempatar por el orden de la lista',
    help: 'Entre opciones empatadas, va primero la que aparece antes en la lista de opciones.',
  },
  REASON_BALANCE: {
    name: 'Desempatar por las razones',
    help: 'Entre opciones empatadas, va primero la que tiene más razones a favor que en contra. Si siguen igualadas, decide el orden de la lista.',
  },
};

export const VARIANT_LABELS: Record<RoomSettingsValue['concordanceVariant'], { name: string; help: string }> = {
  WITH_TIES: {
    name: 'Con empates',
    help: 'El nivel de acuerdo admite opciones empatadas en el orden del grupo.',
  },
  WITHOUT_TIES: {
    name: 'Sin empates',
    help: 'El nivel de acuerdo se mide sobre un orden sin empates. Necesita una regla de desempate.',
  },
};

export const ACCESS_LABELS: Record<RoomSettingsValue['accessMode'], { name: string; help: string }> = {
  OPEN_PIN: {
    name: 'Con el PIN de la sala',
    help: 'Cualquier persona con el PIN entra con un nombre y un PIN personal de 4 dígitos.',
  },
  ROSTER: {
    name: 'Solo personas de una lista',
    help: 'Cargas la lista y cada persona recibe un código personal para entrar.',
  },
};

interface RoomAdvancedSettingsProps {
  value: RoomSettingsValue;
  onChange: (next: RoomSettingsValue) => void;
  error?: string | null;
}

function RadioGroup<K extends string>({
  name,
  legend,
  options,
  selected,
  onSelect,
  disabledKeys = [],
  errorId,
}: {
  name: string;
  legend: string;
  options: Record<K, { name: string; help: string }>;
  selected: K;
  onSelect: (key: K) => void;
  disabledKeys?: K[];
  errorId?: string;
}) {
  return (
    <fieldset className="space-y-2" aria-describedby={errorId}>
      <legend className="text-xs font-semibold text-[#14171A] mb-1">{legend}</legend>
      {(Object.keys(options) as K[]).map((key) => {
        const disabled = disabledKeys.includes(key);
        return (
          <label
            key={key}
            className={`flex items-start gap-3 p-3 rounded-[6px] border bg-white ${
              selected === key ? 'border-[#E4572E]' : 'border-[#D9D5CC]'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <input
              type="radio"
              name={name}
              value={key}
              checked={selected === key}
              disabled={disabled}
              onChange={() => onSelect(key)}
              className="mt-1 accent-[#E4572E]"
            />
            <span className="text-xs">
              <span className="block font-medium text-[#14171A]">{options[key].name}</span>
              <span className="block text-[#5A554E] mt-0.5">{options[key].help}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export default function RoomAdvancedSettings({ value, onChange, error }: RoomAdvancedSettingsProps) {
  const set = <K extends keyof RoomSettingsValue>(key: K, v: RoomSettingsValue[K]) => onChange({ ...value, [key]: v });
  const variantNeedsRule = value.tieBreakRule === 'NONE';

  return (
    <details className="rounded-[6px] border border-[#D9D5CC] bg-white">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-[#14171A]">
        Opciones avanzadas
        <span className="block text-xs font-normal text-[#5A554E] mt-0.5">
          Si no cambias nada, la sala funciona como siempre. No se pueden cambiar después de iniciar la sala.
        </span>
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-5">
        <RadioGroup
          name="tieBreakRule"
          legend="Empates en el orden del grupo"
          options={TIE_BREAK_LABELS}
          selected={value.tieBreakRule}
          onSelect={(k) => set('tieBreakRule', k)}
        />
        <div className="space-y-1">
          <RadioGroup
            name="concordanceVariant"
            legend="Cómo se mide el nivel de acuerdo"
            options={VARIANT_LABELS}
            selected={value.concordanceVariant}
            onSelect={(k) => set('concordanceVariant', k)}
            disabledKeys={variantNeedsRule && value.concordanceVariant !== 'WITHOUT_TIES' ? ['WITHOUT_TIES'] : []}
            errorId={error ? 'settings-variant-error' : undefined}
          />
          {error && (
            <p id="settings-variant-error" role="alert" className="text-xs text-[#B42318]">
              {error}
            </p>
          )}
        </div>
        <RadioGroup
          name="accessMode"
          legend="Ingreso de participantes"
          options={ACCESS_LABELS}
          selected={value.accessMode}
          onSelect={(k) => set('accessMode', k)}
        />
        <label className="flex items-start gap-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={value.allowLateJoin}
            onChange={(e) => set('allowLateJoin', e.target.checked)}
            className="mt-0.5 accent-[#E4572E] w-4 h-4"
          />
          <span>
            <span className="block font-medium text-[#14171A]">Permitir que se sumen personas en rondas posteriores</span>
            <span className="block text-[#5A554E] mt-0.5">
              Si no lo marcas, solo participan en las rondas siguientes quienes votaron en la primera.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={value.closeWhenAllVoted}
            onChange={(e) => set('closeWhenAllVoted', e.target.checked)}
            className="mt-0.5 accent-[#E4572E] w-4 h-4"
          />
          <span>
            <span className="block font-medium text-[#14171A]">Cerrar la ronda en cuanto voten todos</span>
            <span className="block text-[#5A554E] mt-0.5">
              Si no lo marcas, la ronda espera a la hora límite o a que la cierres.
            </span>
          </span>
        </label>
      </div>
    </details>
  );
}

/** Read-only summary for the host panel. */
export function RoomSettingsSummary({
  room,
}: {
  room: {
    tie_break_rule?: RoomSettingsValue['tieBreakRule'];
    concordance_variant?: RoomSettingsValue['concordanceVariant'];
    access_mode?: RoomSettingsValue['accessMode'];
    allow_late_join?: boolean;
    close_when_all_voted?: boolean;
  };
}) {
  const rows: Array<[string, string]> = [
    ['Empates', TIE_BREAK_LABELS[room.tie_break_rule ?? 'NONE'].name],
    ['Nivel de acuerdo', VARIANT_LABELS[room.concordance_variant ?? 'WITH_TIES'].name],
    ['Ingreso', ACCESS_LABELS[room.access_mode ?? 'OPEN_PIN'].name],
    ['Personas en rondas posteriores', room.allow_late_join ? 'Se pueden sumar' : 'Solo quienes votaron en la primera'],
    ['Cierre de ronda', room.close_when_all_voted ? 'Cuando votan todos o a la hora límite' : 'A la hora límite o a mano'],
  ];
  return (
    <details className="rounded-[6px] border border-[#D9D5CC] bg-white text-xs">
      <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-[#14171A]">Configuración de la sala</summary>
      <dl className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-[#5A554E]">{k}</dt>
            <dd className="text-[#14171A]">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
    </details>
  );
}
