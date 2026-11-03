'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getParticipantRoomView, submitVote, logoutParticipant, VoteEntry } from '@/app/actions/participant';
import { SingleVoteEntrySchema, getUnicodeLength, sanitizeText } from '@/lib/validations';
import { toast } from 'sonner';
import { ParticipantVoteSkeleton } from '@/components/ui/Skeleton';
import { GripVertical, ArrowUp, ArrowDown, Clock, LogOut, AlertCircle, Edit3, CheckCircle2 } from 'lucide-react';

interface OptionItem {
  id: string;
  titulo?: string;
  title?: string;
  descripcion?: string;
  description?: string;
  orden_idx?: number;
  order_index?: number;
}

interface ParticipantSessionInfo {
  participantId: string;
  roomId?: string;
  salaId?: string;
  nickname: string;
  blindCode: string;
}

interface ParticipantRoomData {
  sala: {
    id: string;
    titulo: string;
    estado: string;
    rondaActual: number;
    maxRondas: number;
    deadline: string | null;
    metodo: string;
  };
  proyectos: OptionItem[];
  session: ParticipantSessionInfo;
  myVotes: Array<{
    id: string;
    proyecto_id?: string;
    option_id?: string;
    posicion?: number;
    position?: number;
    justificacion?: string;
    justification?: string;
  }>;
  latestReport: unknown;
  isExpired: boolean;
  serverTime?: string;
}

export default function ParticipantVotePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [roomData, setRoomData] = useState<ParticipantRoomData | null>(null);
  const [orderedOptions, setOrderedOptions] = useState<OptionItem[]>([]);
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [isExpiredLocally, setIsExpiredLocally] = useState<boolean>(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const isEditingRef = useRef<boolean>(false);
  const initialLoadDoneRef = useRef<boolean>(false);
  const currentRoundRef = useRef<number | null>(null);

  const serverOffsetRef = useRef<number>(0);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Mobile touch references
  const touchStartY = useRef<number>(0);
  const touchCurrentIndex = useRef<number | null>(null);

  const validateOptionReason = (optionId: string, text: string): string | null => {
    const res = SingleVoteEntrySchema.safeParse({
      optionId,
      position: 1,
      justification: text,
    });
    if (!res.success) {
      return res.error.errors[0]?.message || 'Mínimo 25 caracteres.';
    }
    return null;
  };

  const loadData = useCallback(async () => {
    try {
      const res = await getParticipantRoomView();
      if (!res.success || !res.data) {
        toast.error('No se puede ingresar a esa sala. Revisa tus datos.');
        router.push('/join');
        return;
      }

      const data = res.data as unknown as ParticipantRoomData;
      setRoomData(data);

      if (data.serverTime) {
        serverOffsetRef.current = new Date(data.serverTime).getTime() - Date.now();
      }

      if (data.sala.estado === 'ROUND_FEEDBACK' || data.sala.estado === 'CONCLUDED') {
        router.push('/participant/feedback');
        return;
      }

      const options = data.proyectos || [];
      const myVotes = data.myVotes || [];
      const hasVoted = Boolean(myVotes && myVotes.length === options.length);
      const currentRound = data.sala?.rondaActual ?? 1;

      if (currentRoundRef.current !== currentRound) {
        currentRoundRef.current = currentRound;
        initialLoadDoneRef.current = false;
        setIsEditing(false);
        isEditingRef.current = false;
      }

      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;
        if (hasVoted) {
          const sorted = [...options].sort((a, b) => {
            const vA = myVotes.find((v) => (v.option_id || v.proyecto_id) === a.id);
            const posA = vA?.position ?? vA?.posicion ?? 0;
            const vB = myVotes.find((v) => (v.option_id || v.proyecto_id) === b.id);
            const posB = vB?.position ?? vB?.posicion ?? 0;
            return posA - posB;
          });
          setOrderedOptions(sorted);

          const justMap: Record<string, string> = {};
          for (const v of myVotes) {
            const optId = (v.option_id || v.proyecto_id)!;
            justMap[optId] = v.justification || v.justificacion || '';
          }
          setJustifications(justMap);
        } else {
          setOrderedOptions(
            [...options].sort((a, b) => {
              const idxA = a.order_index ?? a.orden_idx ?? 0;
              const idxB = b.order_index ?? b.orden_idx ?? 0;
              return idxA - idxB;
            })
          );
        }
      } else {
        // Subsequent polling calls: only sync ordered options and justifications
        // if user has already voted AND is not actively editing their ballot
        if (hasVoted && !isEditingRef.current) {
          const sorted = [...options].sort((a, b) => {
            const vA = myVotes.find((v) => (v.option_id || v.proyecto_id) === a.id);
            const posA = vA?.position ?? vA?.posicion ?? 0;
            const vB = myVotes.find((v) => (v.option_id || v.proyecto_id) === b.id);
            const posB = vB?.position ?? vB?.posicion ?? 0;
            return posA - posB;
          });
          setOrderedOptions(sorted);

          const justMap: Record<string, string> = {};
          for (const v of myVotes) {
            const optId = (v.option_id || v.proyecto_id)!;
            justMap[optId] = v.justification || v.justificacion || '';
          }
          setJustifications(justMap);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cargar los datos.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadData();
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle visibility and network re-connection
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData();
      }
    };
    const handleOnline = () => {
      loadData();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [loadData]);

  // Server-time-based countdown timer
  useEffect(() => {
    if (!roomData?.sala?.deadline || roomData?.sala?.estado !== 'ROUND_OPEN') {
      setTimeLeft('');
      setIsExpiredLocally(false);
      return;
    }

    const deadlineMs = new Date(roomData.sala.deadline).getTime();

    const updateTimer = () => {
      const serverNow = Date.now() + serverOffsetRef.current;
      const diff = deadlineMs - serverNow;

      if (diff <= 0) {
        setTimeLeft('Votación cerrada');
        setIsExpiredLocally(true);
        return;
      }

      setIsExpiredLocally(false);
      const totalSecs = Math.floor(diff / 1000);
      const hours = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      const secs = totalSecs % 60;

      if (hours > 0) {
        setTimeLeft(`${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
      } else {
        setTimeLeft(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
      }
    };

    updateTimer();
    const tInterval = setInterval(updateTimer, 1000);
    return () => clearInterval(tInterval);
  }, [roomData?.sala?.deadline, roomData?.sala?.estado]);

  // Reordering helpers
  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...orderedOptions];
    const temp = next[index - 1];
    next[index - 1] = next[index];
    next[index] = temp;
    setOrderedOptions(next);
  };

  const moveDown = (index: number) => {
    if (index === orderedOptions.length - 1) return;
    const next = [...orderedOptions];
    const temp = next[index + 1];
    next[index + 1] = next[index];
    next[index] = temp;
    setOrderedOptions(next);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const next = [...orderedOptions];
    const draggedItem = next[draggedIndex];
    next.splice(draggedIndex, 1);
    next.splice(index, 0, draggedItem);
    setDraggedIndex(index);
    setOrderedOptions(next);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleTouchStart = (index: number, e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchCurrentIndex.current = index;
    setDraggedIndex(index);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchCurrentIndex.current === null) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartY.current;
    const threshold = 60;

    if (diff > threshold && touchCurrentIndex.current < orderedOptions.length - 1) {
      moveDown(touchCurrentIndex.current);
      touchCurrentIndex.current += 1;
      touchStartY.current = currentY;
      setDraggedIndex(touchCurrentIndex.current);
    } else if (diff < -threshold && touchCurrentIndex.current > 0) {
      moveUp(touchCurrentIndex.current);
      touchCurrentIndex.current -= 1;
      touchStartY.current = currentY;
      setDraggedIndex(touchCurrentIndex.current);
    }
  };

  const handleTouchEnd = () => {
    touchCurrentIndex.current = null;
    setDraggedIndex(null);
  };

  // Field validation events
  const handleJustificationBlur = (optionId: string) => {
    setTouchedFields((prev) => ({ ...prev, [optionId]: true }));
    const err = validateOptionReason(optionId, justifications[optionId] || '');
    setFieldErrors((prev) => ({ ...prev, [optionId]: err }));
  };

  const handleJustificationChange = (optionId: string, text: string) => {
    setJustifications((prev) => ({ ...prev, [optionId]: text }));
    if (touchedFields[optionId]) {
      const err = validateOptionReason(optionId, text);
      setFieldErrors((prev) => ({ ...prev, [optionId]: err }));
    }
  };

  const handleSubmit = async () => {
    const nextTouched: Record<string, boolean> = {};
    const nextErrors: Record<string, string | null> = {};
    let firstInvalidOptId: string | null = null;

    for (let i = 0; i < orderedOptions.length; i++) {
      const opt = orderedOptions[i];
      nextTouched[opt.id] = true;
      const text = justifications[opt.id] || '';
      const err = validateOptionReason(opt.id, text);
      nextErrors[opt.id] = err;
      if (err && !firstInvalidOptId) {
        firstInvalidOptId = opt.id;
      }
    }

    setTouchedFields(nextTouched);
    setFieldErrors(nextErrors);

    if (firstInvalidOptId) {
      textareaRefs.current[firstInvalidOptId]?.focus();
      return;
    }

    const payload: VoteEntry[] = orderedOptions.map((opt, index) => ({
      optionId: opt.id,
      position: index + 1,
      justification: sanitizeText(justifications[opt.id] || ''),
    }));

    setSubmitting(true);
    try {
      const res = await submitVote(payload);
      if (res.success) {
        toast.success('Voto guardado.');
        setIsEditing(false);
        isEditingRef.current = false;
        await loadData();
      } else {
        toast.error(res.error || 'No fue posible guardar el voto.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al enviar el voto.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutParticipant();
      toast.success('Sesión finalizada.');
      router.push('/join');
    } catch {
      router.push('/join');
    }
  };

  if (loading) {
    return <ParticipantVoteSkeleton />;
  }

  const isClosed =
    roomData?.sala?.estado !== 'ROUND_OPEN' ||
    (roomData?.isExpired ?? false) ||
    isExpiredLocally;

  const deadlineDate = roomData?.sala?.deadline ? new Date(roomData.sala.deadline) : null;
  const deadlineHour = deadlineDate
    ? deadlineDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const hasVoted = Boolean(
    roomData?.myVotes &&
    roomData.myVotes.length === (roomData?.proyectos?.length || 0) &&
    roomData.myVotes.length > 0
  );

  const showReadOnlySummary = hasVoted && (!isEditing || isClosed);

  // Count invalid reasons
  const invalidReasonsCount = orderedOptions.filter((opt) => {
    const text = justifications[opt.id] || '';
    const err = validateOptionReason(opt.id, text);
    return Boolean(err);
  }).length;

  return (
    <main className="flex-1 max-w-[540px] w-full mx-auto px-4 pt-6 pb-28">
      {/* Top bar: Role & Logout */}
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#D9D5CC] text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[#5A554E]">
            {roomData?.session?.blindCode || 'Participante'}
          </span>
          <span className="text-[#D9D5CC]">·</span>
          <span className="text-[#5A554E]">Conectado como participante</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-1.5 text-[#5A554E] hover:text-[#B42318] transition-colors"
        >
          <LogOut className="w-3.5 h-3.5 stroke-[1.5]" />
          <span>Salir</span>
        </button>
      </div>

      {/* Header: Room title, round info, countdown */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-[#5A554E] font-mono mb-1.5">
          <span>
            Ronda {roomData?.sala?.rondaActual} de {roomData?.sala?.maxRondas}
          </span>
          {deadlineHour && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 stroke-[1.5]" />
              <span>Hora límite: {deadlineHour}</span>
            </span>
          )}
        </div>

        <h1 className="font-heading text-2xl font-bold text-[#14171A] leading-tight">
          {roomData?.sala?.titulo}
        </h1>

        {/* Visible countdown timer */}
        {timeLeft && (
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-xs text-[#5A554E]">Tiempo restante:</span>
            <span
              className={`font-mono text-xs font-bold px-2 py-0.5 rounded-[4px] border ${
                isClosed
                  ? 'bg-[#B42318]/10 text-[#B42318] border-[#B42318]/30'
                  : 'bg-[#2F7D4F]/10 text-[#2F7D4F] border-[#2F7D4F]/30'
              }`}
            >
              {timeLeft}
            </span>
          </div>
        )}

        {/* Status banner */}
        {isClosed ? (
          <div className="mt-3 p-3 rounded-[6px] border border-[#D9D5CC] bg-white text-xs text-[#14171A]">
            Votación cerrada. La hora límite fue a las {deadlineHour}. Esperando los resultados de la ronda.
          </div>
        ) : showReadOnlySummary ? (
          <div className="mt-3 p-3 rounded-[6px] border border-[#2F7D4F]/30 bg-[#2F7D4F]/5 text-xs text-[#2F7D4F] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 stroke-[1.5] shrink-0" />
            <span>Voto enviado. Puedes editarlo mientras la votación siga abierta.</span>
          </div>
        ) : (
          <p className="text-xs text-[#5A554E] mt-2 leading-relaxed">
            Ordena las opciones de mayor a menor preferencia arrastrando o con las flechas. Escribe la razón de cada una (mínimo 25 y máximo 200 caracteres).
          </p>
        )}
      </div>

      {/* READ-ONLY SUMMARY (AUD-06) */}
      {showReadOnlySummary ? (
        <div className="space-y-4">
          <div className="space-y-3">
            {orderedOptions.map((option, index) => {
              const rank = index + 1;
              const title = option.title || option.titulo;
              const description = option.description || option.descripcion;
              const reasonText = justifications[option.id] || '';

              return (
                <div
                  key={option.id}
                  className="rounded-[6px] border border-[#D9D5CC] bg-white p-4 space-y-2.5"
                >
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-xl font-bold text-[#14171A] w-7 shrink-0">
                      {rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-sans font-semibold text-sm text-[#14171A]">
                        {title}
                      </h2>
                      {description && (
                        <p className="text-xs text-[#5A554E] mt-0.5 leading-relaxed">
                          {description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#D9D5CC]/60">
                    <span className="text-[11px] font-medium text-[#5A554E] block mb-1">
                      Razón indicada:
                    </span>
                    <p className="text-xs text-[#14171A] leading-relaxed bg-[#F6F4EF] p-2.5 rounded-[4px] border border-[#D9D5CC]/80">
                      {reasonText}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Edit button when voting is open */}
          {!isClosed && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  isEditingRef.current = true;
                  setIsEditing(true);
                }}
                className="w-full min-h-[44px] rounded-[6px] border border-[#D9D5CC] bg-white hover:bg-[#EBE7DF] text-[#14171A] text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Edit3 className="w-4 h-4 stroke-[1.5]" />
                <span>Editar voto</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        /* EDITABLE FORM (AUD-06 / AUD-12) */
        <div className="space-y-4">
          {orderedOptions.map((option, index) => {
            const rank = index + 1;
            const text = justifications[option.id] || '';
            const trimmedLen = getUnicodeLength(sanitizeText(text));
            const isTouched = Boolean(touchedFields[option.id]);
            const errorMsg = isTouched ? fieldErrors[option.id] : null;
            const isDragging = draggedIndex === index;
            const title = option.title || option.titulo;
            const description = option.description || option.descripcion;

            return (
              <div
                key={option.id}
                draggable={!isClosed}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`rounded-[6px] border border-[#D9D5CC] bg-white p-4 transition-colors ${
                  isDragging ? 'border-[#E4572E] shadow-sm relative z-20' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Large rank number and drag handle */}
                  <div className="flex flex-col items-center shrink-0 w-[44px]">
                    <span className="font-mono text-2xl font-bold text-[#14171A] leading-none">
                      {rank}
                    </span>

                    {!isClosed && (
                      <div
                        className="mt-1 text-[#5A554E] cursor-grab active:cursor-grabbing touch-none min-w-[44px] min-h-[44px] flex items-center justify-center"
                        onTouchStart={(e) => handleTouchStart(index, e)}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        title="Arrastrar para ordenar"
                      >
                        <GripVertical className="w-5 h-5 stroke-[1.5]" />
                      </div>
                    )}

                    {!isClosed && (
                      <div className="flex flex-col gap-1 mt-1">
                        <button
                          type="button"
                          onClick={() => moveUp(index)}
                          disabled={index === 0}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#5A554E] hover:text-[#14171A] disabled:opacity-20 transition-colors"
                          title="Subir opción"
                        >
                          <ArrowUp className="w-4 h-4 stroke-[1.5]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveDown(index)}
                          disabled={index === orderedOptions.length - 1}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#5A554E] hover:text-[#14171A] disabled:opacity-20 transition-colors"
                          title="Bajar opción"
                        >
                          <ArrowDown className="w-4 h-4 stroke-[1.5]" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Option title, description, and reason textarea */}
                  <div className="flex-1 min-w-0">
                    <h2 className="font-sans font-semibold text-base text-[#14171A] leading-snug">
                      {title}
                    </h2>
                    {description && (
                      <p className="text-xs text-[#5A554E] mt-1 leading-relaxed">
                        {description}
                      </p>
                    )}

                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <label
                          htmlFor={`reason-${option.id}`}
                          className="text-[#14171A] font-medium"
                        >
                          Razón de la elección
                        </label>
                        <span
                          className={`font-mono text-xs font-medium ${
                            trimmedLen < 25
                              ? 'text-[#B7791F]'
                              : trimmedLen <= 200
                              ? 'text-[#2F7D4F]'
                              : 'text-[#B42318]'
                          }`}
                        >
                          {trimmedLen}/200
                        </span>
                      </div>

                      <textarea
                        ref={(el) => {
                          textareaRefs.current[option.id] = el;
                        }}
                        id={`reason-${option.id}`}
                        rows={2}
                        maxLength={200}
                        disabled={isClosed}
                        placeholder="Escribe la razón de este orden (mínimo 25 y máximo 200 caracteres)..."
                        value={text}
                        onChange={(e) => handleJustificationChange(option.id, e.target.value)}
                        onBlur={() => handleJustificationBlur(option.id)}
                        aria-invalid={Boolean(errorMsg)}
                        aria-describedby={errorMsg ? `reason-${option.id}-error` : undefined}
                        className={`w-full p-2.5 rounded-[6px] border bg-[#F6F4EF] text-sm text-[#14171A] placeholder:text-[#5A554E]/60 focus:outline-none transition-colors ${
                          errorMsg
                            ? 'border-[#B42318] focus:border-[#B42318]'
                            : trimmedLen >= 25 && trimmedLen <= 200
                            ? 'border-[#2F7D4F] focus:border-[#2F7D4F]'
                            : 'border-[#D9D5CC] focus:border-[#E4572E]'
                        }`}
                      />
                      {errorMsg && (
                        <p
                          id={`reason-${option.id}-error`}
                          role="alert"
                          className="text-xs text-[#B42318] mt-1 flex items-center gap-1"
                        >
                          <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                          <span>{errorMsg}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom action bar when in edit mode and voting is open */}
      {!isClosed && !showReadOnlySummary && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#F6F4EF] border-t border-[#D9D5CC] p-4 z-40">
          <div className="max-w-[540px] mx-auto w-full space-y-2">
            {hasVoted && (
              <button
                type="button"
                onClick={() => {
                  isEditingRef.current = false;
                  setIsEditing(false);
                  loadData();
                }}
                className="w-full text-xs text-[#5A554E] hover:text-[#14171A] text-center py-1 transition-colors"
              >
                Cancelar edición
              </button>
            )}

            {invalidReasonsCount > 0 ? (
              <div className="space-y-1">
                <button
                  type="button"
                  disabled
                  className="w-full h-[52px] rounded-[6px] bg-[#EBE7DF] border border-[#D9D5CC] text-[#5A554E] font-medium text-sm cursor-not-allowed flex items-center justify-center transition-colors"
                >
                  {hasVoted ? 'Guardar cambios' : 'Enviar voto'}
                </button>
                <p className="text-xs text-[#5A554E] text-center">
                  Falta escribir la razón de {invalidReasonsCount}{' '}
                  {invalidReasonsCount === 1 ? 'opción' : 'opciones'} (mínimo 25 caracteres)
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full h-[52px] rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 disabled:opacity-50 text-white font-medium text-base transition-colors flex items-center justify-center"
              >
                {submitting
                  ? 'Guardando voto...'
                  : hasVoted
                  ? 'Guardar cambios'
                  : 'Enviar voto'}
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
