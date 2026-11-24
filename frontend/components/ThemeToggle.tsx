'use client';

/**
 * components/ThemeToggle.tsx
 * Dark theme by default; this button switches to light and back. The choice is
 * remembered per browser (localStorage "theme"); app/layout.tsx applies it
 * before the first paint, so the page never flashes the other theme.
 */

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Toaster } from 'sonner';

export type Theme = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'theme';

/** Inline script for <head>: light only when the person chose it. */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='light'){document.documentElement.classList.remove('dark')}}catch(e){}`;

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still changes for this visit
  }
  window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

/** Current theme, kept in sync when any toggle changes it. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => {
    setTheme(currentTheme());
    const onChange = () => setTheme(currentTheme());
    window.addEventListener('themechange', onChange);
    return () => window.removeEventListener('themechange', onChange);
  }, []);
  return theme;
}

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  return (
    <button
      type="button"
      onClick={() => applyTheme(next)}
      className={`min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-[6px] text-ink-2 hover:text-ink hover:bg-subtle transition-colors ${className}`}
      aria-label={label}
      title={label}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4 stroke-[1.5]" aria-hidden="true" /> : <Moon className="w-4 h-4 stroke-[1.5]" aria-hidden="true" />}
    </button>
  );
}

/** Notifications in the current theme. */
export function ThemedToaster() {
  const theme = useTheme();
  return <Toaster position="top-right" theme={theme} closeButton />;
}
