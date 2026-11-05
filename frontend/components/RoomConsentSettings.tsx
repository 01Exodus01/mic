'use client';

/**
 * components/RoomConsentSettings.tsx
 * Informed consent at room creation (PT-24). Off by default. When on, the host
 * writes the text (no default legal text): participants see it on their first
 * entry, must accept it to vote, and can read it again later.
 */

import React, { useState } from 'react';
import { CONSENT_TEXT_MAX, getUnicodeLength } from '@mic/backend/shared/validations';

export default function RoomConsentSettings({
  required,
  text,
  onChange,
  error,
}: {
  required: boolean;
  text: string;
  onChange: (next: { consentRequired: boolean; consentText: string }) => void;
  error?: string | null;
}) {
  const [touched, setTouched] = useState(false);
  const shownError = touched ? error : null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[#14171A]">Consentimiento informado</h2>
        <p className="text-xs text-[#5A554E] mt-0.5">
          Opcional. Si lo activas, cada participante lee tu texto al entrar por primera vez y debe aceptarlo para enviar su selección.
          No se puede cambiar después de iniciar la sala.
        </p>
      </div>
      <label className="flex items-start gap-3 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => onChange({ consentRequired: e.target.checked, consentText: text })}
          className="mt-0.5 accent-[#E4572E] w-4 h-4"
        />
        <span className="font-medium text-[#14171A]">Pedir consentimiento antes de la primera selección</span>
      </label>
      {required && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="consent-text" className="block text-xs font-semibold text-[#14171A]">
              Texto del consentimiento
            </label>
            <span className="font-mono text-xs text-[#5A554E]">
              {getUnicodeLength(text)}/{CONSENT_TEXT_MAX}
            </span>
          </div>
          <textarea
            id="consent-text"
            rows={8}
            maxLength={CONSENT_TEXT_MAX}
            value={text}
            onChange={(e) => onChange({ consentRequired: required, consentText: e.target.value })}
            onBlur={() => setTouched(true)}
            aria-invalid={Boolean(shownError)}
            aria-describedby={shownError ? 'consent-text-error' : 'consent-text-help'}
            className={`w-full p-3 rounded-[6px] border bg-white text-xs text-[#14171A] leading-relaxed focus:outline-none ${
              shownError ? 'border-[#B42318]' : 'border-[#D9D5CC] focus:border-[#E4572E]'
            }`}
          />
          {shownError ? (
            <p id="consent-text-error" role="alert" className="text-xs text-[#B42318]">
              {shownError}
            </p>
          ) : (
            <p id="consent-text-help" className="text-xs text-[#5A554E]">
              Escribe el texto que acordaron con quien supervisa la actividad.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
