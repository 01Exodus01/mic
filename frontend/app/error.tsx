'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <main className="flex-1 flex items-center justify-center p-4 sm:p-6 min-h-[60vh]">
      <div className="w-full max-w-md p-6 sm:p-8 rounded-[6px] border border-line bg-paper space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-[6px] bg-danger/10 text-danger shrink-0 mt-0.5">
            <AlertCircle className="w-5 h-5 stroke-[1.5]" />
          </div>
          <div className="space-y-1">
            <h1 className="font-heading text-lg font-bold text-ink">
              Ha ocurrido un error inesperado
            </h1>
            <p className="text-xs text-ink-2 leading-relaxed">
              No fue posible completar la operación. Puedes intentar recargar la vista o volver al inicio.
            </p>
          </div>
        </div>

        {error?.digest && (
          <div className="p-2.5 rounded-[4px] bg-canvas border border-line font-mono text-[11px] text-ink-2">
            Código de referencia: {error.digest}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-[6px] bg-brand hover:bg-brand/90 text-white text-xs font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>Reintentar</span>
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-4 py-2 rounded-[6px] border border-line bg-paper hover:bg-canvas text-ink text-xs font-medium transition-colors"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
