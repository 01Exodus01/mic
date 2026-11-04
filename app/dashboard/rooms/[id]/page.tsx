'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getRoomStatus,
  startRoom,
  closeRoundManually,
  extendDeadline,
  cancelRoom,
  openNextRound,
  resetParticipantPin,
  expelParticipant,
} from '@/app/actions/room';
import { toast } from 'sonner';
import { RoomDashboardSkeleton } from '@/components/ui/Skeleton';
import PasswordInput from '@/components/ui/PasswordInput';
import DurationPicker from '@/components/DurationPicker';
import { RoomSettingsSummary } from '@/components/RoomAdvancedSettings';
import RoomRosterManager from '@/components/RoomRosterManager';
import ParticipationTable from '@/components/ParticipationTable';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog';
import {
  Copy,
  Check,
  ChevronDown,
  Download,
  AlertTriangle,
  Clock,
  ArrowLeft,
  AlertCircle,
} from 'lucide-react';
import { PersonalPinSchema, MIN_PARTICIPANTS } from '@/lib/validations';
import type { RankingEntry, BlindArgumentsMap } from '@/types/report';

interface ProjectItem {
  id: string;
  titulo: string;
  descripcion: string;
  orden_idx: number;
}

interface ParticipantItem {
  id: string;
  nickname: string;
  codigo_ciego?: string;
}

interface ReportItem {
  ronda: number;
  m_efectivo?: number;
  tau_obtenido: number;
  ranking_colectivo: RankingEntry[];
  argumentos_json: BlindArgumentsMap;
}

interface RoomDetails {
  id: string;
  pin: string;
  titulo: string;
  metodo: string;
  min_miembros: number;
  max_miembros: number;
  tau_umbral: number;
  max_rondas: number;
  ronda_actual: number;
  estado: string;
  deadline: string | null;
  proyectos: ProjectItem[];
  participantes: ParticipantItem[];
  reportes: ReportItem[];
  tie_break_rule?: 'NONE' | 'LEXICOGRAPHIC' | 'REASON_BALANCE';
  concordance_variant?: 'WITH_TIES' | 'WITHOUT_TIES';
  access_mode?: 'OPEN_PIN' | 'ROSTER';
  allow_late_join?: boolean;
  close_when_all_voted?: boolean;
  consent_required?: boolean;
}

interface RoomDashboardData {
  sala: RoomDetails;
  votesThisRound: number;
  voterIds?: string[];
  isExpired: boolean;
  serverTime?: string;
}

const STATE_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  ROUND_OPEN: 'Votación abierta',
  INSUFFICIENT_VOTES: 'Faltan votos',
  QUORUM_UNMET: 'Faltan votos',
  PROCESSING: 'Calculando resultados',
  ROUND_FEEDBACK: 'Revisión de argumentos',
  CONCLUDED: 'Finalizada',
  CANCELLED: 'Cancelada',
};

const STATE_CLASSES: Record<string, string> = {
  DRAFT: 'text-[#5A554E]',
  ROUND_OPEN: 'text-[#2F7D4F] font-semibold',
  INSUFFICIENT_VOTES: 'text-[#B42318] font-semibold',
  QUORUM_UNMET: 'text-[#B42318] font-semibold',
  PROCESSING: 'text-[#B7791F] font-semibold',
  ROUND_FEEDBACK: 'text-[#14171A] font-semibold',
  CONCLUDED: 'text-[#2F7D4F] font-semibold',
  CANCELLED: 'text-[#B42318] font-semibold',
};

export default function RoomHostPage() {
  const params = useParams();
  const salaId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RoomDashboardData | null>(null);
  const [copiedPin, setCopiedPin] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Minutos para abrir o extender
  const [selectedMinutes, setSelectedMinutes] = useState(15);
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState(15);
  const [remainingTime, setRemainingTime] = useState<string>('');

  const serverOffsetRef = useRef<number>(0);

  // Diálogos simples con texto plano (sin modal decorativo)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [resetPinModal, setResetPinModal] = useState<{
    open: boolean;
    partId: string;
    nickname: string;
  }>({
    open: false,
    partId: '',
    nickname: '',
  });
  const [newPinValue, setNewPinValue] = useState('');
  const [resetPinTouched, setResetPinTouched] = useState(false);
  const [resetPinError, setResetPinError] = useState<string | null>(null);
  const [resetPinServerError, setResetPinServerError] = useState<string | null>(null);
  const resetPinInputRef = useRef<HTMLInputElement>(null);

  // Expulsión de participante (AUD-13, 14, D2, D3)
  const [expelModal, setExpelModal] = useState<{
    open: boolean;
    partId: string;
    nickname: string;
  }>({
    open: false,
    partId: '',
    nickname: '',
  });
  const [expelLoading, setExpelLoading] = useState(false);
  const [expelServerError, setExpelServerError] = useState<string | null>(null);

  const validateResetPin = (val: string): string | null => {
    const res = PersonalPinSchema.safeParse(val);
    if (!res.success) {
      return res.error.errors[0]?.message || 'El PIN personal debe tener exactamente 4 dígitos.';
    }
    return null;
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await getRoomStatus(salaId);
      if (res.success && res.data) {
        const d = res.data as unknown as RoomDashboardData;
        setData(d);
        if (d.serverTime) {
          serverOffsetRef.current = new Date(d.serverTime).getTime() - Date.now();
        }
      } else if (!res.success) {
        toast.error(res.error || 'No fue posible cargar el estado de la sala.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error de comunicación.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [salaId]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchStatus();
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Tab visibility and online recovery
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchStatus();
      }
    };
    const handleOnline = () => {
      fetchStatus();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [fetchStatus]);

  // Server-time-based countdown timer
  useEffect(() => {
    if (data?.sala?.estado !== 'ROUND_OPEN' || !data.sala.deadline) {
      setRemainingTime('');
      return;
    }

    const deadlineMs = new Date(data.sala.deadline).getTime();

    const updateCountdown = () => {
      const serverNow = Date.now() + serverOffsetRef.current;
      const diff = deadlineMs - serverNow;

      if (diff <= 0) {
        setRemainingTime('Votación cerrada');
        return;
      }

      const totalSecs = Math.floor(diff / 1000);
      const hours = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      const secs = totalSecs % 60;

      if (hours > 0) {
        setRemainingTime(`${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
      } else {
        setRemainingTime(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [data?.sala?.estado, data?.sala?.deadline]);

  const copyPin = () => {
    if (!data?.sala?.pin) return;
    navigator.clipboard.writeText(data.sala.pin);
    setCopiedPin(true);
    toast.success('PIN copiado al portapapeles.');
    setTimeout(() => setCopiedPin(false), 2000);
  };

  const copyLink = () => {
    if (!data?.sala?.pin) return;
    const url = `${window.location.origin}/room/${data.sala.pin}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast.success('Enlace de ingreso copiado.');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleStartRoom = async () => {
    setActionLoading(true);
    try {
      const res = await startRoom(salaId, selectedMinutes);
      if (res.success) {
        toast.success(`Ronda 1 abierta con ${selectedMinutes} minutos.`);
        await fetchStatus();
      } else {
        toast.error(res.error || 'No fue posible abrir la ronda.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al abrir la ronda.';
      toast.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCloseManually = async () => {
    setConfirmCloseOpen(false);
    setActionLoading(true);
    try {
      const res = await closeRoundManually(salaId);
      if (res.success) {
        toast.success('Votación cerrada. Resultados calculados.');
        await fetchStatus();
      } else {
        toast.error(res.error || 'No fue posible cerrar la votación.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cerrar la votación.';
      toast.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleExtendDeadline = async () => {
    setActionLoading(true);
    try {
      const res = await extendDeadline(salaId, selectedMinutes);
      if (res.success) {
        toast.success(`Hora límite extendida en +${selectedMinutes} minutos.`);
        await fetchStatus();
      } else {
        toast.error(res.error || 'No fue posible extender la hora límite.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al extender la hora límite.';
      toast.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleExtendDeadlineWithMinutes = async (mins: number) => {
    setActionLoading(true);
    try {
      const res = await extendDeadline(salaId, mins);
      if (res.success) {
        toast.success(`Hora límite extendida.`);
        setExtendDialogOpen(false);
        await fetchStatus();
      } else {
        toast.error(res.error || 'No fue posible extender la hora límite.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al extender la hora límite.';
      toast.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelRoom = async () => {
    setConfirmCancelOpen(false);
    setActionLoading(true);
    try {
      const res = await cancelRoom(salaId);
      if (res.success) {
        toast.info('Actividad cancelada.');
        await fetchStatus();
      } else {
        toast.error(res.error || 'No fue posible cancelar la actividad.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cancelar la actividad.';
      toast.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenNextRound = async () => {
    setActionLoading(true);
    try {
      const res = await openNextRound(salaId, selectedMinutes);
      if (res.success) {
        toast.success(`Ronda ${data ? data.sala.ronda_actual + 1 : ''} abierta.`);
        await fetchStatus();
      } else {
        toast.error(res.error || 'No fue posible abrir la siguiente ronda.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al abrir la ronda.';
      toast.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetPinServerError(null);
    setResetPinTouched(true);

    const err = validateResetPin(newPinValue);
    if (err) {
      setResetPinError(err);
      resetPinInputRef.current?.focus();
      return;
    }

    try {
      const res = await resetParticipantPin(salaId, resetPinModal.partId, newPinValue);
      if (res.success) {
        toast.success(`PIN de ${resetPinModal.nickname} actualizado.`);
        setResetPinModal({ open: false, partId: '', nickname: '' });
        setNewPinValue('');
        setResetPinTouched(false);
        setResetPinError(null);
      } else {
        setResetPinServerError(res.error || 'No fue posible restablecer el PIN.');
        resetPinInputRef.current?.focus();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar el PIN.';
      setResetPinServerError(msg);
      resetPinInputRef.current?.focus();
    }
  };

  const handleExpelSubmit = async () => {
    if (!expelModal.partId) return;
    setExpelLoading(true);
    setExpelServerError(null);
    try {
      const res = await expelParticipant(salaId, expelModal.partId);
      if (res.success) {
        toast.info(`Participante ${expelModal.nickname} expulsado de la sala.`);
        setExpelModal({ open: false, partId: '', nickname: '' });
        await fetchStatus();
      } else {
        setExpelServerError(res.error || 'No fue posible expulsar al participante.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al expulsar al participante.';
      setExpelServerError(msg);
    } finally {
      setExpelLoading(false);
    }
  };

  if (loading) {
    return <RoomDashboardSkeleton />;
  }

  if (!data) {
    return (
      <div className="p-8 text-center border border-[#D9D5CC] bg-white rounded-[6px]">
        <p className="text-xs text-[#5A554E]">Sala no encontrada.</p>
        <Link href="/dashboard" className="text-xs text-[#E4572E] font-medium mt-2 inline-block hover:underline">
          Volver a salas
        </Link>
      </div>
    );
  }

  const { sala, votesThisRound: votesCount, voterIds = [] } = data;
  const totalParticipants = sala.participantes?.length || 0;
  const minRequired = MIN_PARTICIPANTS;
  const stateLabel = STATE_LABELS[sala.estado] || sala.estado;
  const stateClass = STATE_CLASSES[sala.estado] || 'text-[#14171A]';

  const deadlineDate = sala.deadline ? new Date(sala.deadline) : null;
  const deadlineHour = deadlineDate
    ? deadlineDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  // Último reporte para nivel de acuerdo y detalle técnico
  const latestReport = sala.reportes?.[sala.reportes.length - 1] || null;
  const tauStar = latestReport?.tau_obtenido != null ? latestReport.tau_obtenido : null;
  const agreementPct = tauStar != null ? Math.round(tauStar * 100) : 0;
  const requiredPct = Math.round(sala.tau_umbral * 100);

  // Formato para empates en el ranking colectivo
  const formatRankLabel = (midRank: number, index: number, entries: RankingEntry[]) => {
    const tied = entries.filter((e) => Math.abs(e.midRank - midRank) < 0.001);
    if (tied.length > 1) {
      const positions = tied
        .map((t) => entries.indexOf(t) + 1)
        .sort((a, b) => a - b);
      return `${positions[0]}.º y ${positions[positions.length - 1]}.º empatadas`;
    }
    return `${index + 1}.º`;
  };

  return (
    <div className="w-full space-y-6">
      {/* 1. Barra superior: Volver y Estado siempre visible arriba */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#D9D5CC]">
        <nav aria-label="Migas de pan" className="flex items-center gap-2 text-xs">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-[#5A554E] hover:text-[#14171A] hover:underline transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>Volver a salas</span>
          </Link>
          <span className="text-[#D9D5CC]" aria-hidden="true">/</span>
          <span className="font-mono font-bold text-[#14171A]" aria-current="page">
            Sala {sala.pin}
          </span>
        </nav>

        {/* Estado siempre visible como etiqueta de texto con cronómetro */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#5A554E]">Estado:</span>
          <span className={`text-xs ${stateClass}`}>
            {stateLabel}
          </span>
          {remainingTime && sala.estado === 'ROUND_OPEN' && (
            <span
              className={`font-mono text-xs font-bold px-2 py-0.5 rounded-[4px] border ${
                remainingTime === 'Votación cerrada'
                  ? 'bg-[#B42318]/10 text-[#B42318] border-[#B42318]/30'
                  : 'bg-[#2F7D4F]/10 text-[#2F7D4F] border-[#2F7D4F]/30'
              }`}
            >
              {remainingTime}
            </span>
          )}
        </div>
      </div>

      {/* 2. Cabecera de la sala: Título, PIN, Enlace y Metadatos */}
      <div className="pb-6 border-b border-[#D9D5CC]">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1.5 flex-1">
            <h1 className="font-heading text-2xl font-bold text-[#14171A] tracking-tight">
              {sala.titulo}
            </h1>
            <p className="text-xs text-[#5A554E]">
              Regla de agregación: {sala.metodo} · {sala.proyectos.length} opciones · Ronda {sala.ronda_actual} de {sala.max_rondas}
              {deadlineHour ? ` · Hora límite: ${deadlineHour}` : ''}
            </p>
            <RoomSettingsSummary room={sala} />
          </div>

          {/* Bloque sobrio de PIN y Enlace */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyPin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border border-[#D9D5CC] bg-white text-xs font-mono text-[#14171A] hover:bg-[#EBE7DF] transition-colors"
            >
              {copiedPin ? <Check className="w-3.5 h-3.5 stroke-[1.5] text-[#2F7D4F]" /> : <Copy className="w-3.5 h-3.5 stroke-[1.5]" />}
              <span>PIN {sala.pin}</span>
            </button>

            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border border-[#D9D5CC] bg-white text-xs font-sans text-[#14171A] hover:bg-[#EBE7DF] transition-colors"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 stroke-[1.5] text-[#2F7D4F]" /> : <Copy className="w-3.5 h-3.5 stroke-[1.5]" />}
              <span>Copiar enlace</span>
            </button>
          </div>
        </div>
      </div>

      {sala.access_mode === 'ROSTER' && (
        <div className="py-6 border-b border-[#D9D5CC]">
          <RoomRosterManager roomId={sala.id} roomPin={sala.pin} readOnly={sala.estado === 'CONCLUDED' || sala.estado === 'CANCELLED'} />
        </div>
      )}

      {/* 3. Acción Principal según el estado (una sola acción principal visible; secundarias en texto plano) */}
      <div className="pb-6 border-b border-[#D9D5CC]">
        {/* BORRADOR (DRAFT) */}
        {sala.estado === 'DRAFT' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-[#14171A]">
                Iniciar votación
              </h2>
              <p className="text-xs text-[#5A554E] mt-0.5">
                La sala está en borrador. Define el plazo de la Ronda 1 para que los participantes comiencen a votar.
              </p>
            </div>

            <DurationPicker
              value={selectedMinutes}
              onChange={setSelectedMinutes}
              serverTime={data?.serverTime}
              label="Duración de la Ronda 1"
            />

            <div>
              <button
                type="button"
                onClick={handleStartRoom}
                disabled={actionLoading || selectedMinutes < 1 || selectedMinutes > 10080}
                className="px-4 py-2 rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 text-white text-xs font-semibold transition-colors disabled:opacity-40"
              >
                {actionLoading ? 'Iniciando...' : 'Abrir votación Ronda 1'}
              </button>
            </div>
          </div>
        )}

        {/* VOTACIÓN ABIERTA (ROUND_OPEN) */}
        {sala.estado === 'ROUND_OPEN' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-[#14171A]">
                Votación de la Ronda {sala.ronda_actual} en curso
              </h2>
              <p className="text-xs text-[#5A554E] mt-0.5">
                Votos recibidos: {votesCount} de {totalParticipants} participantes. Hora límite fijada: {deadlineHour || 'Sin hora límite'}.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              {/* ÚNICA ACCIÓN PRINCIPAL */}
              <button
                type="button"
                onClick={() => setConfirmCloseOpen(true)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 text-white text-xs font-semibold transition-colors disabled:opacity-40"
              >
                Cerrar votación
              </button>

              {/* Acciones secundarias en texto plano */}
              <button
                type="button"
                onClick={() => {
                  setExtendMinutes(15);
                  setExtendDialogOpen(true);
                }}
                disabled={actionLoading}
                className="text-xs text-[#5A554E] hover:text-[#14171A] hover:underline"
              >
                Extender hora límite
              </button>

              <button
                type="button"
                onClick={() => setConfirmCancelOpen(true)}
                disabled={actionLoading}
                className="text-xs text-[#B42318] hover:underline ml-auto"
              >
                Cancelar actividad
              </button>
            </div>
          </div>
        )}

        {/* FALTAN VOTOS (INSUFFICIENT_VOTES / QUORUM_UNMET) */}
        {(sala.estado === 'INSUFFICIENT_VOTES' || sala.estado === 'QUORUM_UNMET') && (
          <div className="p-4 rounded-[6px] border border-[#B42318]/30 bg-white space-y-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 stroke-[1.5] text-[#B42318] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="text-xs font-semibold text-[#B42318] block">
                  Faltan votos
                </span>
                <p className="text-xs text-[#14171A] leading-relaxed">
                  Votaron {votesCount} de {totalParticipants} participantes. Se necesitan al menos {minRequired} para calcular el resultado.
                </p>
              </div>
            </div>

            <DurationPicker
              value={selectedMinutes}
              onChange={setSelectedMinutes}
              serverTime={data?.serverTime}
              label="Tiempo adicional para extender"
            />

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => handleExtendDeadlineWithMinutes(selectedMinutes)}
                disabled={actionLoading || selectedMinutes < 1 || selectedMinutes > 10080}
                className="px-3.5 py-1.5 rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 text-white text-xs font-semibold transition-colors disabled:opacity-40"
              >
                Extender hora límite
              </button>

              <button
                type="button"
                onClick={() => setConfirmCancelOpen(true)}
                disabled={actionLoading}
                className="px-3.5 py-1.5 rounded-[6px] border border-[#D9D5CC] bg-white text-xs text-[#B42318] hover:bg-[#B42318]/10 transition-colors"
              >
                Cancelar actividad
              </button>
            </div>
          </div>
        )}

        {/* REVISIÓN DE ARGUMENTOS (ROUND_FEEDBACK) */}
        {sala.estado === 'ROUND_FEEDBACK' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-[#14171A]">
                Revisión de argumentos de la Ronda {sala.ronda_actual}
              </h2>
              <p className="text-xs text-[#5A554E] mt-0.5">
                Los participantes están consultando los argumentos de los demás. Puedes habilitar la siguiente ronda de reordenación.
              </p>
            </div>

            {sala.ronda_actual < sala.max_rondas ? (
              <div className="space-y-4">
                <DurationPicker
                  value={selectedMinutes}
                  onChange={setSelectedMinutes}
                  serverTime={data?.serverTime}
                  label={`Plazo para la Ronda ${sala.ronda_actual + 1}`}
                />

                <div className="flex flex-wrap items-center gap-4">
                  {/* ÚNICA ACCIÓN PRINCIPAL */}
                  <button
                    type="button"
                    onClick={handleOpenNextRound}
                    disabled={actionLoading || selectedMinutes < 1 || selectedMinutes > 10080}
                    className="px-4 py-2 rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 text-white text-xs font-semibold transition-colors disabled:opacity-40"
                  >
                    {actionLoading ? 'Abriendo...' : `Abrir Ronda ${sala.ronda_actual + 1}`}
                  </button>

                  {/* Acción secundaria en texto plano */}
                  <button
                    type="button"
                    onClick={() => setConfirmCancelOpen(true)}
                    disabled={actionLoading}
                    className="text-xs text-[#B42318] hover:underline ml-auto"
                  >
                    Cancelar actividad
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[#5A554E]">
                Se ha completado el máximo de rondas programadas ({sala.max_rondas}).
              </p>
            )}
          </div>
        )}

        {/* FINALIZADA (CONCLUDED) */}
        {sala.estado === 'CONCLUDED' && (
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#14171A]">
              Actividad finalizada
            </h2>
            <p className="text-xs text-[#5A554E]">
              El proceso concluyó tras {sala.ronda_actual} rondas. Los datos y argumentos recopilados se conservan en modo de lectura.
            </p>
          </div>
        )}

        {/* CANCELADA (CANCELLED) */}
        {sala.estado === 'CANCELLED' && (
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#B42318]">
              Actividad cancelada
            </h2>
            <p className="text-xs text-[#6B6860]">
              La actividad fue cancelada por el anfitrión. Los datos de las rondas completadas se conservan en modo de lectura.
            </p>
          </div>
        )}

        {/* CALCULANDO RESULTADOS (PROCESSING) */}
        {sala.estado === 'PROCESSING' && (
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#14171A]">
              Calculando resultados
            </h2>
            <p className="text-xs text-[#5A554E]">
              El motor de agregación está procesando las boletas y el consenso ordinal de esta ronda.
            </p>
          </div>
        )}
      </div>

      {/* 4. Nivel de Acuerdo y Detalle Técnico */}
      <section className="pb-6 border-b border-[#D9D5CC] space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-[#14171A]">
            Nivel de acuerdo
          </h2>
          <p className="text-xs text-[#5A554E] mt-0.5">
            Porcentaje de consenso alcanzado frente al acuerdo requerido.
          </p>
        </div>

        {tauStar != null ? (
          <div className="border border-[#D9D5CC] bg-white rounded-[6px] p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold text-[#14171A]">
                  {agreementPct}%
                </span>
                <span className="text-xs text-[#5A554E]">
                  (requerido: {requiredPct}%)
                </span>
              </div>
              <span className={`text-xs font-semibold ${agreementPct >= requiredPct ? 'text-[#2F7D4F]' : 'text-[#B7791F]'}`}>
                {agreementPct >= requiredPct ? 'Meta cumplida' : 'Bajo la meta'}
              </span>
            </div>

            {/* Barra simple de una sola serie contra el requerido */}
            <div className="w-full bg-[#EBE7DF] h-3 rounded-[4px] overflow-hidden relative">
              <div
                className="h-full bg-[#E4572E] transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, agreementPct))}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono text-[#5A554E]">
              <span>0%</span>
              <span>Meta: {requiredPct}%</span>
              <span>100%</span>
            </div>
          </div>
        ) : (
          <div className="border border-[#D9D5CC] bg-white rounded-[6px] p-4 text-xs text-[#5A554E]">
            El nivel de acuerdo se calculará cuando se cierre la votación de la ronda y se procesen los votos recibidos.
          </div>
        )}

        {/* Sección plegable "Detalle técnico" */}
        <details className="group border border-[#D9D5CC] rounded-[6px] bg-white p-3.5">
          <summary className="flex items-center justify-between cursor-pointer text-xs font-semibold text-[#14171A] select-none">
            <span>Detalle técnico</span>
            <ChevronDown className="w-4 h-4 stroke-[1.5] text-[#5A554E] group-open:rotate-180 transition-transform" />
          </summary>
          <div className="mt-3 pt-3 border-t border-[#D9D5CC] text-xs text-[#5A554E] space-y-2 font-mono">
            <div>
              <span className="text-[#14171A] font-semibold">Nivel de acuerdo (coeficiente exacto):</span>{' '}
              {tauStar != null ? tauStar.toFixed(4) : 'Pendiente de cálculo'}
            </div>
            <div>
              <span className="text-[#14171A] font-semibold">Votos recibidos:</span>{' '}
              {latestReport?.m_efectivo ?? votesCount} participantes
            </div>
            <div>
              <span className="text-[#14171A] font-semibold">Regla de agregación:</span>{' '}
              {sala.metodo}
            </div>
            <p className="font-sans text-[11px] text-[#5A554E] pt-1">
              El nivel de acuerdo mide la concordancia entre los participantes considerando empates y posiciones promedio.
            </p>
          </div>
        </details>
      </section>

      {/* 5. Orden del Grupo (si hay reporte) u Opciones de la sala */}
      <section className="pb-6 border-b border-[#D9D5CC] space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[#14171A]">
            {latestReport ? 'Orden del grupo' : 'Opciones de la sala'}
          </h2>
          <p className="text-xs text-[#5A554E] mt-0.5">
            {latestReport
              ? 'Posiciones colectivas agregadas a partir de las boletas recibidas.'
              : 'Opciones registradas que los participantes ordenarán.'}
          </p>
        </div>

        {latestReport ? (
          <div className="overflow-x-auto border border-[#D9D5CC] rounded-[6px] bg-white">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D9D5CC] bg-[#F6F4EF]/60 text-[#5A554E] font-mono text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-40">Posición</th>
                  <th className="py-2.5 px-3 w-24">Rango</th>
                  <th className="py-2.5 px-3">Opción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D9D5CC]">
                {latestReport.ranking_colectivo.map((item, idx) => {
                  const proj = sala.proyectos.find((p) => p.id === item.id);
                  const title = proj ? proj.titulo : item.titulo || `Opción ${idx + 1}`;
                  const rankLabel = formatRankLabel(
                    item.midRank,
                    idx,
                    latestReport.ranking_colectivo
                  );

                  return (
                    <tr key={item.id} className="hover:bg-[#F6F4EF]/50">
                      <td className="py-2.5 px-3 font-semibold text-[#14171A]">
                        {rankLabel}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#14171A]">
                        {item.midRank.toFixed(1)}
                      </td>
                      <td className="py-2.5 px-3 text-[#14171A]">
                        <span className="font-medium">{title}</span>
                        {proj?.descripcion && (
                          <span className="block text-[11px] text-[#5A554E] mt-0.5">
                            {proj.descripcion}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#D9D5CC] rounded-[6px] bg-white">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D9D5CC] bg-[#F6F4EF]/60 text-[#5A554E] font-mono text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-16">#</th>
                  <th className="py-2.5 px-3">Título</th>
                  <th className="py-2.5 px-3">Descripción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D9D5CC]">
                {sala.proyectos.map((p, idx) => (
                  <tr key={p.id} className="hover:bg-[#F6F4EF]/50">
                    <td className="py-2.5 px-3 font-mono font-bold text-[#14171A]">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-[#14171A]">
                      {p.titulo}
                    </td>
                    <td className="py-2.5 px-3 text-[#5A554E]">
                      {p.descripcion}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="pb-6 border-b border-[#D9D5CC]">
        <ParticipationTable roomId={sala.id} refreshKey={`${sala.estado}:${sala.ronda_actual}:${votesCount}:${totalParticipants}`} />
      </div>

      {/* 6. Tabla Densa de Participantes */}
      <section className="pb-6 border-b border-[#D9D5CC] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#14171A]">
              Participantes ({totalParticipants})
            </h2>
            <p className="text-xs text-[#5A554E] mt-0.5">
              Identificadores anónimos y estado de voto en la ronda actual.
            </p>
          </div>
        </div>

        {totalParticipants === 0 ? (
          <div className="border border-[#D9D5CC] bg-white rounded-[6px] p-6 text-center text-xs text-[#5A554E]">
            Aún no se han unido participantes con el PIN <strong>{sala.pin}</strong>.
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#D9D5CC] rounded-[6px] bg-white">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D9D5CC] bg-[#F6F4EF]/60 text-[#5A554E] font-mono text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3">Nombre</th>
                  <th className="py-2.5 px-3 w-36">Estado</th>
                  <th className="py-2.5 px-3 w-56 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D9D5CC]">
                {sala.participantes.map((p) => {
                  const didVote = voterIds.includes(p.id);

                  return (
                    <tr key={p.id} className="hover:bg-[#F6F4EF]/50">
                      <td className="py-2.5 px-3 font-medium text-[#14171A]">
                        {p.nickname}
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {didVote ? (
                          <span className="text-[#2F7D4F] font-semibold">Votó</span>
                        ) : (
                          <span className="text-[#5A554E]">Pendiente</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-3">
                        {/* "Restablecer PIN" como botón de texto plano */}
                        <button
                          type="button"
                          onClick={() =>
                            setResetPinModal({
                              open: true,
                              partId: p.id,
                              nickname: p.nickname,
                            })
                          }
                          className="text-xs text-[#14171A] hover:underline hover:text-[#E4572E] font-medium"
                        >
                          Restablecer PIN
                        </button>
                        {/* "Expulsar de la sala" como botón de texto plano (AUD-13, 14, D2, D3) */}
                        <button
                          type="button"
                          onClick={() => {
                            setExpelServerError(null);
                            setExpelModal({
                              open: true,
                              partId: p.id,
                              nickname: p.nickname,
                            });
                          }}
                          className="text-xs text-[#B42318] hover:underline font-medium"
                        >
                          Expulsar de la sala
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 7. Dos botones planos de exportación */}
      <section className="space-y-3 pt-2">
        <div>
          <h2 className="text-sm font-semibold text-[#14171A]">
            Exportaciones
          </h2>
          <p className="text-xs text-[#5A554E] mt-0.5">
            Descarga las matrices de datos para análisis externo en R o Python.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`/api/rooms/${salaId}/export/long`}
            download="matriz_long.csv"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[6px] border border-[#D9D5CC] bg-white hover:bg-[#EBE7DF] text-[#14171A] text-xs font-mono transition-colors"
          >
            <Download className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>matriz_long.csv</span>
          </a>

          <a
            href={`/api/rooms/${salaId}/export/wide`}
            download="matriz_wide_metricas.csv"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[6px] border border-[#D9D5CC] bg-white hover:bg-[#EBE7DF] text-[#14171A] text-xs font-mono transition-colors"
          >
            <Download className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>matriz_wide_metricas.csv</span>
          </a>

          {[
            { path: 'reasons', name: 'razones.csv' },
            { path: 'events', name: 'eventos.csv' },
          ].map((f) => (
            <a
              key={f.path}
              href={`/api/rooms/${salaId}/export/${f.path}`}
              download={f.name}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[6px] border border-[#D9D5CC] bg-white hover:bg-[#EBE7DF] text-[#14171A] text-xs font-mono transition-colors"
            >
              <Download className="w-3.5 h-3.5 stroke-[1.5]" />
              <span>{f.name}</span>
            </a>
          ))}
        </div>
      </section>

      {/* 8. Diálogos con Radix UI Dialog */}

      {/* Diálogo: Confirmar cierre manual */}
      <Dialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <DialogContent>
          <div className="space-y-4">
            <DialogTitle>
              ¿Cerrar votación de la ronda?
            </DialogTitle>
            <DialogDescription>
              Se detendrá la recepción de votos y se calcularán los resultados de esta ronda con las boletas recibidas hasta el momento.
            </DialogDescription>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmCloseOpen(false)}
                className="text-xs text-[#5A554E] hover:text-[#14171A]"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleCloseManually}
                className="px-3.5 py-2 rounded-[6px] bg-[#E4572E] text-white text-xs font-semibold hover:bg-[#E4572E]/90"
              >
                Cerrar y calcular
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diálogo: Confirmar cancelación de la actividad */}
      <Dialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <DialogContent>
          <div className="space-y-4">
            <DialogTitle className="text-[#B42318]">
              ¿Cancelar actividad?
            </DialogTitle>
            <DialogDescription>
              La sala se marcará como cancelada y no recibirá más votos. Esta acción es definitiva.
            </DialogDescription>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmCancelOpen(false)}
                className="text-xs text-[#5A554E] hover:text-[#14171A]"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleCancelRoom}
                className="px-3.5 py-2 rounded-[6px] bg-[#B42318] text-white text-xs font-semibold hover:bg-[#B42318]/90"
              >
                Cancelar sala
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diálogo: Restablecer PIN */}
      <Dialog
        open={resetPinModal.open}
        onOpenChange={(open) => {
          if (!open) {
            setResetPinModal({ open: false, partId: '', nickname: '' });
            setNewPinValue('');
            setResetPinTouched(false);
            setResetPinError(null);
            setResetPinServerError(null);
          }
        }}
      >
        <DialogContent>
          <div className="space-y-4">
            <DialogTitle>
              Restablecer PIN de {resetPinModal.nickname}
            </DialogTitle>
            <DialogDescription>
              Ingresa el nuevo PIN de 4 dígitos para este participante.
            </DialogDescription>

            <form onSubmit={handleResetPinSubmit} className="space-y-3" noValidate>
              <div>
                <PasswordInput
                  ref={resetPinInputRef}
                  isPin
                  placeholder="4 dígitos"
                  value={newPinValue}
                  onChange={(e) => {
                    const next = e.target.value.replace(/\D/g, '');
                    setNewPinValue(next);
                    setResetPinServerError(null);
                    if (resetPinTouched) {
                      setResetPinError(validateResetPin(next));
                    }
                  }}
                  onBlur={() => {
                    setResetPinTouched(true);
                    setResetPinError(validateResetPin(newPinValue));
                  }}
                  aria-invalid={Boolean(resetPinServerError || (resetPinTouched && resetPinError))}
                  aria-describedby={
                    resetPinServerError || (resetPinTouched && resetPinError)
                      ? 'reset-pin-error'
                      : undefined
                  }
                  className={`h-11 text-lg font-bold pl-11 ${
                    resetPinServerError || (resetPinTouched && resetPinError)
                      ? 'border-[#B42318] focus:border-[#B42318]'
                      : 'border-[#D9D5CC] focus:border-[#E4572E]'
                  }`}
                />
                {(resetPinServerError || (resetPinTouched && resetPinError)) && (
                  <p
                    id="reset-pin-error"
                    role="alert"
                    className="text-xs text-[#B42318] mt-1.5 flex items-center justify-center gap-1"
                  >
                    <AlertCircle className="w-3.5 h-3.5 stroke-[1.5] shrink-0" />
                    <span>{resetPinServerError || resetPinError}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setResetPinModal({ open: false, partId: '', nickname: '' });
                    setNewPinValue('');
                    setResetPinTouched(false);
                    setResetPinError(null);
                    setResetPinServerError(null);
                  }}
                  className="text-xs text-[#5A554E] hover:text-[#14171A]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={Boolean(
                    (resetPinTouched && resetPinError) ||
                    resetPinServerError ||
                    newPinValue.length !== 4
                  )}
                  className="px-3.5 py-2 rounded-[6px] bg-[#E4572E] text-white text-xs font-semibold hover:bg-[#E4572E]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Guardar PIN
                </button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diálogo: Extender hora límite */}
      <Dialog open={extendDialogOpen} onOpenChange={setExtendDialogOpen}>
        <DialogContent className="max-w-[480px]">
          <div className="space-y-4">
            <DialogTitle>Extender hora límite</DialogTitle>
            <DialogDescription>
              Selecciona cuántos minutos adicionales conceder para la votación en curso.
            </DialogDescription>
            <div className="py-2">
              <DurationPicker
                value={extendMinutes}
                onChange={setExtendMinutes}
                mode="from_deadline"
                baseDeadline={sala.deadline}
                serverTime={data?.serverTime}
                label="Tiempo adicional"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#D9D5CC]">
              <button
                type="button"
                onClick={() => setExtendDialogOpen(false)}
                className="px-3.5 py-1.5 rounded-[6px] border border-[#D9D5CC] bg-white text-xs text-[#5A554E] hover:bg-[#EBE7DF] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={actionLoading || extendMinutes < 1 || extendMinutes > 10080}
                onClick={() => handleExtendDeadlineWithMinutes(extendMinutes)}
                className="px-4 py-1.5 rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 text-white text-xs font-semibold transition-colors disabled:opacity-40"
              >
                {actionLoading ? 'Guardando...' : 'Confirmar extensión'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diálogo: Expulsar participante de la sala (AUD-13, 14, D2, D3) */}
      <Dialog
        open={expelModal.open}
        onOpenChange={(open) => {
          if (!open) {
            setExpelModal({ open: false, partId: '', nickname: '' });
            setExpelServerError(null);
          }
        }}
      >
        <DialogContent className="max-w-[460px]">
          <div className="space-y-4">
            <DialogTitle>
              Expulsar a {expelModal.nickname}
            </DialogTitle>
            <DialogDescription>
              El participante quedará excluido de la sala y no podrá volver a ingresar. Sus votos de rondas cerradas se conservarán, pero los votos de la ronda activa se eliminarán.
            </DialogDescription>

            {/* D3: Advertencia crítica si quedan menos de 3 participantes */}
            {totalParticipants - 1 < 3 && (
              <div
                role="alert"
                className="p-3 bg-[#B42318]/10 border border-[#B42318]/30 rounded-[6px] text-xs text-[#B42318] flex items-start gap-2 leading-relaxed"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Advertencia: al expulsar a este participante quedarán menos de 3 participantes activos. Se necesitan al menos 3 participantes para poder calcular el resultado del grupo.
                </span>
              </div>
            )}

            {expelServerError && (
              <p role="alert" className="text-xs text-[#B42318]">
                {expelServerError}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setExpelModal({ open: false, partId: '', nickname: '' });
                  setExpelServerError(null);
                }}
                disabled={expelLoading}
                className="text-xs text-[#5A554E] hover:text-[#14171A]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExpelSubmit}
                disabled={expelLoading}
                className="px-3.5 py-2 rounded-[6px] bg-[#B42318] text-white text-xs font-semibold hover:bg-[#B42318]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {expelLoading ? 'Expulsando...' : 'Expulsar de la sala'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
