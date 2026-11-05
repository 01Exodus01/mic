'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getParticipantRoomView, logoutParticipant } from '@/app/actions/participant';
import { ParticipantFeedbackSkeleton } from '@/components/ui/Skeleton';
import { CheckCircle2, Clock, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import RoundFeedbackReport, {
  formatParticipantSignature,
  type FeedbackReportData,
} from '@/components/RoundFeedbackReport';
import ConsentDialog from '@/components/ConsentDialog';
import RetiredNotice from '@/components/RetiredNotice';
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
  consent?: { required: boolean; accepted: boolean; text: string | null };
}

export default function ParticipantFeedbackPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [roomData, setRoomData] = useState<FeedbackRoomData | null>(null);
  const [retired, setRetired] = useState(false);
  // P2.1: real reading time of the report shown on this screen
  const onReportSectionOpen = useReportReadTracker(roomData?.latestReport?.round, 'feedback', !retired);

  const loadData = useCallback(async () => {
    try {
      const res = await getParticipantRoomView();
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

      // Si el anfitrión abre la siguiente ronda, volver a la votación
      if (data.sala.status === 'ROUND_OPEN') {
        router.push('/participant/vote');
        return;
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
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
          <span className="font-mono text-[#6B6860]">
            {roomData?.session?.blindCode || 'Participante'}
          </span>
          <span className="text-[#D9D5CC]">·</span>
          <span className="text-[#6B6860]">Conectado como participante</span>
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
          <span className="border border-[#D9D5CC] px-2 py-0.5 rounded-[999px] text-[#14171A]">
            {formatParticipantSignature(roomData.session.blindCode)}
          </span>
        </div>

        <h1 className="font-heading text-3xl font-bold text-[#14171A] leading-tight">
          {sala.title}
        </h1>

        {/* Mensaje de estado directo y sin exclamaciones */}
        {isConcluded ? (
          <div className="mt-4 p-3.5 rounded-[6px] border border-[#2F7D4F] bg-[#2F7D4F]/5 text-xs text-[#14171A] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 stroke-[1.5] text-[#2F7D4F] shrink-0" />
            <span>
              Actividad finalizada. Se alcanzó el acuerdo requerido o el máximo de rondas.
            </span>
          </div>
        ) : (
          <div className="mt-4 p-3.5 rounded-[6px] border border-[#D9D5CC] bg-white text-xs text-[#14171A] flex items-center gap-2">
            <Clock className="w-4 h-4 stroke-[1.5] text-[#5A554E] shrink-0" />
            <span>
              Votación cerrada. Revisa los argumentos del grupo. Esperando la siguiente ronda.
            </span>
          </div>
        )}
      </div>

      {/* PT-19: tu concordancia y, por opción, tu posición, la del grupo y todas las razones */}
      <section>
        <div className="mb-3">
          <h2 className="font-heading text-lg font-bold text-[#14171A]">
            Argumentos del grupo por opción
          </h2>
          <p className="text-xs text-[#5A554E] mt-0.5">
            Abre cada opción para ver tu posición, la del grupo y todas las razones a favor y en contra que escribió el grupo.
          </p>
        </div>
        {latestReport ? (
          <RoundFeedbackReport options={options || []} report={latestReport} onSectionOpen={onReportSectionOpen} />
        ) : (
          <p className="text-xs text-[#5A554E]">Todavía no hay resultados de esta ronda.</p>
        )}
      </section>
    </main>
  );
}
