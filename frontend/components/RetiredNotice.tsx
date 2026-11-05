'use client';

/**
 * components/RetiredNotice.tsx
 * Shown when the host expelled the participant (or removed them from the
 * roster) while their screen was open.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { logoutParticipant } from '@/app/actions/participant';

export default function RetiredNotice() {
  const router = useRouter();
  return (
    <main className="flex-1 max-w-[540px] w-full mx-auto px-4 pt-16 pb-16">
      <div role="alert" className="p-5 rounded-[6px] border border-[#D9D5CC] bg-white space-y-3">
        <h1 className="font-heading text-2xl font-bold text-[#14171A]">Fuiste retirado de la sala</h1>
        <p className="text-sm text-[#5A554E] leading-relaxed">
          El anfitrión te retiró de esta actividad. Ya no puedes enviar selecciones. Tus selecciones anteriores se conservan.
        </p>
        <button
          type="button"
          onClick={async () => {
            await logoutParticipant().catch(() => undefined);
            router.push('/join');
          }}
          className="min-h-[44px] px-4 rounded-[6px] bg-[#E4572E] text-white text-sm font-medium"
        >
          Salir
        </button>
      </div>
    </main>
  );
}
