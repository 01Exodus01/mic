/**
 * lib/auth.ts
 * NextAuth configuration for host authentication.
 * Participants use a separate Zero-PII session mechanism (see lib/participant-session.ts).
 */

import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { checkLockout, recordFailedAttempt, resetFailedAttempts } from './rate-limit';

import { env } from './env';

const isHttps = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const useSecure = isHttps;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credenciales Anfitrión',
      credentials: {
        email: { label: 'Correo electrónico', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        let clientIp = '127.0.0.1';
        try {
          const { headers } = await import('next/headers');
          const hdrs = await headers();
          const { getClientIp } = await import('./rate-limit');
          clientIp = getClientIp(hdrs);
        } catch {
          // Fallback if headers context is unavailable
        }

        const normalizedEmail = credentials.email.toLowerCase().trim();
        // Rate limit and lockout keyed by ip:email to prevent account lockout DoS (AUD-27)
        const lockoutKey = `host_login:${clientIp}:${normalizedEmail}`;

        // Verify temporal lockout
        const lockout = checkLockout(lockoutKey);
        if (lockout.isLocked) {
          throw new Error(`Acceso bloqueado por demasiados intentos fallidos. Reintenta en ${lockout.remainingSec} segundos.`);
        }

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (!user) {
          recordFailedAttempt(lockoutKey, 5, 900);
          return null;
        }

        const passwordValid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!passwordValid) {
          const attempt = recordFailedAttempt(lockoutKey, 5, 900);
          if (attempt.isLocked) {
            throw new Error('Demasiados intentos fallidos. Acceso bloqueado temporalmente por 15 minutos.');
          }
          return null;
        }

        // Authentication succeeded: clear lockout counter
        resetFailedAttempts(lockoutKey);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
  jwt: {
    maxAge: 8 * 60 * 60,
  },
  useSecureCookies: useSecure,
  cookies: {
    sessionToken: {
      name: useSecure ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: useSecure,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === 'string') {
        session.user.id = token.id;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/login',
    error: '/auth/error',
  },
  secret: env.NEXTAUTH_SECRET,
};
