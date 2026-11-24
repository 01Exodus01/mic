import Link from 'next/link';
import { AlertCircle, ArrowLeft } from 'lucide-react';

interface AuthErrorPageProps {
  searchParams?: {
    error?: string;
  };
}

export default function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const errorType = searchParams?.error;

  const getMessage = (type?: string) => {
    switch (type) {
      case 'CredentialsSignin':
        return 'Las credenciales proporcionadas no son válidas o tu cuenta está bloqueada temporalmente.';
      case 'AccessDenied':
        return 'No tienes permisos para acceder a este recurso.';
      case 'Configuration':
        return 'Hay un problema con la configuración de autenticación del sistema.';
      default:
        return 'No fue posible iniciar sesión o la sesión ha expirado.';
    }
  };

  return (
    <main className="flex-1 flex items-center justify-center p-4 sm:p-6 min-h-[60vh]">
      <div className="w-full max-w-sm p-6 sm:p-8 rounded-[6px] border border-line bg-paper space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-[6px] bg-danger/10 text-danger shrink-0 mt-0.5">
            <AlertCircle className="w-5 h-5 stroke-[1.5]" />
          </div>
          <div className="space-y-1">
            <h1 className="font-heading text-lg font-bold text-ink">
              Error de autenticación
            </h1>
            <p className="text-xs text-ink-2 leading-relaxed">
              {getMessage(errorType)}
            </p>
          </div>
        </div>

        {errorType && (
          <div className="p-2.5 rounded-[4px] bg-canvas border border-line font-mono text-[11px] text-ink-2">
            Motivo: {errorType}
          </div>
        )}

        <div className="pt-2">
          <Link
            href="/auth/login"
            className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 rounded-[6px] bg-brand hover:bg-brand/90 text-white text-xs font-semibold transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>Volver a iniciar sesión</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
