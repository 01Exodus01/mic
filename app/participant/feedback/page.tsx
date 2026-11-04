'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getParticipantRoomView, logoutParticipant } from '@/app/actions/participant';
import { ParticipantFeedbackSkeleton } from '@/components/ui/Skeleton';
import { CheckCircle2, Clock, LogOut } from 'lucide-react';
import { toast } from 'sonner';

interface OptionItem {
  id: string;
  titulo?: string;
  title?: string;
  descripcion?: string;
  description?: string;
  orden_idx?: number;
  order_index?: number;
}

interface BlindArgumentItem {
  codigoCiego?: string;
  blindCode?: string;
  posicion?: number;
  position?: number;
  justificacion?: string;
  justification?: string;
}

interface CollectiveRankingItem {
  id: string;
  midRank: number;
  score?: number;
}

interface RoundReportData {
  ronda?: number;
  round?: number;
  m_efectivo?: number;
  effective_voters?: number;
  ranking_colectivo?: CollectiveRankingItem[];
  collective_ranking?: CollectiveRankingItem[];
  tau_obtenido?: number;
  obtained_tau?: number;
  argumentos_json?: Record<string, BlindArgumentItem[]>;
  arguments_json?: Record<string, BlindArgumentItem[]>;
}

interface FeedbackRoomData {
  sala: {
    id: string;
    titulo: string;
    estado: string;
    rondaActual: number;
    maxRondas: number;
    deadline: string | null;
    metodo: string;
    tauUmbral: number;
  };
  proyectos: OptionItem[];
  session: {
    participantId: string;
    roomId?: string;
    salaId?: string;
    nickname: string;
    blindCode: string;
  };
  latestReport: RoundReportData | null;
}

// Convierte identificadores internos a "Participante NN"
function formatParticipantSignature(rawCode?: string): string {
  if (!rawCode) return 'Participante';
  const match = rawCode.match(/(\d+)/);
  if (match) {
    const num = match[1].padStart(2, '0');
    return `Participante ${num}`;
  }
  return rawCode.replace(/Sujeto_/i, 'Participante ').replace(/Evaluador\s*/i, 'Participante ');
}

// Formatea empates según AGENTS.md (ej. "1.º y 2.º empatadas")
function formatRankPosition(
  midRank: number,
  allRanks: Array<{ id: string; midRank: number }>
): { label: string; isTied: boolean } {
  const tiedGroup = allRanks.filter((r) => r.midRank === midRank);
  const k = tiedGroup.length;

  if (k > 1) {
    const start = Math.round(midRank - (k - 1) / 2);
    const end = Math.round(midRank + (k - 1) / 2);
    if (k === 2) {
      return { label: `${start}.º y ${end}.º empatadas`, isTied: true };
    }
    const positions = Array.from({ length: k }, (_, i) => `${start + i}.º`);
    const allExceptLast = positions.slice(0, -1).join(', ');
    const last = positions[positions.length - 1];
    return { label: `${allExceptLast} y ${last} empatadas`, isTied: true };
  }

  return { label: `${Math.round(midRank)}.º`, isTied: false };
}

export default function ParticipantFeedbackPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [roomData, setRoomData] = useState<FeedbackRoomData | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await getParticipantRoomView();
      if (!res.success || !res.data) {
        router.push('/join');
        return;
      }

      const data = res.data as unknown as FeedbackRoomData;
      setRoomData(data);

      const options = data.proyectos || [];
      if (options.length > 0 && !selectedOptionId) {
        setSelectedOptionId(options[0].id);
      }

      // Si el anfitrión abre la siguiente ronda, volver a la votación
      if (data.sala.estado === 'ROUND_OPEN') {
        router.push('/participant/vote');
        return;
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [router, selectedOptionId]);

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

  const { sala, proyectos, latestReport } = roomData;
  const isConcluded = sala.estado === 'CONCLUDED';
  const collectiveRanking: CollectiveRankingItem[] =
    latestReport?.collective_ranking || latestReport?.ranking_colectivo || [];
  const argumentsByOption: Record<string, BlindArgumentItem[]> =
    latestReport?.arguments_json || latestReport?.argumentos_json || {};

  // Ordenar opciones según el midRank del orden colectivo
  const sortedOptions = [...(proyectos || [])].sort((a, b) => {
    const rA = collectiveRanking.find((r) => r.id === a.id)?.midRank ?? 99;
    const rB = collectiveRanking.find((r) => r.id === b.id)?.midRank ?? 99;
    return rA - rB;
  });

  const selectedOption = sortedOptions.find((p) => p.id === selectedOptionId) || sortedOptions[0];
  const currentArguments = selectedOption ? argumentsByOption[selectedOption.id] || [] : [];

  // Métricas de acuerdo en %
  const tauRaw = latestReport?.obtained_tau ?? latestReport?.tau_obtenido ?? 0;
  const tauPct = Math.round(tauRaw * 100);
  const requiredPct = Math.round((sala.tauUmbral || 0.8) * 100);
  const agreementMet = tauPct >= requiredPct;

  const selectedTitle = selectedOption?.title || selectedOption?.titulo;
  const selectedDescription = selectedOption?.description || selectedOption?.descripcion;

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
            {isConcluded ? 'Finalizada' : `Revisión de argumentos • Ronda ${sala.rondaActual}`}
          </span>
          <span className="border border-[#D9D5CC] px-2 py-0.5 rounded-[999px] text-[#14171A]">
            {formatParticipantSignature(roomData.session.blindCode)}
          </span>
        </div>

        <h1 className="font-heading text-3xl font-bold text-[#14171A] leading-tight">
          {sala.titulo}
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
                const optTitle = option.title || option.titulo;
                const optDesc = option.description || option.descripcion;

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

      {/* Argumentos agrupados por opción */}
      <section>
        <div className="mb-3">
          <h2 className="font-heading text-lg font-bold text-[#14171A]">
            Argumentos del grupo por opción
          </h2>
          <p className="text-xs text-[#5A554E] mt-0.5">
            Selecciona una opción para revisar los motivos escritos por los participantes.
          </p>
        </div>

        {/* Selector de opciones sobrio */}
        <div className="flex flex-wrap gap-2 mb-4">
          {sortedOptions.map((option) => {
            const isSelected = selectedOption?.id === option.id;
            const count = (argumentsByOption[option.id] || []).length;
            const optTitle = option.title || option.titulo;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedOptionId(option.id)}
                className={`min-h-[44px] px-3.5 py-2.5 rounded-[6px] text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                  isSelected
                    ? 'border-[#E4572E] bg-white text-[#14171A] font-semibold'
                    : 'border-[#D9D5CC] bg-[#F6F4EF] text-[#6B6860] hover:text-[#14171A]'
                }`}
              >
                <span>{optTitle}</span>
                <span className="font-mono text-[11px] text-[#6B6860]">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Lista de argumentos firmados como "Participante 04" */}
        <div className="border border-[#D9D5CC] rounded-[6px] bg-white p-5 space-y-3">
          <div>
            <h3 className="font-sans font-bold text-base text-[#14171A]">
              {selectedTitle}
            </h3>
            {selectedDescription && (
              <p className="text-xs text-[#5A554E] mt-1 leading-relaxed">
                {selectedDescription}
              </p>
            )}
          </div>

          <div className="border-t border-[#D9D5CC] pt-3">
            {currentArguments.length === 0 ? (
              <p className="text-xs text-[#5A554E] py-6 text-center">
                No hay razones registradas para esta opción en esta ronda.
              </p>
            ) : (
              <div className="space-y-3">
                {currentArguments.map((arg, idx) => {
                  const blind = arg.blindCode || arg.codigoCiego;
                  const pos = arg.position || arg.posicion;
                  const just = arg.justification || arg.justificacion;

                  return (
                    <div
                      key={idx}
                      className="p-3.5 rounded-[6px] border border-[#D9D5CC] bg-[#F6F4EF] text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between font-mono text-[11px] text-[#5A554E]">
                        <span className="font-semibold text-[#14171A]">
                          {formatParticipantSignature(blind)}
                        </span>
                        <span>Posición asignada: {pos}.º</span>
                      </div>
                      <p className="text-[#14171A] leading-relaxed italic">
                        &quot;{just}&quot;
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
