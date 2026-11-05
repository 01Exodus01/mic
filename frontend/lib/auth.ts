/**
 * lib/auth.ts
 * NextAuth configuration for host authentication.
 * Participants use a separate Zero-PII session mechanism (see lib/participant-session.ts).
 */

import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { env } from '@mic/backend/env';
import { authenticateHost } from '@mic/backend/services/host-login';
import { requestContext } from '@/lib/request-context';

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

        // Credential check, rate limit and lockout live in the backend
        return authenticateHost(requestContext(), credentials.email, credentials.password);
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
