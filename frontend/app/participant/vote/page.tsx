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
import { trackEvent, useReportReadTracker } from '@/lib/telemetry/client';
import RoundFeedbackReport, { OptionPreviousRound, type FeedbackReportData } from '@/components/RoundFeedbackReport';
import ConsentDialog from '@/components/ConsentDialog';
import RetiredNotice from '@/components/RetiredNotice';
import { formatCountdown, formatDeadlineLabel } from '@/components/DurationPicker';
import { toast } from 'sonner';
import { ParticipantVoteSkeleton } from '@/components/ui/Skeleton';
import { Clock, LogOut, AlertCircle, AlertTriangle, ChevronDown, Edit3, CheckCircle2, RefreshCw } from 'lucide-react';
import RankingList, { type MoveMethod } from '@/components/RankingList';

interface OptionItem {
  id: string;
  title?: string;
  description?: string;
  order_index?: number;
}

interface ParticipantSessionInfo {
  participantId: string;
  roomId?: string;
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
    option_id?: string;
    position?: number;
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
  // Option whose reasons and details are open (one at a time)
  const [openId, setOpenId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [retired, setRetired] = useState<boolean>(false);
  const isEditingRef = useRef<boolean>(false);
  const initialLoadDoneRef = useRef<boolean>(false);
  const currentRoundRef = useRef<number | null>(null);

  const serverOffsetRef = useRef<number>(0);
  // P2 telemetry: reorders and reason fields of this round, never their text
  const reorderCountRef = useRef(0);
  const typedFieldsRef = useRef<Set<string>>(new Set());
  const [previousOpen, setPreviousOpen] = useState(false);
  const onReportSectionOpen = useReportReadTracker(
    roomData?.latestReport && (roomData.sala.currentRound ?? 1) > 1 ? roomData.latestReport.round : null,
    'vote',
    previousOpen
  );


  const syncReasonsFromVotes = (myVotes: ParticipantRoomData['myVotes']) => {
    const reasonMap: Record<string, OptionReasons> = {};
    const legacyMap: Record<string, string> = {};
    for (const v of myVotes) {
      const optId = v.option_id!;
      reasonMap[optId] = { for: [...(v.reasonsFor ?? [])], against: [...(v.reasonsAgainst ?? [])] };
      const legacy = v.justification || '';
      if (legacy) legacyMap[optId] = legacy;
    }
    setReasonsByOption(reasonMap);
    setLegacyJustifications(legacyMap);
  };

  // Polling guard: one request at a time, and a late answer never overwrites a
  // newer one (with a slow server an old round could otherwise come back)
  const inFlightRef = useRef(false);
  const seqRef = useRef(0);

  const loadData = useCallback(async (force = false) => {
    if (inFlightRef.current && !force) return;
    inFlightRef.current = true;
    const seq = ++seqRef.current;
    try {
      const res = await getParticipantRoomView();
      if (seq !== seqRef.current) return;
      if (!res.success && res.code === 'RETIRED') {
        setRetired(true);
        return;
      }
      if (!res.success && res.code === 'SESSION_EXPIRED') {
        toast.error(res.error);
        router.push('/join');
        return;
      }
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
        // The round changed while this screen was open: say it clearly
        if (currentRoundRef.current !== null && currentRound > currentRoundRef.current) {
          toast.info(`Se abrió la Ronda ${currentRound}. Vuelve a ordenar las opciones.`);
        }
        currentRoundRef.current = currentRound;
        initialLoadDoneRef.current = false;
        reorderCountRef.current = 0;
        typedFieldsRef.current = new Set();
        // A new round starts from a clean ballot: nothing typed in the previous
        // round stays in the fields (the same as after reloading the page)
        setReasonsByOption({});
        setLegacyJustifications({});
        setOpenId(null);
        setIsEditing(false);
        isEditingRef.current = false;
      }

      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;
        if (hasVoted) {
          const sorted = [...options].sort((a, b) => {
            const vA = myVotes.find((v) => v.option_id === a.id);
            const posA = vA?.position ?? 0;
            const vB = myVotes.find((v) => v.option_id === b.id);
            const posB = vB?.position ?? 0;
            return posA - posB;
          });
          setOrderedOptions(sorted);
          syncReasonsFromVotes(myVotes);
        } else {
          // P1.4: the server already sends the options in this participant's own random order
          setOrderedOptions([...options]);
        }
      } else {
        // Subsequent polling calls: only sync ordered options and justifications
        // if user has already voted AND is not actively editing their ballot
        if (hasVoted && !isEditingRef.current) {
          const sorted = [...options].sort((a, b) => {
            const vA = myVotes.find((v) => v.option_id === a.id);
            const posA = vA?.position ?? 0;
            const vB = myVotes.find((v) => v.option_id === b.id);
            const posB = vB?.position ?? 0;
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
      if (seq === seqRef.current) inFlightRef.current = false;
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
        setTimeLeft('Ronda cerrada');
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

  // P2.2: one event per reorder before sending (positions are 1-based)
  const trackReorder = (method: 'buttons' | 'drag' | 'touch', optionId: string, from: number, to: number) => {
    if (from === to) return;
    reorderCountRef.current += 1;
    trackEvent({
      type: 'ranking_reordered',
      method,
      option_id: optionId,
      from_position: from + 1,
      to_position: to + 1,
      reorder_index: reorderCountRef.current,
    });
  };

  // Reorder: buttons, mouse drag or touch drag (RankingList animates the change)
  const handleMove = (from: number, to: number, method: MoveMethod) => {
    if (from === to || to < 0 || to >= orderedOptions.length) return;
    trackReorder(method, orderedOptions[from].id, from, to);
    const next = [...orderedOptions];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrderedOptions(next);
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
      // The reasons of that option may be collapsed: open them, then focus the field
      const optionId = orderedOptions.find((o) => invalidField.startsWith(`reason-${o.id}-`))?.id ?? null;
      setOpenId(optionId);
      setTimeout(() => document.getElementById(invalidField)?.focus(), 0);
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
        toast.success('Selección guardada.');
        setIsEditing(false);
        isEditingRef.current = false;
        await loadData(true);
      } else if (res.code === 'RETIRED') {
        setRetired(true);
      } else if (res.code === 'ROOM_CLOSED') {
        // The round closed while this screen still showed time: block and refresh now
        setIsExpiredLocally(true);
        toast.error(res.error || 'La ronda ya se cerró.');
        await loadData(true);
      } else {
        toast.error(res.error || 'No fue posible guardar la selección.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al enviar la selección.';
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

  // P2.2: the editable ballot became visible (reference for time to first reorder)
  const ballotFormShown = Boolean(
    roomData &&
      roomData.sala.status === 'ROUND_OPEN' &&
      !isExpiredLocally &&
      ((roomData.myVotes?.length ?? 0) !== (roomData.options?.length ?? 0) || isEditing)
  );
  useEffect(() => {
    if (ballotFormShown) trackEvent({ type: 'ballot_viewed', editing: isEditing });
  }, [ballotFormShown, isEditing, roomData?.sala.currentRound]);

  if (retired) {
    return <RetiredNotice />;
  }

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
            Ronda cerrada. La hora límite fue a las {deadlineHour}. Esperando los resultados de la ronda.
          </div>
        ) : showReadOnlySummary ? (
          <div className="mt-3 p-3 rounded-[6px] border border-[#2F7D4F]/30 bg-[#2F7D4F]/5 text-xs text-[#2F7D4F] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 stroke-[1.5] shrink-0" />
            <span>Selección enviada. Puedes editarla mientras la ronda siga abierta.</span>
          </div>
        ) : (
          <p className="text-sm text-[#14171A] mt-2 leading-relaxed">
            Ordena las opciones de mayor a menor preferencia arrastrando o con las flechas. Si quieres, escribe razones a favor o en contra de cada una.
          </p>
        )}
      </div>

      {/* New round + results of the previous round (PT-20), prominent so nobody misses them */}
      {roomData?.latestReport && (roomData.sala.currentRound ?? 1) > 1 && (
        <section
          aria-label="Resultados de la ronda anterior"
          className="mb-5 rounded-[6px] border-2 border-[#E4572E] bg-[#E4572E]/[0.06]"
        >
          {!hasVoted && !isClosed && (
            <div role="status" className="flex items-start gap-2 px-4 pt-3 text-sm text-[#14171A]">
              <RefreshCw className="w-4 h-4 stroke-[2] text-[#E4572E] shrink-0 mt-0.5" aria-hidden="true" />
              <p>
                <strong className="font-semibold">Se abrió la Ronda {roomData.sala.currentRound}.</strong> Revisa los
                resultados de la Ronda {roomData.sala.currentRound - 1} y vuelve a ordenar las opciones.
              </p>
            </div>
          )}
          <details onToggle={(e) => setPreviousOpen(e.currentTarget.open)}>
            <summary className="cursor-pointer select-none px-4 py-3 min-h-[48px] flex items-center justify-between gap-2 text-sm font-semibold text-[#14171A]">
              <span>Ver resultados de la Ronda {roomData.sala.currentRound - 1}</span>
              <ChevronDown className="w-4 h-4 stroke-[2] text-[#E4572E] shrink-0" aria-hidden="true" />
            </summary>
            <div className="px-3 pb-3">
              <RoundFeedbackReport
                options={roomData.options}
                report={roomData.latestReport}
                onSectionOpen={onReportSectionOpen}
              />
            </div>
          </details>
        </section>
      )}

      {/* READ-ONLY SUMMARY (AUD-06) */}
      {showReadOnlySummary ? (
        <div className="space-y-4">
          <div className="space-y-3">
            {orderedOptions.map((option, index) => {
              const rank = index + 1;
              const title = option.title;
              const description = option.description;

              return (
                <div
                  key={option.id}
                  className="rounded-[6px] border border-[#D9D5CC] bg-white p-3 space-y-2"
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
                        <p className="text-xs text-[#14171A]/75 mt-0.5 leading-relaxed">
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
                <span>Editar selección</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        /* EDITABLE FORM (AUD-06 / AUD-12): compact rows, reasons on demand */
        <RankingList
          items={orderedOptions}
          onMove={handleMove}
          disabled={isClosed}
          openId={openId}
          onOpenChange={setOpenId}
          reasonCounts={Object.fromEntries(
            orderedOptions.map((o) => {
              const v = reasonsByOption[o.id] ?? EMPTY_REASONS;
              return [o.id, { for: cleanReasons(v.for).length, against: cleanReasons(v.against).length }];
            })
          )}
          renderDetails={(option) => (
            <div className="space-y-2.5">
              {option.description && (
                <p className="text-sm text-[#14171A] leading-relaxed break-words">{option.description}</p>
              )}
              {legacyJustifications[option.id] && (
                <p className="text-xs text-[#14171A] leading-relaxed bg-[#F6F4EF] p-2.5 rounded-[4px] border border-[#D9D5CC]/80 break-words">
                  {legacyJustifications[option.id]}
                </p>
              )}
              {roomData?.latestReport && (roomData.sala.currentRound ?? 1) > 1 && (
                <OptionPreviousRound optionId={option.id} report={roomData.latestReport} onOpen={onReportSectionOpen} />
              )}
              <ReasonListsField
                optionId={option.id}
                value={reasonsByOption[option.id] ?? EMPTY_REASONS}
                onChange={(next) => handleReasonsChange(option.id, next)}
                disabled={isClosed}
                onFieldAdded={(side) => trackEvent({ type: 'reason_field_added', option_id: option.id, side })}
                onTyping={(side) => {
                  const key = `${option.id}:${side}`;
                  if (typedFieldsRef.current.has(key)) return;
                  typedFieldsRef.current.add(key);
                  trackEvent({ type: 'reason_typing_started', option_id: option.id, side });
                }}
              />
            </div>
          )}
        />
      )}

      {/* Bottom action bar when in edit mode and voting is open */}
      {!isClosed && !showReadOnlySummary && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#F6F4EF] border-t border-[#D9D5CC] p-4 z-40">
          <div className="max-w-[540px] mx-auto w-full space-y-2">
            {roomData?.sala?.closeWhenAllVoted && (
              <p className="flex items-start gap-2 p-2 rounded-[6px] border border-[#B7791F]/50 bg-[#B7791F]/10 text-xs text-[#14171A]">
                <AlertTriangle className="w-4 h-4 stroke-[1.75] text-[#B7791F] shrink-0" aria-hidden="true" />
                <span>Si eres la última persona en enviar su selección, la ronda se cierra al enviar y ya no podrás editarla.</span>
              </p>
            )}
            {hasVoted && (
              <button
                type="button"
                onClick={() => {
                  isEditingRef.current = false;
                  setIsEditing(false);
                  loadData(true);
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
                  {hasVoted ? 'Guardar cambios' : 'Enviar mi selección'}
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
                  ? 'Guardando selección...'
                  : hasVoted
                  ? 'Guardar cambios'
                  : 'Enviar mi selección'}
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
