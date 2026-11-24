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
    <div className="w-full max-w-2xl p-6 rounded-[6px] border border-danger/30 bg-paper space-y-4 my-8">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-danger stroke-[1.5] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h2 className="font-heading text-base font-bold text-ink">
            Error al cargar el panel de control
          </h2>
          <p className="text-xs text-ink-2 leading-relaxed">
            No se pudieron obtener los datos del grupo o del anfitrión.
          </p>
        </div>
      </div>

      {error?.digest && (
        <div className="p-2 rounded-[4px] bg-canvas border border-line font-mono text-[11px] text-ink-2">
          Referencia: {error.digest}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] bg-brand hover:bg-brand/90 text-white text-xs font-semibold transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 stroke-[1.5]" />
          <span>Reintentar</span>
        </button>
        <Link
          href="/dashboard"
          className="text-xs text-ink-2 hover:text-ink underline underline-offset-2"
        >
          Volver a mis grupos
        </Link>
      </div>
    </div>
  );
}
