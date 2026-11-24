'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Plus } from 'lucide-react';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();

  const navItems = [
    {
      href: '/dashboard',
      label: 'Salas',
      icon: LayoutDashboard,
      active: pathname === '/dashboard',
    },
    {
      href: '/dashboard/rooms/new',
      label: 'Nueva sala',
      icon: Plus,
      active: pathname === '/dashboard/rooms/new',
    },
  ];

  return (
    <div className="flex-1 flex flex-col md:flex-row bg-canvas">
      {/* Sidebar fija angosta (escritorio >= 768px) */}
      <aside className="hidden md:flex md:w-52 md:flex-col justify-between fixed top-14 bottom-0 left-0 border-r border-line bg-canvas p-4 z-20">
        <div>
          <div className="text-[11px] font-mono text-ink-3 mb-3 px-2">
            Conectado como anfitrión
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-[6px] text-xs font-sans transition-colors ${
                    item.active
                      ? 'bg-subtle text-ink font-semibold'
                      : 'text-ink-3 hover:text-ink hover:bg-subtle/60'
                  }`}
                >
                  <Icon className="w-4 h-4 stroke-[1.5]" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="pt-4 border-t border-line space-y-2">
          <div className="text-[11px] font-mono text-ink-3 px-3">
            v1.0 · GDSS
          </div>
        </div>
      </aside>

      {/* Sub-navegación compacta horizontal en móvil (< 768px) */}
      <div className="md:hidden border-b border-line bg-canvas px-4 py-2 flex items-center justify-between gap-2 overflow-x-auto text-xs">
        <div className="flex items-center gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border transition-colors whitespace-nowrap ${
                  item.active
                    ? 'border-ink bg-subtle text-ink font-semibold'
                    : 'border-line text-ink-3 bg-paper'
                }`}
              >
                <Icon className="w-3.5 h-3.5 stroke-[1.5]" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
        <span className="text-[11px] font-mono text-ink-3 whitespace-nowrap">
          Conectado como anfitrión
        </span>
      </div>

      {/* Contenido alineado a la izquierda, max-width 1100px */}
      <div className="flex-1 md:ml-52 flex flex-col items-start min-h-[calc(100vh-3.5rem)]">
        <div className="w-full max-w-[1100px] p-4 sm:p-8 text-left">
          {children}
        </div>
      </div>
    </div>
  );
}
