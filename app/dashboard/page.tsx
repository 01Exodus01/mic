import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import prisma from '@mic/backend/db';
import Link from 'next/link';
import { Plus, ArrowRight } from 'lucide-react';

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
  CONCLUDED: 'text-[#2F7D4F]',
  CANCELLED: 'text-[#B42318]',
};

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect('/auth/login');
  }

  const hostId = (session.user as { id: string }).id;

  const rooms = await prisma.room.findMany({
    where: { host_id: hostId },
    include: {
      options: { select: { id: true } },
      participants: { select: { id: true } },
      reports: {
        orderBy: { round: 'desc' },
        take: 1,
        select: { round: true, obtained_tau: true },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  return (
    <div className="w-full">
      {/* Cabecera sobria del anfitrión */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4 pb-6 mb-6 border-b border-[#D9D5CC]">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#14171A] tracking-tight">
            Salas de votación
          </h1>
          <p className="text-xs text-[#5A554E] mt-1">
            Panel de control del anfitrión. Administra las salas grupales y el avance de rondas.
          </p>
        </div>

        <Link
          href="/dashboard/rooms/new"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[6px] bg-[#E4572E] text-white text-xs font-semibold hover:bg-[#E4572E]/90 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[1.5]" />
          <span>Nueva sala</span>
        </Link>
      </div>

      {/* Lista de salas como tabla densa (no tarjetas) */}
      {rooms.length === 0 ? (
        <div className="border border-[#D9D5CC] bg-white rounded-[6px] p-8 text-center">
          <p className="text-xs text-[#5A554E] mb-3">No hay salas creadas.</p>
          <Link
            href="/dashboard/rooms/new"
            className="inline-flex items-center gap-1.5 text-xs text-[#E4572E] font-semibold hover:underline"
          >
            <span>Crear la primera sala</span>
            <ArrowRight className="w-3.5 h-3.5 stroke-[1.5]" />
          </Link>
        </div>
      ) : (
        <div className="border border-[#D9D5CC] bg-white rounded-[6px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#D9D5CC] bg-[#F6F4EF]/60 text-[#5A554E] font-mono text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-20">PIN</th>
                  <th className="py-2.5 px-3">Título</th>
                  <th className="py-2.5 px-3 w-24">Opciones</th>
                  <th className="py-2.5 px-3 w-20">Ronda</th>
                  <th className="py-2.5 px-3 w-28">Participantes</th>
                  <th className="py-2.5 px-3 w-32">Acuerdo</th>
                  <th className="py-2.5 px-3 w-36">Estado</th>
                  <th className="py-2.5 px-3 w-20 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D9D5CC]">
                {rooms.map((room) => {
                  const stateLabel = STATE_LABELS[room.status] || room.status;
                  const stateClass = STATE_CLASSES[room.status] || 'text-[#14171A]';
                  const latestReport = room.reports[0];
                  const agreementText = latestReport?.obtained_tau != null
                    ? `${Math.round(latestReport.obtained_tau * 100)}%`
                    : '—';

                  return (
                    <tr
                      key={room.id}
                      className="hover:bg-[#F6F4EF]/50 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-[#14171A]">
                        {room.pin}
                      </td>
                      <td className="py-2.5 px-3">
                        <Link
                          href={`/dashboard/rooms/${room.id}`}
                          className="font-medium text-[#14171A] hover:text-[#E4572E] transition-colors"
                        >
                          {room.title}
                        </Link>
                      </td>
                      <td className="py-2.5 px-3 text-[#5A554E] font-mono">
                        {room.options.length}
                      </td>
                      <td className="py-2.5 px-3 text-[#14171A] font-mono">
                        {room.current_round} / {room.max_rounds}
                      </td>
                      <td className="py-2.5 px-3 text-[#14171A] font-mono">
                        {room.participants.length} / {room.max_members}
                      </td>
                      <td className="py-2.5 px-3 text-[#14171A] font-mono">
                        {agreementText}
                      </td>
                      <td className="py-2.5 px-3">
                        {/* Estado como etiqueta de texto plana */}
                        <span className={`inline-block ${stateClass}`}>
                          {stateLabel}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Link
                          href={`/dashboard/rooms/${room.id}`}
                          className="text-[#E4572E] hover:underline font-medium"
                        >
                          Ver sala
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
