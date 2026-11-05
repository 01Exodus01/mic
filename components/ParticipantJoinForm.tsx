'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { joinRoom, verifyRoomPin, checkNicknameInRoom } from '@/app/actions/participant';
import { RoomPinSchema, ParticipantNicknameSchema, PersonalPinSchema } from '@/lib/validations';
import { toast } from 'sonner';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import PasswordInput from '@/components/ui/PasswordInput';

import RosterCodeStep from '@/components/RosterCodeStep';
import { getDeviceTag } from '@/lib/telemetry/client';

interface ParticipantJoinFormProps {
  initialPin?: string;
}

export default function ParticipantJoinForm({ initialPin = '' }: ParticipantJoinFormProps) {
  const router = useRouter();
  const cleanInitialPin = initialPin.trim().toUpperCase();
  const hasFixedPin = cleanInitialPin.length >= 6;

  // Step navigation
  const [step, setStep] = useState<1 | 2 | 3>(hasFixedPin ? 2 : 1);
  const [isReturningUser, setIsReturningUser] = useState(false);
  // PT-22: roster rooms ask for a personal code instead of name + PIN
  const [accessMode, setAccessMode] = useState<'OPEN_PIN' | 'ROSTER' | null>(null);
  const [loading, setLoading] = useState(false);

  // Field 1: Room PIN
  const pinInputRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState(cleanInitialPin);
  const [pinTouched, setPinTouched] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinServerError, setPinServerError] = useState<string | null>(null);

  // Field 2: Nickname
  const nickInputRef = useRef<HTMLInputElement>(null);
  const [nickname, setNickname] = useState('');
  const [nickTouched, setNickTouched] = useState(false);
  const [nickError, setNickError] = useState<string | null>(null);
  const [nickServerError, setNickServerError] = useState<string | null>(null);

  // Field 3: Personal PIN
  const pin4InputRef = useRef<HTMLInputElement>(null);
  const [pin4, setPin4] = useState('');
  const [pin4Touched, setPin4Touched] = useState(false);
  const [pin4Error, setPin4Error] = useState<string | null>(null);
  const [pin4ServerError, setPin4ServerError] = useState<string | null>(null);

  // Sincronización con el historial del navegador (AUD-14)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state?.step && (e.state.step === 1 || e.state.step === 2 || e.state.step === 3)) {
        setStep(e.state.step);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // With a PIN in the link the first step is skipped: still ask how this room is joined
  useEffect(() => {
    if (!hasFixedPin) return;
    verifyRoomPin(cleanInitialPin)
      .then((res) => {
        if (res.success && res.data) {
          setAccessMode(res.data.accessMode);
        } else {
          setPinServerError((!res.success && res.error) || 'No se puede ingresar a esa sala. Revisa el PIN.');
          setStep(1);
        }
      })
      .catch(() => undefined);
  }, [hasFixedPin, cleanInitialPin]);

  const goToStep = (nextStep: 1 | 2 | 3) => {
    setStep(nextStep);
    if (typeof window !== 'undefined') {
      window.history.pushState({ step: nextStep }, '', window.location.pathname);
    }
  };

  const handleChangeRoom = () => {
    setPinServerError(null);
    setNickServerError(null);
    setPin4ServerError(null);
    setPin('');
    setPinTouched(false);
    setPinError(null);
    goToStep(1);
    if (hasFixedPin) {
      router.push('/join');
    }
  };

  // ── Validation Helpers using shared Zod schemas ──

  const validatePin = (val: string): string | null => {
    const res = RoomPinSchema.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'El PIN de la sala debe tener 6 caracteres alfanuméricos.';
    }
    return null;
  };

  const validateNickname = (val: string): string | null => {
    const res = ParticipantNicknameSchema.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'El nombre es obligatorio.';
    }
    return null;
  };

  const validatePin4 = (val: string): string | null => {
    const res = PersonalPinSchema.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'El PIN personal debe tener exactamente 4 dígitos.';
    }
    return null;
  };

  // ── Step 1 Handlers ──

  const handlePinBlur = () => {
    setPinTouched(true);
    setPinError(validatePin(pin));
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.toUpperCase();
    setPin(next);
    setPinServerError(null);
    if (pinTouched) {
      setPinError(validatePin(next));
    }
  };

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinTouched(true);
    setPinServerError(null);

    const err = validatePin(pin);
    if (err) {
      setPinError(err);
      pinInputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const res = await verifyRoomPin(pin);
      if (!res.success) {
        setPinServerError(res.error || 'No se puede ingresar a esa sala. Revisa el PIN.');
        pinInputRef.current?.focus();
        return;
      }
      setPin(res.data?.pin || pin.trim().toUpperCase());
      setAccessMode(res.data?.accessMode ?? 'OPEN_PIN');
      goToStep(2);
    } catch {
      setPinServerError('No se puede ingresar a esa sala. Revisa el PIN.');
      pinInputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2 Handlers ──

  const handleNickBlur = () => {
    setNickTouched(true);
    setNickError(validateNickname(nickname));
  };

  const handleNickChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setNickname(next);
    setNickServerError(null);
    if (nickTouched) {
      setNickError(validateNickname(next));
    }
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNickTouched(true);
    setNickServerError(null);

    const err = validateNickname(nickname);
    if (err) {
      setNickError(err);
      nickInputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const res = await checkNicknameInRoom(pin, nickname);
      if (!res.success) {
        setNickServerError(res.error || 'No fue posible validar el nombre.');
        nickInputRef.current?.focus();
        return;
      }
      setIsReturningUser(Boolean(res.data?.exists));
      goToStep(3);
    } catch {
      setNickServerError('Error de comunicación con el servidor.');
      nickInputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3 Handlers ──

  const handlePin4Blur = () => {
    setPin4Touched(true);
    setPin4Error(validatePin4(pin4));
  };

  const handlePin4Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value.replace(/\D/g, '');
    setPin4(next);
    setPin4ServerError(null);
    if (pin4Touched) {
      setPin4Error(validatePin4(next));
    }
  };

  const handleStep3Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPin4Touched(true);
    setPin4ServerError(null);

    const err = validatePin4(pin4);
    if (err) {
      setPin4Error(err);
      pin4InputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const res = await joinRoom(pin.trim().toUpperCase(), nickname.trim(), pin4.trim(), getDeviceTag());
      if (res.success) {
        toast.success('Ingreso confirmado');
        router.push('/participant/vote');
      } else {
        const errorMsg = res.error || 'No fue posible ingresar a la sala.';
        setPin4ServerError(errorMsg);
        pin4InputRef.current?.focus();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error de comunicación con el servidor.';
      setPin4ServerError(msg);
      pin4InputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const isRoster = accessMode === 'ROSTER';
  const totalSteps = isRoster ? (hasFixedPin ? 1 : 2) : hasFixedPin ? 2 : 3;
  const currentStepNumber = hasFixedPin ? (step === 2 ? 1 : 2) : step;

  // Active errors per step
  const activePinError = pinServerError || (pinTouched ? pinError : null);
  const activeNickError = nickServerError || (nickTouched ? nickError : null);
  const activePin4Error = pin4ServerError || (pin4Touched ? pin4Error : null);

  // Button disabled logic with visible reason
  const isStep1Disabled = Boolean(loading || (pinTouched && pinError) || pin.length < 6);
  const step1Motive = (pinTouched && pinError)
    ? pinError
    : pin.length < 6
    ? 'El PIN debe tener 6 caracteres'
    : '';

  const isStep2Disabled = Boolean(loading || (nickTouched && nickError) || nickname.trim().length < 3);
  const step2Motive = (nickTouched && nickError)
    ? nickError
    : nickname.trim().length < 3
    ? 'Mínimo 3 caracteres'
    : '';

  const isStep3Disabled = Boolean(loading || (pin4Touched && pin4Error) || pin4.length !== 4);
  const step3Motive = (pin4Touched && pin4Error)
    ? pin4Error
    : pin4.length !== 4
    ? 'El PIN debe tener 4 dígitos'
    : '';

  return (
    <div className="w-full max-w-[420px] mx-auto">
      <div className="border border-[#D9D5CC] bg-[#F6F4EF] rounded-[6px] p-6 sm:p-8">
        {/* Cabecera del paso */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-[#5A554E] mb-2 font-mono">
            <span>
              Paso {currentStepNumber} de {totalSteps}
            </span>
            {pin && (
              <span className="border border-[#D9D5CC] px-2 py-0.5 rounded-[999px] text-[#14171A]">
                Sala {pin}
              </span>
            )}
          </div>

          {step === 1 && (
            <div>
              <h1 className="font-heading text-2xl font-bold text-[#14171A] leading-tight">
                Ingreso a la sala
              </h1>
              <p className="text-sm text-[#5A554E] mt-1">
                Escribe el PIN de 6 caracteres indicado por el anfitrión.
              </p>
            </div>
          )}

          {step === 2 && isRoster && (
            <div>
              <h1 className="font-heading text-2xl font-bold text-[#14171A] leading-tight">
                Código personal
              </h1>
              <p className="text-sm text-[#5A554E] mt-1">
                Escribe el código que te entregó el anfitrión. Con el mismo código vuelves a entrar después.
              </p>
            </div>
          )}

          {step === 2 && !isRoster && (
            <div>
              <h1 className="font-heading text-2xl font-bold text-[#14171A] leading-tight">
                ¿Cómo te llamas?
              </h1>
              <p className="text-sm text-[#5A554E] mt-1">
                Escribe tu nombre o alias para identificarte en el grupo.
              </p>
            </div>
          )}

          {step === 3 && (
            <div>
              <h1 className="font-heading text-2xl font-bold text-[#14171A] leading-tight">
                PIN personal
              </h1>
              <p className="text-sm text-[#5A554E] mt-1">
                {isReturningUser
                  ? 'Este nombre ya está registrado en la sala. Ingresa tu PIN personal para continuar.'
                  : 'Crea un PIN personal de 4 dígitos para volver a entrar en las siguientes rondas.'}
              </p>
            </div>
          )}
        </div>

        {/* PASO 1: PIN de sala */}
        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="room-pin-input"
                className="block text-xs font-medium text-[#14171A] mb-2"
              >
                PIN de sala
              </label>
              <input
                ref={pinInputRef}
                id="room-pin-input"
                type="text"
                maxLength={6}
                autoFocus
                autoComplete="off"
                placeholder="Ej. 834192"
                value={pin}
                onChange={handlePinChange}
                onBlur={handlePinBlur}
                aria-invalid={Boolean(activePinError)}
                aria-describedby={activePinError ? 'room-pin-error' : undefined}
                className={`h-[56px] w-full px-4 text-center font-mono text-2xl font-semibold tracking-widest uppercase bg-white border rounded-[6px] focus:outline-none transition-colors placeholder:text-[#5A554E]/50 ${
                  activePinError
                    ? 'border-[#B42318] focus:border-[#B42318]'
                    : 'border-[#D9D5CC] focus:border-[#E4572E]'
                }`}
              />
              {activePinError && (
                <p id="room-pin-error" role="alert" className="text-xs text-[#B42318] mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                  <span>{activePinError}</span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <button
                type="submit"
                disabled={isStep1Disabled}
                className="h-[56px] w-full bg-[#E4572E] hover:bg-[#E4572E]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base font-medium rounded-[6px] transition-colors"
              >
                {loading ? 'Verificando...' : 'Continuar'}
              </button>
              {isStep1Disabled && step1Motive && (
                <p className="text-xs text-[#5A554E] text-center">{step1Motive}</p>
              )}
            </div>
          </form>
        )}

        {/* PASO 2 (sala con lista): código personal */}
        {step === 2 && isRoster && (
          <RosterCodeStep
            roomPin={pin.trim().toUpperCase()}
            showBack={!hasFixedPin}
            onBack={() => goToStep(1)}
            onChangeRoom={handleChangeRoom}
          />
        )}

        {/* PASO 2: Nombre */}
        {step === 2 && !isRoster && accessMode !== null && (
          <form onSubmit={handleStep2Submit} className="space-y-4" noValidate>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="nickname-input"
                  className="block text-xs font-medium text-[#14171A]"
                >
                  Nombre o alias
                </label>
                <span
                  className={`font-mono text-xs ${
                    nickname.length >= 30
                      ? 'text-[#B7791F] font-bold'
                      : 'text-[#5A554E]'
                  }`}
                >
                  {nickname.length}/30
                </span>
              </div>
              <input
                ref={nickInputRef}
                id="nickname-input"
                type="text"
                maxLength={30}
                autoFocus
                autoComplete="name"
                placeholder="Ej. Carlos"
                value={nickname}
                onChange={handleNickChange}
                onBlur={handleNickBlur}
                aria-invalid={Boolean(activeNickError)}
                aria-describedby={activeNickError ? 'nickname-error' : undefined}
                className={`h-[56px] w-full px-4 font-sans text-lg bg-white border rounded-[6px] focus:outline-none transition-colors placeholder:text-[#5A554E]/50 ${
                  activeNickError
                    ? 'border-[#B42318] focus:border-[#B42318]'
                    : 'border-[#D9D5CC] focus:border-[#E4572E]'
                }`}
              />
              {activeNickError && (
                <p id="nickname-error" role="alert" className="text-xs text-[#B42318] mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                  <span>{activeNickError}</span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <button
                type="submit"
                disabled={isStep2Disabled}
                className="h-[56px] w-full bg-[#E4572E] hover:bg-[#E4572E]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base font-medium rounded-[6px] transition-colors"
              >
                {loading ? 'Verificando...' : 'Continuar'}
              </button>
              {isStep2Disabled && step2Motive && (
                <p className="text-xs text-[#5A554E] text-center">{step2Motive}</p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setNickServerError(null);
                  goToStep(1);
                }}
                className="min-h-[44px] px-2 text-xs text-[#5A554E] hover:text-[#14171A] flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5 stroke-[1.5]" />
                <span>Atrás</span>
              </button>

              <button
                type="button"
                onClick={handleChangeRoom}
                className="min-h-[44px] px-2 text-xs text-[#5A554E] hover:text-[#14171A] transition-colors"
              >
                Cambiar sala
              </button>
            </div>
          </form>
        )}

        {/* PASO 3: PIN personal de 4 dígitos */}
        {step === 3 && (
          <form onSubmit={handleStep3Submit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="pin4-input"
                className="block text-xs font-medium text-[#14171A] mb-2"
              >
                PIN personal (4 dígitos)
              </label>
              <PasswordInput
                ref={pin4InputRef}
                id="pin4-input"
                isPin
                autoFocus
                placeholder="••••"
                value={pin4}
                onChange={handlePin4Change}
                onBlur={handlePin4Blur}
                aria-invalid={Boolean(activePin4Error)}
                aria-describedby={activePin4Error ? 'pin4-error' : undefined}
                className={`h-[56px] text-2xl font-semibold pl-11 ${
                  activePin4Error
                    ? 'border-[#B42318] focus:border-[#B42318]'
                    : 'border-[#D9D5CC] focus:border-[#E4572E]'
                }`}
              />
              {activePin4Error && (
                <p id="pin4-error" role="alert" className="text-xs text-[#B42318] mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                  <span>{activePin4Error}</span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <button
                type="submit"
                disabled={isStep3Disabled}
                className="h-[56px] w-full bg-[#E4572E] hover:bg-[#E4572E]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base font-medium rounded-[6px] transition-colors"
              >
                {loading ? 'Ingresando...' : 'Ingresar'}
              </button>
              {isStep3Disabled && step3Motive && (
                <p className="text-xs text-[#5A554E] text-center">{step3Motive}</p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setPin4ServerError(null);
                  goToStep(2);
                }}
                className="min-h-[44px] px-2 text-xs text-[#5A554E] hover:text-[#14171A] flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5 stroke-[1.5]" />
                <span>Atrás</span>
              </button>

              <button
                type="button"
                onClick={handleChangeRoom}
                className="min-h-[44px] px-2 text-xs text-[#5A554E] hover:text-[#14171A] transition-colors"
              >
                Cambiar sala
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
