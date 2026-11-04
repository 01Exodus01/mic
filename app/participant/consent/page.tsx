'use client';

/**
 * app/participant/consent/page.tsx
 * Informed consent on the first entry to a room that asks for it (PT-24).
 * Accepting is required to vote; the server enforces it too.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { acceptConsent, getParticipantRoomView, logoutParticipant } from '@/app/actions/participant';
import { ParticipantVoteSkeleton } from '@/components/ui/Skeleton';

interface ConsentView {
  sala: { titulo: string };
  session: { blindCode: string };
  consent: { required: boolean; accepted: boolean; text: string | null };
}

export default function ParticipantConsentPage() {
  const router = useRouter();
  const [data, setData] = useState<ConsentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await getParticipantRoomView();
    if (!res.success || !res.data) {
      router.push('/join');
      return;
    }
    const view = res.data as unknown as ConsentView;
    if (!view.consent.required || view.consent.accepted) {
      router.push('/participant/vote');
      return;
    }
    setData(view);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await acceptConsent();
      if (res.success) {
        router.push('/participant/vote');
      } else {
        setError(res.error || 'No se pudo guardar tu aceptación. Intenta de nuevo.');
      }
    } finally {
      setSaving(false);
    }
  };

  const leave = async () => {
    await logoutParticipant().catch(() => undefined);
    router.push('/join');
  };

  if (!data) return <ParticipantVoteSkeleton />;

  return (
    <main className="flex-1 max-w-[540px] w-full mx-auto px-4 pt-6 pb-16">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#D9D5CC] text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[#5A554E]">{data.session.blindCode}</span>
          <span className="text-[#D9D5CC]">·</span>
          <span className="text-[#5A554E]">Conectado como participante</span>
        </div>
        <button type="button" onClick={leave} className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-1.5 text-[#5A554E] hover:text-[#B42318]">
          <LogOut className="w-3.5 h-3.5 stroke-[1.5]" />
          <span>Salir</span>
        </button>
      </div>

      <p className="text-xs text-[#5A554E] font-mono mb-1">{data.sala.titulo}</p>
      <h1 className="font-heading text-2xl font-bold text-[#14171A] leading-tight">Consentimiento informado</h1>
      <p className="text-xs text-[#5A554E] mt-2">Lee el texto. Para votar tienes que aceptarlo. Podrás volver a leerlo después.</p>

      <div className="mt-4 p-4 rounded-[6px] border border-[#D9D5CC] bg-white text-sm text-[#14171A] leading-relaxed whitespace-pre-wrap break-words">
        {data.consent.text}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-[#B42318]">
          {error}
        </p>
      )}

      <div className="mt-6 space-y-2">
        <button
          type="button"
          onClick={accept}
          disabled={saving}
          className="w-full h-[52px] rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 disabled:opacity-50 text-white font-medium text-base"
        >
          {saving ? 'Guardando...' : 'Acepto y quiero participar'}
        </button>
        <button type="button" onClick={leave} className="w-full min-h-[44px] text-xs text-[#5A554E] hover:text-[#14171A]">
          No acepto, salir de la sala
        </button>
      </div>
    </main>
  );
}
