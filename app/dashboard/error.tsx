'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="w-full max-w-2xl p-6 rounded-[6px] border border-[#B42318]/30 bg-white space-y-4 my-8">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-[#B42318] stroke-[1.5] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h2 className="font-heading text-base font-bold text-[#14171A]">
            Error al cargar el panel de control
          </h2>
          <p className="text-xs text-[#5A554E] leading-relaxed">
            No se pudieron obtener los datos de la sala o del anfitrión.
          </p>
        </div>
      </div>

      {error?.digest && (
        <div className="p-2 rounded-[4px] bg-[#F6F4EF] border border-[#D9D5CC] font-mono text-[11px] text-[#5A554E]">
          Referencia: {error.digest}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 text-white text-xs font-semibold transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 stroke-[1.5]" />
          <span>Reintentar</span>
        </button>
        <Link
          href="/dashboard"
          className="text-xs text-[#5A554E] hover:text-[#14171A] underline underline-offset-2"
        >
          Volver a mis salas
        </Link>
      </div>
    </div>
  );
}
