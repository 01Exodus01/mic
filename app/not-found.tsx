import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="flex-1 flex items-center justify-center p-4 sm:p-6 min-h-[60vh]">
      <div className="w-full max-w-md p-6 sm:p-8 rounded-[6px] border border-[#D9D5CC] bg-white space-y-4">
        <span className="font-mono text-xs font-semibold text-[#E4572E] tracking-wider uppercase">
          Error 404
        </span>
        <h1 className="font-heading text-xl font-bold text-[#14171A]">
          Página no encontrada
        </h1>
        <p className="text-xs text-[#5A554E] leading-relaxed">
          La página solicitada no existe, ha sido movida o el enlace es incorrecto.
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-[6px] bg-[#E4572E] hover:bg-[#E4572E]/90 text-white text-xs font-semibold transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>Volver al inicio</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
