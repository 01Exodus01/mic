'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getParticipantRoomView, submitVote, logoutParticipant, VoteEntry } from '@/app/actions/participant';
import ReasonListsField, {
  ReasonListsSummary,
  EMPTY_REASONS,
  cleanReasons,
  reasonError,
  type OptionReasons,
} from '@/components/ReasonListsField';
import RoundFeedbackReport, { OptionPreviousRound, type FeedbackReportData } from '@/components/RoundFeedbackReport';
import ConsentDialog from '@/components/ConsentDialog';
import { formatCountdown, formatDeadlineLabel } from '@/components/DurationPicker';
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
    title: string;
    status: string;
    currentRound: number;
    maxRounds: number;
    deadline: string | null;
    method: string;
    closeWhenAllVoted?: boolean;
  };
  options: OptionItem[];
  session: ParticipantSessionInfo;
  myVotes: Array<{
    id: string;
    proyecto_id?: string;
    option_id?: string;
    posicion?: number;
    position?: number;
    justificacion?: string;
    justification?: string;
    reasonsFor?: string[];
    reasonsAgainst?: string[];
  }>;
  latestReport: FeedbackReportData | null;
  consent?: { required: boolean; accepted: boolean; text: string | null };
  isExpired: boolean;
  serverTime?: string;
}

export default function ParticipantVotePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [roomData, setRoomData] = useState<ParticipantRoomData | null>(null);
  const [orderedOptions, setOrderedOptions] = useState<OptionItem[]>([]);
  const [reasonsByOption, setReasonsByOption] = useState<Record<string, OptionReasons>>({});
  // Single reason written before PT-13, kept so editing does not drop it
  const [legacyJustifications, setLegacyJustifications] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [isExpiredLocally, setIsExpiredLocally] = useState<boolean>(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const isEditingRef = useRef<boolean>(false);
  const initialLoadDoneRef = useRef<boolean>(false);
  const currentRoundRef = useRef<number | null>(null);

  const serverOffsetRef = useRef<number>(0);

  // Mobile touch references
  const touchStartY = useRef<number>(0);
  const touchCurrentIndex = useRef<number | null>(null);

  const syncReasonsFromVotes = (myVotes: ParticipantRoomData['myVotes']) => {
    const reasonMap: Record<string, OptionReasons> = {};
    const legacyMap: Record<string, string> = {};
    for (const v of myVotes) {
      const optId = (v.option_id || v.proyecto_id)!;
      reasonMap[optId] = { for: [...(v.reasonsFor ?? [])], against: [...(v.reasonsAgainst ?? [])] };
      const legacy = v.justification || v.justificacion || '';
      if (legacy) legacyMap[optId] = legacy;
    }
    setReasonsByOption(reasonMap);
    setLegacyJustifications(legacyMap);
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

      // PT-24: consent first, when the room asks for it
      if (data.consent?.required && !data.consent.accepted) {
        router.push('/participant/consent');
        return;
      }

      if (data.sala.status === 'ROUND_FEEDBACK' || data.sala.status === 'CONCLUDED') {
        router.push('/participant/feedback');
        return;
      }

      const options = data.options || [];
      const myVotes = data.myVotes || [];
      const hasVoted = Boolean(myVotes && myVotes.length === options.length);
      const currentRound = data.sala?.currentRound ?? 1;

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
          syncReasonsFromVotes(myVotes);
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
          syncReasonsFromVotes(myVotes);
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
    if (!roomData?.sala?.deadline || roomData?.sala?.status !== 'ROUND_OPEN') {
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
      setTimeLeft(formatCountdown(diff));
    };

    updateTimer();
    const tInterval = setInterval(updateTimer, 1000);
    return () => clearInterval(tInterval);
  }, [roomData?.sala?.deadline, roomData?.sala?.status]);

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

  const handleReasonsChange = (optionId: string, next: OptionReasons) => {
    setReasonsByOption((prev) => ({ ...prev, [optionId]: next }));
  };

  // Reasons are optional: the only possible problem is a reason over the limit
  const firstReasonErrorField = (): string | null => {
    for (const opt of orderedOptions) {
      const value = reasonsByOption[opt.id] ?? EMPTY_REASONS;
      for (const side of ['for', 'against'] as const) {
        const index = value[side].findIndex((t) => reasonError(t) !== null);
        if (index >= 0) return `reason-${opt.id}-${side}-${index}`;
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    const invalidField = firstReasonErrorField();
    if (invalidField) {
      document.getElementById(invalidField)?.focus();
      return;
    }

    const payload: VoteEntry[] = orderedOptions.map((opt, index) => {
      const value = reasonsByOption[opt.id] ?? EMPTY_REASONS;
      return {
        optionId: opt.id,
        position: index + 1,
        reasonsFor: cleanReasons(value.for),
        reasonsAgainst: cleanReasons(value.against),
        justification: legacyJustifications[opt.id] || undefined,
      };
    });

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
    roomData?.sala?.status !== 'ROUND_OPEN' ||
    (roomData?.isExpired ?? false) ||
    isExpiredLocally;

  const deadlineDate = roomData?.sala?.deadline ? new Date(roomData.sala.deadline) : null;
  const deadlineHour = deadlineDate ? formatDeadlineLabel(deadlineDate) : '';

  const hasVoted = Boolean(
    roomData?.myVotes &&
    roomData.myVotes.length === (roomData?.options?.length || 0) &&
    roomData.myVotes.length > 0
  );

  const showReadOnlySummary = hasVoted && (!isEditing || isClosed);

  // Reasons over the length limit (only possible if pasted around maxLength)
  const invalidReasonsCount = orderedOptions.filter((opt) => {
    const value = reasonsByOption[opt.id] ?? EMPTY_REASONS;
    return [...value.for, ...value.against].some((t) => reasonError(t) !== null);
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
        {roomData?.consent?.required && roomData.consent.text && <ConsentDialog text={roomData.consent.text} />}
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
            Ronda {roomData?.sala?.currentRound} de {roomData?.sala?.maxRounds}
          </span>
          {deadlineHour && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 stroke-[1.5]" />
              <span>Hora límite: {deadlineHour}</span>
            </span>
          )}
        </div>

        <h1 className="font-heading text-2xl font-bold text-[#14171A] leading-tight">
          {roomData?.sala?.title}
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
            Ordena las opciones de mayor a menor preferencia arrastrando o con las flechas. Si quieres, escribe razones a favor o en contra de cada una.
          </p>
        )}
      </div>

      {/* PT-20: results of the previous round, collapsible, only from round 2 on */}
      {roomData?.latestReport && (roomData.sala.currentRound ?? 1) > 1 && (
        <details className="mb-6 rounded-[6px] border border-[#D9D5CC] bg-white">
          <summary className="cursor-pointer select-none p-4 min-h-[44px] text-sm font-semibold text-[#14171A]">
            Resultados de la ronda anterior
          </summary>
          <div className="px-4 pb-4">
            <RoundFeedbackReport options={roomData.options} report={roomData.latestReport} />
          </div>
        </details>
      )}

      {/* READ-ONLY SUMMARY (AUD-06) */}
      {showReadOnlySummary ? (
        <div className="space-y-4">
          <div className="space-y-3">
            {orderedOptions.map((option, index) => {
              const rank = index + 1;
              const title = option.title || option.titulo;
              const description = option.description || option.descripcion;

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
                    <ReasonListsSummary
                      value={reasonsByOption[option.id] ?? EMPTY_REASONS}
                      legacyText={legacyJustifications[option.id]}
                    />
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

                    {legacyJustifications[option.id] && (
                      <p className="mt-3 text-xs text-[#14171A] leading-relaxed bg-[#F6F4EF] p-2.5 rounded-[4px] border border-[#D9D5CC]/80 break-words">
                        {legacyJustifications[option.id]}
                      </p>
                    )}
                    {roomData?.latestReport && (roomData.sala.currentRound ?? 1) > 1 && (
                      <OptionPreviousRound optionId={option.id} report={roomData.latestReport} />
                    )}
                    <ReasonListsField
                      optionId={option.id}
                      value={reasonsByOption[option.id] ?? EMPTY_REASONS}
                      onChange={(next) => handleReasonsChange(option.id, next)}
                      disabled={isClosed}
                    />
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
            {roomData?.sala?.closeWhenAllVoted && (
              <p className="text-xs text-[#5A554E] text-center">
                Si eres la última persona en votar, la ronda se cierra al enviar y ya no podrás editar tu voto.
              </p>
            )}
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
                  Hay razones de más de 200 caracteres en {invalidReasonsCount}{' '}
                  {invalidReasonsCount === 1 ? 'opción' : 'opciones'}
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
