'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createRoom, CreateRoomInput } from '@/app/actions/room';
import {
  CreateRoomSchema,
  OptionItemSchema,
  RoomSettingsSchema,
  sanitizeText,
  collapseWhitespace,
} from '@/lib/validations';
import { Plus, Trash2, ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react';
import RoomAdvancedSettings, { DEFAULT_ROOM_SETTINGS, type RoomSettingsValue } from '@/components/RoomAdvancedSettings';
import { AggregationMethod } from '@prisma/client';

export default function NewRoomPage() {
  const router = useRouter();

  // Field states
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const [method, setMethod] = useState<AggregationMethod>('BORDA');
  const [methodTouched, setMethodTouched] = useState(false);
  const [methodError, setMethodError] = useState<string | null>(null);

  const [maxMembers, setMaxMembers] = useState<number | ''>(20);
  const [maxMembersTouched, setMaxMembersTouched] = useState(false);
  const [maxMembersError, setMaxMembersError] = useState<string | null>(null);

  const [tauThreshold, setTauThreshold] = useState<number | ''>(80);
  const [tauTouched, setTauTouched] = useState(false);
  const [tauError, setTauError] = useState<string | null>(null);

  const [maxRounds, setMaxRounds] = useState<number | ''>(3);
  const [maxRoundsTouched, setMaxRoundsTouched] = useState(false);
  const [maxRoundsError, setMaxRoundsError] = useState<string | null>(null);

  const [options, setOptions] = useState<Array<{ title: string; description: string }>>([
    { title: '', description: '' },
    { title: '', description: '' },
    { title: '', description: '' },
  ]);

  const [optionsTouched, setOptionsTouched] = useState<
    Array<{ title: boolean; description: boolean }>
  >([
    { title: false, description: false },
    { title: false, description: false },
    { title: false, description: false },
  ]);

  const [optionsErrors, setOptionsErrors] = useState<
    Array<{ title: string | null; description: string | null }>
  >([
    { title: null, description: null },
    { title: null, description: null },
    { title: null, description: null },
  ]);

  const [optionsGeneralError, setOptionsGeneralError] = useState<string | null>(null);
  const [settings, setSettings] = useState<RoomSettingsValue>(DEFAULT_ROOM_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Focus refs
  const titleInputRef = useRef<HTMLInputElement>(null);
  const maxMembersInputRef = useRef<HTMLInputElement>(null);
  const tauInputRef = useRef<HTMLInputElement>(null);
  const maxRoundsInputRef = useRef<HTMLInputElement>(null);
  const optionTitleRefs = useRef<Array<HTMLInputElement | null>>([]);
  const optionDescRefs = useRef<Array<HTMLTextAreaElement | null>>([]);

  // ── Validation Helpers using CreateRoomSchema shapes ──

  const validateTitle = (val: string): string | null => {
    const res = CreateRoomSchema.shape.title.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'El título de la actividad es obligatorio.';
    }
    return null;
  };

  const validateMethod = (val: AggregationMethod): string | null => {
    const res = CreateRoomSchema.shape.method.safeParse(val);
    if (!res.success) {
      return 'Selecciona una regla de decisión colectiva.';
    }
    return null;
  };

  const validateMaxMembers = (val: number | ''): string | null => {
    if (val === '' || val === null || val === undefined) {
      return 'Campo obligatorio.';
    }
    const res = CreateRoomSchema.shape.maxMembers.safeParse(Number(val));
    if (!res.success) {
      return res.error.errors[0]?.message || 'Campo obligatorio.';
    }
    return null;
  };

  const validateTau = (val: number | ''): string | null => {
    if (val === '' || val === null || val === undefined) {
      return 'Campo obligatorio.';
    }
    const num = Number(val);
    if (num < 1 || num > 100) {
      return 'El acuerdo debe estar entre 1% y 100%.';
    }
    return null;
  };

  const validateMaxRounds = (val: number | ''): string | null => {
    if (val === '' || val === null || val === undefined) {
      return 'Campo obligatorio.';
    }
    const res = CreateRoomSchema.shape.maxRounds.safeParse(Number(val));
    if (!res.success) {
      return res.error.errors[0]?.message || 'Campo obligatorio.';
    }
    return null;
  };

  const validateOptionItem = (
    opt: { title: string; description: string },
    index: number,
    allOpts: Array<{ title: string; description: string }>
  ): { title: string | null; description: string | null } => {
    let tErr: string | null = null;
    let dErr: string | null = null;

    // Title validation
    const tRes = OptionItemSchema.shape.title.safeParse(opt.title);
    if (!tRes.success) {
      tErr = tRes.error.errors[0]?.message || 'El título de la opción es obligatorio.';
    } else {
      // Duplicate check (case-insensitive)
      const cleanCurrent = collapseWhitespace(sanitizeText(opt.title)).toLowerCase();
      const hasDuplicate = allOpts.some(
        (o, i) =>
          i !== index &&
          collapseWhitespace(sanitizeText(o.title)).toLowerCase() === cleanCurrent &&
          cleanCurrent.length > 0
      );
      if (hasDuplicate) {
        tErr = 'No puede haber opciones con el mismo título.';
      }
    }

    // Description validation
    if (opt.description && opt.description.trim().length > 0) {
      const dRes = OptionItemSchema.shape.description.safeParse(opt.description);
      if (!dRes.success) {
        dErr = dRes.error.errors[0]?.message || 'Descripción inválida.';
      }
    }

    return { title: tErr, description: dErr };
  };

  // Revalidate all options when titles change (to catch duplicate errors live)
  const revalidateAllOptions = (
    currentOpts: Array<{ title: string; description: string }>,
    currentTouched: Array<{ title: boolean; description: boolean }>
  ) => {
    const nextErrors = currentOpts.map((opt, i) => {
      const itemErr = validateOptionItem(opt, i, currentOpts);
      return {
        title: currentTouched[i]?.title ? itemErr.title : null,
        description: currentTouched[i]?.description ? itemErr.description : null,
      };
    });
    setOptionsErrors(nextErrors);
  };

  // ── Option list management ──

  const addOption = () => {
    if (options.length >= 8) return;
    const nextOpts = [...options, { title: '', description: '' }];
    const nextTouched = [...optionsTouched, { title: false, description: false }];
    const nextErrors = [...optionsErrors, { title: null, description: null }];
    setOptions(nextOpts);
    setOptionsTouched(nextTouched);
    setOptionsErrors(nextErrors);
    setOptionsGeneralError(null);
  };

  const removeOption = (index: number) => {
    if (options.length <= 3) return;
    const nextOpts = options.filter((_, i) => i !== index);
    const nextTouched = optionsTouched.filter((_, i) => i !== index);
    setOptions(nextOpts);
    setOptionsTouched(nextTouched);
    revalidateAllOptions(nextOpts, nextTouched);
  };

  const updateOption = (index: number, field: 'title' | 'description', val: string) => {
    const nextOpts = [...options];
    nextOpts[index] = { ...nextOpts[index], [field]: val };
    setOptions(nextOpts);
    setServerError(null);

    // Revalidate live
    revalidateAllOptions(nextOpts, optionsTouched);
  };

  const handleOptionBlur = (index: number, field: 'title' | 'description') => {
    const nextTouched = [...optionsTouched];
    nextTouched[index] = { ...nextTouched[index], [field]: true };
    setOptionsTouched(nextTouched);
    revalidateAllOptions(options, nextTouched);
  };

  // ── Submit handler ──

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    // Mark all touched
    setTitleTouched(true);
    setMethodTouched(true);
    setMaxMembersTouched(true);
    setTauTouched(true);
    setMaxRoundsTouched(true);

    const allTouchedOpts = options.map(() => ({ title: true, description: true }));
    setOptionsTouched(allTouchedOpts);

    // Validate each
    const tErr = validateTitle(title);
    setTitleError(tErr);

    const mErr = validateMethod(method);
    setMethodError(mErr);

    const mmErr = validateMaxMembers(maxMembers);
    setMaxMembersError(mmErr);

    const tauErr = validateTau(tauThreshold);
    setTauError(tauErr);

    const mrErr = validateMaxRounds(maxRounds);
    setMaxRoundsError(mrErr);

    const nextOptionErrors = options.map((opt, i) => validateOptionItem(opt, i, options));
    setOptionsErrors(nextOptionErrors);

    // Move focus to first invalid element
    if (tErr) {
      titleInputRef.current?.focus();
      return;
    }

    for (let i = 0; i < nextOptionErrors.length; i++) {
      if (nextOptionErrors[i].title) {
        optionTitleRefs.current[i]?.focus();
        return;
      }
      if (nextOptionErrors[i].description) {
        optionDescRefs.current[i]?.focus();
        return;
      }
    }

    if (mmErr) {
      maxMembersInputRef.current?.focus();
      return;
    }
    if (tauErr) {
      tauInputRef.current?.focus();
      return;
    }
    if (mrErr) {
      maxRoundsInputRef.current?.focus();
      return;
    }

    const settingsCheck = RoomSettingsSchema.safeParse(settings);
    if (!settingsCheck.success) {
      setServerError(settingsCheck.error.errors[0]?.message || 'Revisa las opciones avanzadas.');
      return;
    }

    // General Zod validation check
    const zPayload = {
      title,
      method,
      maxMembers: Number(maxMembers),
      tauThreshold: Number(tauThreshold),
      maxRounds: Number(maxRounds),
      options,
    };

    const finalVal = CreateRoomSchema.safeParse(zPayload);
    if (!finalVal.success) {
      setServerError(finalVal.error.errors[0]?.message || 'Corrige los errores del formulario.');
      return;
    }

    setLoading(true);
    try {
      const input: CreateRoomInput = {
        title: finalVal.data.title,
        method: finalVal.data.method,
        maxMembers: finalVal.data.maxMembers,
        tauThreshold: Number(tauThreshold),
        maxRounds: finalVal.data.maxRounds,
        options: finalVal.data.options.map((o) => ({
          title: o.title,
          description: o.description || '',
        })),
        settings: settingsCheck.data,
      };

      const res = await createRoom(input);
      if (res.success) {
        if (res.data) {
          router.push(`/dashboard/rooms/${res.data.salaId}`);
        }
      } else {
        setServerError(res.error || 'No fue posible crear la sala.');
      }
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : 'Error de comunicación.');
    } finally {
      setLoading(false);
    }
  };

  // Count active errors for button feedback
  const activeTitleError = titleTouched ? titleError : null;
  const activeMaxMembersError = maxMembersTouched ? maxMembersError : null;
  const activeTauError = tauTouched ? tauError : null;
  const activeMaxRoundsError = maxRoundsTouched ? maxRoundsError : null;

  let totalActiveErrors = 0;
  if (activeTitleError) totalActiveErrors++;
  if (activeMaxMembersError) totalActiveErrors++;
  if (activeTauError) totalActiveErrors++;
  if (activeMaxRoundsError) totalActiveErrors++;
  const settingsValidation = RoomSettingsSchema.safeParse(settings);
  const settingsError = settingsValidation.success ? null : settingsValidation.error.errors[0]?.message ?? null;
  if (settingsError) totalActiveErrors++;
  for (const optErr of optionsErrors) {
    if (optErr.title) totalActiveErrors++;
    if (optErr.description) totalActiveErrors++;
  }

  const isSubmitDisabled = loading || totalActiveErrors > 0;
  const submitMotive =
    totalActiveErrors === 1
      ? 'Corrige 1 campo'
      : totalActiveErrors > 1
      ? `Corrige ${totalActiveErrors} campos`
      : '';

  return (
    <div className="w-full">
      {/* Migas de pan y Volver a salas (AUD-23) */}
      <nav aria-label="Migas de pan" className="mb-4 flex items-center gap-2 text-xs">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-[#5A554E] hover:text-[#14171A] hover:underline transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5 stroke-[1.5]" />
          <span>Volver a salas</span>
        </Link>
        <span className="text-[#D9D5CC]" aria-hidden="true">/</span>
        <span className="text-[#14171A] font-medium" aria-current="page">
          Nueva sala
        </span>
      </nav>

      {/* Page Header */}
      <div className="pb-6 mb-6 border-b border-[#D9D5CC]">
        <h1 className="font-heading text-2xl font-bold text-[#14171A] tracking-tight">
          Nueva sala de votación
        </h1>
        <p className="text-xs text-[#5A554E] mt-1">
          Configura las opciones que el grupo ordenará y los parámetros de consenso.
        </p>
      </div>

      {serverError && (
        <div
          role="alert"
          className="mb-6 p-3 rounded-[6px] border border-[#B42318] bg-[#B42318]/5 text-xs text-[#B42318] max-w-2xl flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 stroke-[1.5] shrink-0" />
          <span>{serverError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-8" noValidate>
        {/* Section 1: Identification */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[#14171A]">
              1. Identificación de la sala
            </h2>
            <p className="text-xs text-[#5A554E] mt-0.5">
              Título general visible para todos los participantes durante la votación.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="room-title"
                className="block text-xs font-medium text-[#14171A]"
              >
                Título de la actividad
              </label>
              <span
                className={`font-mono text-xs ${
                  title.length >= 100 ? 'text-[#B7791F] font-bold' : 'text-[#5A554E]'
                }`}
              >
                {title.length}/100
              </span>
            </div>
            <input
              ref={titleInputRef}
              id="room-title"
              type="text"
              maxLength={100}
              placeholder="Ej. Priorización de opciones anuales 2026"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setServerError(null);
                if (titleTouched) {
                  setTitleError(validateTitle(e.target.value));
                }
              }}
              onBlur={() => {
                setTitleTouched(true);
                setTitleError(validateTitle(title));
              }}
              aria-invalid={Boolean(activeTitleError)}
              aria-describedby={activeTitleError ? 'room-title-error' : undefined}
              className={`w-full h-10 px-3 rounded-[6px] border bg-white text-sm text-[#14171A] placeholder:text-[#5A554E]/60 focus:outline-none transition-colors ${
                activeTitleError
                  ? 'border-[#B42318] focus:border-[#B42318]'
                  : 'border-[#D9D5CC] focus:border-[#E4572E]'
              }`}
            />
            {activeTitleError && (
              <p
                id="room-title-error"
                role="alert"
                className="text-xs text-[#B42318] mt-1 flex items-center gap-1"
              >
                <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                <span>{activeTitleError}</span>
              </p>
            )}
          </div>
        </section>

        <hr className="border-[#D9D5CC]" />

        {/* Section 2: Options */}
        <section className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[#14171A]">
                2. Opciones a evaluar
              </h2>
              <p className="text-xs text-[#5A554E] mt-0.5">
                Mínimo 3 y máximo 8 opciones. Cada participante las ordenará de mayor a menor preferencia.
              </p>
            </div>
            <button
              type="button"
              onClick={addOption}
              disabled={options.length >= 8}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border border-[#D9D5CC] bg-white text-xs font-medium text-[#14171A] hover:bg-[#EBE7DF] disabled:opacity-30 disabled:pointer-events-none transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
              <span>Añadir opción ({options.length}/8)</span>
            </button>
          </div>

          {optionsGeneralError && (
            <p role="alert" className="text-xs text-[#B42318]">
              {optionsGeneralError}
            </p>
          )}

          <div className="space-y-3">
            {options.map((p, idx) => {
              const optErr = optionsErrors[idx];
              const titleErr = optErr?.title;
              const descErr = optErr?.description;

              return (
                <div
                  key={idx}
                  className="p-3.5 rounded-[6px] border border-[#D9D5CC] bg-white flex items-start gap-3"
                >
                  <span className="w-7 h-7 shrink-0 rounded-[4px] border border-[#D9D5CC] bg-[#F6F4EF] font-mono text-xs font-bold text-[#14171A] flex items-center justify-center mt-1">
                    {idx + 1}
                  </span>

                  <div className="flex-1 space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label
                          htmlFor={`opt-title-${idx}`}
                          className="text-[11px] font-medium text-[#14171A]"
                        >
                          Título de la opción (3 a 80 caracteres)
                        </label>
                        <span
                          className={`font-mono text-[11px] ${
                            p.title.length >= 80 ? 'text-[#B7791F] font-bold' : 'text-[#5A554E]'
                          }`}
                        >
                          {p.title.length}/80
                        </span>
                      </div>
                      <input
                        ref={(el) => {
                          optionTitleRefs.current[idx] = el;
                        }}
                        id={`opt-title-${idx}`}
                        type="text"
                        maxLength={80}
                        placeholder={`Título de la opción ${idx + 1}`}
                        value={p.title}
                        onChange={(e) => updateOption(idx, 'title', e.target.value)}
                        onBlur={() => handleOptionBlur(idx, 'title')}
                        aria-invalid={Boolean(titleErr)}
                        aria-describedby={titleErr ? `opt-title-err-${idx}` : undefined}
                        className={`w-full h-9 px-3 rounded-[6px] border bg-white text-xs font-semibold text-[#14171A] placeholder:text-[#5A554E]/60 focus:outline-none transition-colors ${
                          titleErr
                            ? 'border-[#B42318] focus:border-[#B42318]'
                            : 'border-[#D9D5CC] focus:border-[#E4572E]'
                        }`}
                      />
                      {titleErr && (
                        <p
                          id={`opt-title-err-${idx}`}
                          role="alert"
                          className="text-xs text-[#B42318] mt-1 flex items-center gap-1"
                        >
                          <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                          <span>{titleErr}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label
                          htmlFor={`opt-desc-${idx}`}
                          className="text-[11px] font-medium text-[#14171A]"
                        >
                          Descripción (opcional, 10 a 300 caracteres)
                        </label>
                        <span
                          className={`font-mono text-[11px] ${
                            p.description.length >= 300
                              ? 'text-[#B7791F] font-bold'
                              : 'text-[#5A554E]'
                          }`}
                        >
                          {p.description.length}/300
                        </span>
                      </div>
                      <textarea
                        ref={(el) => {
                          optionDescRefs.current[idx] = el;
                        }}
                        id={`opt-desc-${idx}`}
                        rows={2}
                        maxLength={300}
                        placeholder="Descripción o alcance de esta opción..."
                        value={p.description}
                        onChange={(e) => updateOption(idx, 'description', e.target.value)}
                        onBlur={() => handleOptionBlur(idx, 'description')}
                        aria-invalid={Boolean(descErr)}
                        aria-describedby={descErr ? `opt-desc-err-${idx}` : undefined}
                        className={`w-full p-2.5 rounded-[6px] border bg-white text-xs text-[#14171A] placeholder:text-[#5A554E]/60 focus:outline-none resize-y transition-colors ${
                          descErr
                            ? 'border-[#B42318] focus:border-[#B42318]'
                            : 'border-[#D9D5CC] focus:border-[#E4572E]'
                        }`}
                      />
                      {descErr && (
                        <p
                          id={`opt-desc-err-${idx}`}
                          role="alert"
                          className="text-xs text-[#B42318] mt-1 flex items-center gap-1"
                        >
                          <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                          <span>{descErr}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeOption(idx)}
                    disabled={options.length <= 3}
                    title="Eliminar opción"
                    className="p-1.5 rounded-[6px] text-[#5A554E] hover:text-[#B42318] hover:bg-[#B42318]/10 disabled:opacity-20 disabled:pointer-events-none transition-colors shrink-0"
                  >
                    <Trash2 className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <hr className="border-[#D9D5CC]" />

        {/* Section 3: Parameters */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[#14171A]">
              3. Parámetros de participación
            </h2>
            <p className="text-xs text-[#5A554E] mt-0.5">
              Límites de votantes y acuerdo necesario para dar por finalizada la actividad.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Número de participantes: input numérico entre 3 y 40 */}
            <div>
              <label
                htmlFor="max-members"
                className="block text-xs font-medium text-[#14171A] mb-1.5"
              >
                Número de participantes (3 a 40)
              </label>
              <input
                ref={maxMembersInputRef}
                id="max-members"
                type="number"
                min={3}
                max={40}
                value={maxMembers}
                onChange={(e) => {
                  const val = e.target.value === '' ? '' : parseInt(e.target.value, 10);
                  setMaxMembers(val);
                  setServerError(null);
                  if (maxMembersTouched) {
                    setMaxMembersError(validateMaxMembers(val));
                  }
                }}
                onBlur={() => {
                  setMaxMembersTouched(true);
                  setMaxMembersError(validateMaxMembers(maxMembers));
                }}
                aria-invalid={Boolean(activeMaxMembersError)}
                aria-describedby={activeMaxMembersError ? 'max-members-error' : undefined}
                className={`w-full h-10 px-3 rounded-[6px] border bg-white text-sm font-mono text-[#14171A] focus:outline-none transition-colors ${
                  activeMaxMembersError
                    ? 'border-[#B42318] focus:border-[#B42318]'
                    : 'border-[#D9D5CC] focus:border-[#E4572E]'
                }`}
              />
              {activeMaxMembersError ? (
                <p
                  id="max-members-error"
                  role="alert"
                  className="text-xs text-[#B42318] mt-1 flex items-center gap-1"
                >
                  <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                  <span>{activeMaxMembersError}</span>
                </p>
              ) : (
                <p className="text-[11px] text-[#5A554E] mt-1">
                  Con 3 participantes, todos deben votar.
                </p>
              )}
            </div>

            {/* Tau agreement: numeric input can be empty + slider reflects without forcing */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="agreement-req-num"
                  className="block text-xs font-medium text-[#14171A]"
                >
                  Acuerdo requerido (1% a 100%)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={tauInputRef}
                  id="agreement-req-num"
                  type="number"
                  min={1}
                  max={100}
                  placeholder="Ej. 80"
                  value={tauThreshold}
                  onChange={(e) => {
                    const val = e.target.value === '' ? '' : parseInt(e.target.value, 10);
                    setTauThreshold(val);
                    setServerError(null);
                    if (tauTouched) {
                      setTauError(validateTau(val));
                    }
                  }}
                  onBlur={() => {
                    setTauTouched(true);
                    setTauError(validateTau(tauThreshold));
                  }}
                  aria-invalid={Boolean(activeTauError)}
                  aria-describedby={activeTauError ? 'agreement-req-error' : undefined}
                  className={`w-28 h-10 px-3 rounded-[6px] border bg-white text-sm font-mono text-[#14171A] focus:outline-none transition-colors ${
                    activeTauError
                      ? 'border-[#B42318] focus:border-[#B42318]'
                      : 'border-[#D9D5CC] focus:border-[#E4572E]'
                  }`}
                />
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={tauThreshold === '' ? 50 : tauThreshold}
                  onChange={(e) => {
                    const nextVal = parseInt(e.target.value, 10);
                    setTauThreshold(nextVal);
                    setServerError(null);
                    if (tauTouched) {
                      setTauError(validateTau(nextVal));
                    }
                  }}
                  className="flex-1 accent-[#E4572E]"
                />
              </div>
              {activeTauError ? (
                <p
                  id="agreement-req-error"
                  role="alert"
                  className="text-xs text-[#B42318] mt-1 flex items-center gap-1"
                >
                  <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                  <span>{activeTauError}</span>
                </p>
              ) : (
                <p className="text-[11px] text-[#5A554E] mt-1">
                  Meta de concordancia ordinal en porcentaje.
                </p>
              )}
            </div>

            {/* Max Rounds */}
            <div>
              <label
                htmlFor="max-rounds"
                className="block text-xs font-medium text-[#14171A] mb-1.5"
              >
                Máximo de rondas (1 a 10)
              </label>
              <input
                ref={maxRoundsInputRef}
                id="max-rounds"
                type="number"
                min={1}
                max={10}
                value={maxRounds}
                onChange={(e) => {
                  const val = e.target.value === '' ? '' : parseInt(e.target.value, 10);
                  setMaxRounds(val);
                  setServerError(null);
                  if (maxRoundsTouched) {
                    setMaxRoundsError(validateMaxRounds(val));
                  }
                }}
                onBlur={() => {
                  setMaxRoundsTouched(true);
                  setMaxRoundsError(validateMaxRounds(maxRounds));
                }}
                aria-invalid={Boolean(activeMaxRoundsError)}
                aria-describedby={activeMaxRoundsError ? 'max-rounds-error' : undefined}
                className={`w-full h-10 px-3 rounded-[6px] border bg-white text-sm font-mono text-[#14171A] focus:outline-none transition-colors ${
                  activeMaxRoundsError
                    ? 'border-[#B42318] focus:border-[#B42318]'
                    : 'border-[#D9D5CC] focus:border-[#E4572E]'
                }`}
              />
              {activeMaxRoundsError ? (
                <p
                  id="max-rounds-error"
                  role="alert"
                  className="text-xs text-[#B42318] mt-1 flex items-center gap-1"
                >
                  <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                  <span>{activeMaxRoundsError}</span>
                </p>
              ) : (
                <p className="text-[11px] text-[#5A554E] mt-1">
                  Límite máximo de deliberaciones antes del cierre automático.
                </p>
              )}
            </div>
          </div>
        </section>

        <hr className="border-[#D9D5CC]" />

        {/* Section 4: Aggregation Method */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[#14171A]">
              4. Regla de decisión colectiva
            </h2>
            <p className="text-xs text-[#5A554E] mt-0.5">
              Forma en que se combinan los votos individuales para obtener el orden del grupo.
            </p>
          </div>

          <div className="space-y-2">
            {[
              {
                id: 'BORDA',
                name: 'Borda',
                desc: 'Borda: suma puntos según la posición asignada por cada participante.',
              },
              {
                id: 'SCHULZE',
                name: 'Schulze',
                desc: 'Schulze: compara las opciones por pares buscando la opción más respaldada.',
              },
              {
                id: 'KEMENY_YOUNG',
                name: 'Kemeny-Young',
                desc: 'Kemeny-Young: busca el orden colectivo con menor número de discrepancias globales.',
              },
            ].map((m) => (
              <label
                key={m.id}
                className={`flex items-start gap-3 p-3 rounded-[6px] border cursor-pointer transition-colors ${
                  method === m.id
                    ? 'border-[#E4572E] bg-white'
                    : 'border-[#D9D5CC] bg-white hover:bg-[#F6F4EF]/50'
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  value={m.id}
                  checked={method === m.id}
                  onChange={() => {
                    setMethod(m.id as AggregationMethod);
                    setServerError(null);
                  }}
                  className="mt-1 accent-[#E4572E]"
                />
                <div className="text-xs">
                  <div className="font-medium text-[#14171A]">{m.name}</div>
                  <div className="text-[#5A554E] mt-0.5">{m.desc}</div>
                </div>
              </label>
            ))}
          </div>
          {methodError && (
            <p role="alert" className="text-xs text-[#B42318] mt-1">
              {methodError}
            </p>
          )}
        </section>

        <RoomAdvancedSettings value={settings} onChange={setSettings} error={settingsError} />

        {/* Submit button with visible motive if disabled */}
        <div className="pt-2 space-y-2">
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-[6px] bg-[#E4572E] text-white text-xs font-semibold hover:bg-[#E4572E]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-none"
          >
            <span>{loading ? 'Creando sala...' : 'Crear sala de votación'}</span>
            <ArrowRight className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
          {isSubmitDisabled && submitMotive && (
            <p className="text-xs text-[#5A554E]">{submitMotive}</p>
          )}
        </div>
      </form>
    </div>
  );
}
