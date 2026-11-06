'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RoomPinSchema } from '@mic/backend/shared/validations';
import { verifyRoomPin } from '@/app/actions/participant';

export default function HomePage() {
  const router = useRouter();
  const pinInputRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const validatePin = (val: string): string | null => {
    const result = RoomPinSchema.safeParse(val);
    if (!result.success) {
      return result.error.errors[0]?.message || 'El PIN de la sala debe tener 6 caracteres alfanuméricos.';
    }
    return null;
  };

  const handleBlur = () => {
    setTouched(true);
    setError(validatePin(pin));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value.toUpperCase();
    setPin(nextVal);
    if (touched) {
      setError(validatePin(nextVal));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const err = validatePin(pin);
    if (err) {
      setError(err);
      pinInputRef.current?.focus();
      return;
    }
    const cleanPin = pin.trim().replace(/\s+/g, '').toUpperCase();
    // Check the room here, so a wrong PIN is reported on this page and not after leaving it
    setChecking(true);
    try {
      const res = await verifyRoomPin(cleanPin);
      if (!res.success) {
        setError(res.error || 'No se puede ingresar a esa sala. Revisa el PIN.');
        pinInputRef.current?.focus();
        return;
      }
      router.push(`/room/${cleanPin}`);
    } catch {
      setError('No se pudo comprobar el PIN. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setChecking(false);
    }
  };

  const isInvalid = touched && !!error;

  return (
    <main className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-20 space-y-16">
      {/* 1. Bloque principal: Título en Fraunces + frase descriptiva + dos accesos */}
      <section className="space-y-8">
        <div className="space-y-4">
          <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-[#14171A] tracking-tight leading-[1.15]">
            Consenso y priorización de opciones para grupos
          </h1>
          <p className="text-base sm:text-lg text-[#5A554E] leading-relaxed max-w-2xl">
            Permite a cualquier equipo, organización o asamblea ordenar propuestas, revisar argumentos de forma anónima y medir el nivel de acuerdo en rondas sucesivas.
          </p>
        </div>

        {/* Dos accesos claros */}
        <div className="space-y-4 pt-2">
          {/* Acceso 1: Ingresar PIN de sala (acción principal para participantes) */}
          <form onSubmit={handleSubmit} className="space-y-2 max-w-md" noValidate>
            <label
              htmlFor="landing-pin"
              className="block text-xs font-semibold text-[#14171A] uppercase tracking-wider"
            >
              Ingresar a una sala
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                ref={pinInputRef}
                id="landing-pin"
                type="text"
                maxLength={6}
                value={pin}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={isInvalid}
                aria-describedby={isInvalid ? 'landing-pin-error' : undefined}
                placeholder="PIN de 6 caracteres"
                className={`w-full sm:flex-1 h-14 min-h-[56px] px-4 rounded-[6px] border bg-white font-mono text-base font-bold tracking-widest text-[#14171A] placeholder:text-[#5A554E]/50 placeholder:font-normal placeholder:tracking-normal focus:outline-none uppercase shrink-0 transition-colors ${
                  isInvalid
                    ? 'border-[#B42318] focus:border-[#B42318]'
                    : 'border-[#D9D5CC] focus:border-[#E4572E]'
                }`}
              />
              <button
                type="submit"
                disabled={isInvalid || checking}
                className="w-full sm:w-auto h-14 min-h-[56px] px-6 rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shrink-0 flex items-center justify-center"
              >
                {checking ? 'Comprobando...' : 'Ingresar a la sala'}
              </button>
            </div>
            {isInvalid && (
              <p id="landing-pin-error" role="alert" className="text-xs text-[#B42318] pt-1">
                {error}
              </p>
            )}
          </form>

          {/* Acceso 2: Enlace crear sala (anfitrión) */}
          <div className="pt-2 text-xs text-[#5A554E]">
            ¿Organizas la actividad?{' '}
            <Link
              href="/auth/login"
              className="text-[#14171A] font-semibold underline underline-offset-2 hover:text-[#E4572E]"
            >
              Crear una sala
            </Link>
          </div>
        </div>
      </section>

      {/* 2. Sección "Cómo funciona" en 3 pasos numerados en texto (sin íconos ni tarjetas) */}
      <section className="pt-10 border-t border-[#D9D5CC] space-y-8">
        <h2 className="font-heading text-xl sm:text-2xl font-bold text-[#14171A] tracking-tight">
          Cómo funciona
        </h2>

        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <span className="font-mono text-base font-bold text-[#5A554E] shrink-0 pt-0.5">
              01
            </span>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[#14171A]">
                Crear opciones
              </h3>
              <p className="text-xs text-[#5A554E] leading-relaxed">
                El anfitrión define las opciones que el grupo evaluará y fija el acuerdo requerido para dar por concluido el proceso.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <span className="font-mono text-base font-bold text-[#5A554E] shrink-0 pt-0.5">
              02
            </span>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[#14171A]">
                El grupo ordena y argumenta
              </h3>
              <p className="text-xs text-[#5A554E] leading-relaxed">
                Cada participante ingresa con el PIN de la sala, ordena las opciones según su preferencia y escribe una razón breve de su postura.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <span className="font-mono text-base font-bold text-[#5A554E] shrink-0 pt-0.5">
              03
            </span>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[#14171A]">
                Se calcula el acuerdo en rondas
              </h3>
              <p className="text-xs text-[#5A554E] leading-relaxed">
                El sistema calcula el consenso del grupo y el nivel de acuerdo. Si no se alcanza la meta, se abren nuevas rondas con los argumentos a la vista para deliberar.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
