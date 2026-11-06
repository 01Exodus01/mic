'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getParticipantRoomView, logoutParticipant } from '@/app/actions/participant';
import { ParticipantFeedbackSkeleton } from '@/components/ui/Skeleton';
import { CheckCircle2, Clock, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import RoundFeedbackReport, {
  type FeedbackReportData,
} from '@/components/RoundFeedbackReport';
import ConsentDialog from '@/components/ConsentDialog';
import RetiredNotice from '@/components/RetiredNotice';
import ParticipantIdentity from '@/components/ParticipantIdentity';
import { useReportReadTracker } from '@/lib/telemetry/client';

interface OptionItem {
  id: string;
  title?: string;
  description?: string;
  order_index?: number;
}

interface BlindArgumentItem {
  blindCode?: string;
  position?: number;
  justification?: string;
}

interface CollectiveRankingItem {
  id: string;
  midRank: number;
  score?: number;
}

interface RoundReportData {
  round?: number;
  effective_voters?: number;
  collective_ranking?: CollectiveRankingItem[];
  obtained_tau?: number;
  arguments_json?: Record<string, BlindArgumentItem[]>;
  reasonsByOption?: FeedbackReportData['reasonsByOption'];
  tieBreak?: FeedbackReportData['tieBreak'];
  myConcordance?: FeedbackReportData['myConcordance'];
  myPositions?: FeedbackReportData['myPositions'];
}

interface FeedbackRoomData {
  sala: {
    id: string;
    title: string;
    status: string;
    currentRound: number;
    maxRounds: number;
    deadline: string | null;
    method: string;
    tauThreshold: number;
  };
  options: OptionItem[];
  session: {
    participantId: string;
    roomId?: string;
    nickname: string;
    blindCode: string;
  };
  latestReport: RoundReportData | null;
  /** Why the process ended (only when CONCLUDED) */
  conclusion?: 'CONSENSUS' | 'MAX_ROUNDS' | null;
  displayName?: string | null;
  consent?: { required: boolean; accepted: boolean; text: string | null };
}

/** One clear reason why the process ended (stop_reason). */
function conclusionText(reason: FeedbackRoomData['conclusion'], maxRounds: number): string {
  if (reason === 'CONSENSUS') return 'El grupo alcanzó el acuerdo requerido.';
  if (reason === 'MAX_ROUNDS') {
    return maxRounds === 1
      ? 'Se completó la única ronda prevista sin alcanzar el acuerdo requerido.'
      : `Se completaron las ${maxRounds} rondas previstas sin alcanzar el acuerdo requerido.`;
  }
  return 'El proceso de consenso concluyó.';
}

export default function ParticipantFeedbackPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [roomData, setRoomData] = useState<FeedbackRoomData | null>(null);
  const [retired, setRetired] = useState(false);
  // P2.1: real reading time of the report shown on this screen
  const onReportSectionOpen = useReportReadTracker(roomData?.latestReport?.round, 'feedback', !retired);

  // Polling guard: one request at a time, and a late answer never overwrites a newer one
  const inFlightRef = useRef(false);
  const seqRef = useRef(0);

  const loadData = useCallback(async () => {
    if (inFlightRef.current) return;
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
        router.push('/join');
        return;
      }

      const data = res.data as unknown as FeedbackRoomData;
      setRoomData(data);

      // The host opened the next round: say it and go to the selection screen
      if (data.sala.status === 'ROUND_OPEN') {
        toast.info(`Se abrió la Ronda ${data.sala.currentRound}. Vuelve a ordenar las opciones.`);
        router.push('/participant/vote');
        return;
      }
    } catch (err) {
      console.error(err);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadData();
    // Only while the screen is visible; at once when it becomes visible again
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadData();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadData();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [loadData]);

  const handleLogout = async () => {
    try {
      await logoutParticipant();
      toast.success('Sesión finalizada.');
      router.push('/join');
    } catch {
      router.push('/join');
    }
  };

  if (retired) {
    return <RetiredNotice />;
  }

  if (loading) {
    return <ParticipantFeedbackSkeleton />;
  }

  if (!roomData) {
    return null;
  }

  const { sala, options, latestReport } = roomData;
  const isConcluded = sala.status === 'CONCLUDED';
  // The group's level of agreement and its full order are not shown to
  // participants between rounds, so as not to bias their next selection.

  return (
    <main className="flex-1 max-w-[760px] w-full mx-auto px-4 py-8 pb-16">
      {/* Barra superior con datos de sesión y botón de salida (AUD-34, AUD-35) */}
      <div className="flex items-center justify-between pb-3 mb-6 border-b border-[#D9D5CC] text-xs">
        <div className="flex items-center gap-2">
          <ParticipantIdentity displayName={roomData.displayName} />
        </div>
        {roomData.consent?.required && roomData.consent.text && <ConsentDialog text={roomData.consent.text} />}
        <button
          type="button"
          onClick={handleLogout}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1.5 px-2 text-[#6B6860] hover:text-[#B42318] transition-colors"
        >
          <LogOut className="w-3.5 h-3.5 stroke-[1.5]" />
          <span>Salir</span>
        </button>
      </div>
      {/* Cabecera sobria */}
      <div className="mb-8 border-b border-[#D9D5CC] pb-6">
        <div className="flex items-center justify-between text-xs text-[#5A554E] font-mono mb-2">
          <span>
            {isConcluded ? 'Finalizada' : `Revisión de argumentos • Ronda ${sala.currentRound}`}
          </span>
        </div>

        <h1 className="font-heading text-3xl font-bold text-[#14171A] leading-tight">
          {sala.title}
        </h1>

        {/* Mensaje de estado directo y sin exclamaciones */}
        {isConcluded ? (
          <div role="status" className="mt-4 p-4 rounded-[6px] border-2 border-[#2F7D4F] bg-[#2F7D4F]/5 text-sm text-[#14171A] flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 stroke-[1.5] text-[#2F7D4F] shrink-0 mt-0.5" />
            <span>
              <strong className="block font-semibold">La actividad terminó.</strong>
              {conclusionText(roomData.conclusion, sala.maxRounds)}
            </span>
          </div>
        ) : (
          <div className="mt-4 p-3.5 rounded-[6px] border border-[#D9D5CC] bg-white text-xs text-[#14171A] flex items-center gap-2">
            <Clock className="w-4 h-4 stroke-[1.5] text-[#5A554E] shrink-0" />
            <span>
              Ronda cerrada. Revisa los argumentos del grupo. Esperando la siguiente ronda.
            </span>
          </div>
        )}
      </div>

      {/* PT-19: tu concordancia y, por opción, tu posición, la del grupo y todas las razones */}
      <section>
        <div className="mb-3">
          <h2 className="font-heading text-lg font-bold text-[#14171A]">
            {isConcluded ? 'Resultado final' : 'Posición sugerida y razones del grupo'}
          </h2>
          <p className="text-sm text-[#14171A] mt-1 leading-relaxed">
            {isConcluded
              ? 'Las opciones en el orden final del grupo. Abre cada una para ver las razones a favor y en contra.'
              : 'Las opciones están en el orden que sugiere el grupo. Abre cada una para ver tu posición, la posición sugerida y las razones a favor y en contra que escribió el grupo. Úsalo para revisar tu orden en la próxima ronda.'}
          </p>
        </div>
        {latestReport ? (
          <RoundFeedbackReport options={options || []} report={latestReport} final={isConcluded} onSectionOpen={onReportSectionOpen} />
        ) : (
          <p className="text-xs text-[#5A554E]">Todavía no hay resultados de esta ronda.</p>
        )}
      </section>
    </main>
  );
}
