import type { Metadata } from 'next';
import './globals.css';
import AuthProvider from '@/components/AuthProvider';
import Navbar from '@/components/Navbar';
import { Toaster } from 'sonner';
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { cn } from '@/lib/utils';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GDSS r-FAST-CR | Consenso Grupal Multirronda',
  description: 'Sistema Web de Consenso Grupal Multirronda Asíncrono para Toma de Decisiones',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={cn(fraunces.variable, ibmPlexSans.variable, ibmPlexMono.variable)}
    >
      <body className="min-h-screen bg-background text-foreground font-sans antialiased flex flex-col">
        <AuthProvider>
          <Navbar />
          <div className="flex-1 flex flex-col">{children}</div>
          <Toaster position="top-right" theme="light" closeButton />
        </AuthProvider>
      </body>
    </html>
  );
}
