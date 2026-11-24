'use client';

/**
 * app/dashboard/rooms/[id]/edit/page.tsx
 * Edit a group before round 1: the creation form with the group's values.
 * Once round 1 has opened it sends the host back to the group.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getRoomStatus } from '@/app/actions/room';
import RoomForm, { type RoomFormInitial } from '@/components/RoomForm';

interface EditableRoom {
  title: string;
  method: RoomFormInitial['method'];
  max_members: number;
  tau_threshold: number;
  max_rounds: number;
  status: string;
  access_mode: 'OPEN_PIN' | 'ROSTER';
  allow_late_join: boolean;
  close_when_all_voted: boolean;
  consent_required: boolean;
  consent_text: string | null;
  options: Array<{ id: string; title: string; description: string; order_index: number }>;
}

export default function EditRoomPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const roomId = params.id;
  const [initial, setInitial] = useState<RoomFormInitial | null>(null);

  useEffect(() => {
    let active = true;
    getRoomStatus(roomId).then((res) => {
      if (!active) return;
      if (!res.success || !res.data) {
        toast.error(res.success ? 'No se encontró el grupo.' : res.error || 'No se encontró el grupo.');
        router.push('/dashboard');
        return;
      }
      const room = res.data.room as unknown as EditableRoom;
      if (room.status !== 'DRAFT') {
        toast.info('La configuración solo se puede cambiar antes de abrir la Ronda 1.');
        router.push(`/dashboard/rooms/${roomId}`);
        return;
      }
      setInitial({
        title: room.title,
        method: room.method,
        maxMembers: room.max_members,
        tauThreshold: Math.round(room.tau_threshold * 100),
        maxRounds: room.max_rounds,
        options: [...room.options]
          .sort((a, b) => a.order_index - b.order_index)
          .map((o) => ({ id: o.id, title: o.title, description: o.description })),
        settings: {
          accessMode: room.access_mode,
          allowLateJoin: room.allow_late_join,
          closeWhenAllVoted: room.close_when_all_voted,
          consentRequired: room.consent_required,
          consentText: room.consent_text ?? '',
        },
      });
    });
    return () => {
      active = false;
    };
  }, [roomId, router]);

  if (!initial) return <div className="h-40 rounded-[6px] bg-subtle" aria-hidden="true" />;
  return <RoomForm roomId={roomId} initial={initial} />;
}
