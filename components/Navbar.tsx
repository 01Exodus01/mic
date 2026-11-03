'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { LogOut, LayoutDashboard } from 'lucide-react';

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  // En las pantallas de participante no se muestra barra de navegación (móvil primero, una acción por pantalla)
  if (
    pathname === '/join' ||
    pathname.startsWith('/sala') ||
    pathname.startsWith('/room') ||
    pathname.startsWith('/student') ||
    pathname.startsWith('/participant')
  ) {
    return null;
  }

  return (
    <header className="border-b border-[#D9D5CC] bg-[#F6F4EF] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-heading text-lg font-bold text-[#14171A] tracking-tight">GDSS</span>
          <span className="hidden sm:inline-block text-xs font-mono uppercase tracking-wider text-[#5A554E] border border-[#D9D5CC] px-2 py-0.5 rounded-[999px]">
            r-FAST-CR
          </span>
        </Link>

        <nav className="flex items-center gap-3">
          <Link
            href="/join"
            className="text-xs font-medium text-[#14171A] hover:text-[#E4572E] transition-colors"
          >
            Ingresar a sala
          </Link>

          {session?.user ? (
            <div className="flex items-center gap-2 sm:gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#14171A] hover:text-[#E4572E] px-2.5 py-1.5 rounded-[6px] border border-[#D9D5CC] bg-white hover:bg-[#EBE7DF] transition-colors"
              >
                <LayoutDashboard className="w-3.5 h-3.5 stroke-[1.5]" />
                <span className="hidden sm:inline">Panel de anfitrión</span>
              </Link>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/' })}
                className="inline-flex items-center gap-1 text-xs text-[#B42318] p-1.5 rounded-[6px] hover:bg-[#B42318]/10 transition-colors"
                title="Cerrar sesión"
              >
                <LogOut className="w-3.5 h-3.5 stroke-[1.5]" />
              </button>
            </div>
          ) : (
            <Link
              href="/auth/login"
              className="inline-flex items-center text-xs font-semibold text-[#14171A] hover:text-[#E4572E] px-3 py-1.5 rounded-[6px] border border-[#D9D5CC] bg-white hover:bg-[#EBE7DF] transition-colors"
            >
              Acceso anfitrión
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
