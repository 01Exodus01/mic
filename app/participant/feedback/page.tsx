'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getParticipantRoomView, logoutParticipant } from '@/app/actions/participant';
import { ParticipantFeedbackSkeleton } from '@/components/ui/Skeleton';
import { CheckCircle2, Clock, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import RoundFeedbackReport, {
  formatParticipantSignature,
  formatRankPosition,
  type FeedbackReportData,
} from '@/components/RoundFeedbackReport';
import ConsentDialog from '@/components/ConsentDialog';

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
    salaId?: string;
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

  const loadData = useCallback(async () => {
    try {
      const res = await getParticipantRoomView();
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

  if (loading) {
    return <ParticipantFeedbackSkeleton />;
  }

  if (!roomData) {
    return null;
  }

  const { sala, options, latestReport } = roomData;
  const isConcluded = sala.status === 'CONCLUDED';
  const collectiveRanking: CollectiveRankingItem[] =
    latestReport?.collective_ranking || [];

  // Ordenar opciones según el midRank del orden colectivo
  const sortedOptions = [...(options || [])].sort((a, b) => {
    const rA = collectiveRanking.find((r) => r.id === a.id)?.midRank ?? 99;
    const rB = collectiveRanking.find((r) => r.id === b.id)?.midRank ?? 99;
    return rA - rB;
  });


  // Métricas de acuerdo en %
  const tauRaw = latestReport?.obtained_tau ?? 0;
  const tauPct = Math.round(tauRaw * 100);
  const requiredPct = Math.round((sala.tauThreshold || 0.8) * 100);
  const agreementMet = tauPct >= requiredPct;


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

      {/* Nivel de acuerdo en % con barra simple contra el requerido */}
      <section className="mb-8 p-5 rounded-[6px] border border-[#D9D5CC] bg-white">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 mb-3">
          <div>
            <h2 className="font-heading text-lg font-bold text-[#14171A]">
              Nivel de acuerdo
            </h2>
            <p className="text-xs text-[#5A554E] mt-0.5">
              Acuerdo colectivo alcanzado en esta ronda.
            </p>
          </div>

          <div className="flex items-baseline gap-2 font-mono">
            <span className="text-3xl font-bold text-[#14171A]">
              {tauPct}%
            </span>
            <span className="text-xs text-[#5A554E]">
              (requerido: {requiredPct}%)
            </span>
          </div>
        </div>

        {/* Barra simple de una sola serie, sin gradientes ni 3D */}
        <div className="space-y-1.5">
          <div className="h-3 w-full bg-[#EBE7DF] rounded-[6px] overflow-hidden relative border border-[#D9D5CC]">
            <div
              className={`h-full transition-all duration-300 ${
                agreementMet ? 'bg-[#2F7D4F]' : 'bg-[#E4572E]'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, tauPct))}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-mono text-[#5A554E]">
            <span>0%</span>
            <span>Meta: {requiredPct}%</span>
            <span>100%</span>
          </div>
        </div>
      </section>

      {/* Tabla del orden del grupo con empates explícitos y rangos con un decimal */}
      <section className="mb-8">
        <div className="mb-3">
          <h2 className="font-heading text-lg font-bold text-[#14171A]">
            Orden del grupo
          </h2>
          <p className="text-xs text-[#5A554E] mt-0.5">
            Posiciones agregadas según los votos recibidos.
          </p>
        </div>

        <div className="border border-[#D9D5CC] rounded-[6px] bg-white overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#D9D5CC] bg-[#F6F4EF] text-[#5A554E] font-mono">
                <th className="py-2.5 px-4 font-medium w-40">Posición</th>
                <th className="py-2.5 px-3 font-medium w-24">Rango</th>
                <th className="py-2.5 px-4 font-medium">Opción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D9D5CC]">
              {sortedOptions.map((option) => {
                const rankInfo = collectiveRanking.find((r) => r.id === option.id);
                const midRankNum = rankInfo?.midRank ?? 0;
                const { label: positionLabel, isTied } = formatRankPosition(
                  midRankNum,
                  collectiveRanking
                );
                const optTitle = option.title;
                const optDesc = option.description;

                return (
                  <tr key={option.id} className="hover:bg-[#F6F4EF]/50 transition-colors">
                    <td className="py-3 px-4 font-sans font-medium text-[#14171A]">
                      <span className={isTied ? 'font-semibold text-[#14171A]' : 'text-[#14171A]'}>
                        {positionLabel}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono font-medium text-[#5A554E]">
                      {midRankNum.toFixed(1)}
                    </td>
                    <td className="py-3 px-4 font-sans text-[#14171A]">
                      <span className="font-semibold">{optTitle}</span>
                      {optDesc && (
                        <p className="text-[#5A554E] text-[11px] mt-0.5 line-clamp-1">
                          {optDesc}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* PT-19: tu concordancia y, por opción, tu posición, la del grupo y todas las razones */}
      <section>
        <div className="mb-3">
          <h2 className="font-heading text-lg font-bold text-[#14171A]">
            Argumentos del grupo por opción
          </h2>
          <p className="text-xs text-[#5A554E] mt-0.5">
            Abre cada opción para ver tu posición, la del grupo y las razones a favor y en contra que escribió cada participante.
          </p>
        </div>
        {latestReport ? (
          <RoundFeedbackReport options={options || []} report={latestReport} />
        ) : (
          <p className="text-xs text-[#5A554E]">Todavía no hay resultados de esta ronda.</p>
        )}
      </section>
    </main>
  );
}
