'use client';

/**
 * components/RosterCodeStep.tsx
 * Join step for course-roster rooms (PT-22): the personal code replaces the
 * name and 4-digit PIN. Same error for any failure.
 */

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import PasswordInput from '@/components/ui/PasswordInput';
import { joinRoomWithCode } from '@/app/actions/participant';
import { isWellFormedMemberCode, MEMBER_CODE_LENGTH } from '@/lib/member-codes';

export default function RosterCodeStep({
  roomPin,
  onBack,
  onChangeRoom,
  showBack,
}: {
  roomPin: string;
  onBack: () => void;
  onChangeRoom: () => void;
  showBack: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const formatError = touched && !isWellFormedMemberCode(code) ? `El código tiene ${MEMBER_CODE_LENGTH} caracteres, por ejemplo ABCDE-FGHJK.` : null;
  const activeError = serverError || formatError;
  const disabled = loading || !isWellFormedMemberCode(code);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setServerError(null);
    if (!isWellFormedMemberCode(code)) {
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      const res = await joinRoomWithCode(roomPin, code);
      if (res.success) {
        toast.success('Ingreso confirmado');
        router.push('/participant/vote');
      } else {
        setServerError(res.error || 'No se puede ingresar a esa sala. Revisa el PIN y tu código.');
        inputRef.current?.focus();
      }
    } catch {
      setServerError('Error de comunicación con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="member-code-input" className="block text-xs font-medium text-[#14171A] mb-2">
          Código personal
        </label>
        <PasswordInput
          ref={inputRef}
          id="member-code-input"
          autoFocus
          autoComplete="off"
          maxLength={MEMBER_CODE_LENGTH + 1}
          placeholder="ABCDE-FGHJK"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setServerError(null);
          }}
          onBlur={() => setTouched(true)}
          aria-invalid={Boolean(activeError)}
          aria-describedby={activeError ? 'member-code-error' : undefined}
          className={`h-[56px] font-mono text-xl tracking-widest uppercase ${
            activeError ? 'border-[#B42318] focus:border-[#B42318]' : 'border-[#D9D5CC] focus:border-[#E4572E]'
          }`}
        />
        {activeError && (
          <p id="member-code-error" role="alert" className="text-xs text-[#B42318] mt-1.5 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
            <span>{activeError}</span>
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <button
          type="submit"
          disabled={disabled}
          className="h-[56px] w-full bg-[#E4572E] hover:bg-[#E4572E]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base font-medium rounded-[6px] transition-colors"
        >
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
        {disabled && !loading && <p className="text-xs text-[#5A554E] text-center">Escribe el código que te entregó el anfitrión</p>}
      </div>

      <div className="flex items-center justify-between pt-2">
        {showBack ? (
          <button type="button" onClick={onBack} className="min-h-[44px] px-2 text-xs text-[#5A554E] hover:text-[#14171A] flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>Atrás</span>
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onChangeRoom} className="min-h-[44px] px-2 text-xs text-[#5A554E] hover:text-[#14171A]">
          Cambiar sala
        </button>
      </div>
    </form>
  );
}
