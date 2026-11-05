/**
 * backend/src/services/host-login.ts
 * Host sign-in check: email + password against the stored bcrypt hash, with a
 * lockout keyed by ip:email (AUD-27). Called by NextAuth's credentials
 * provider (frontend lib/auth.ts). Kept apart from services/auth.ts on
 * purpose: that module is exposed as server actions, this one must not be.
 */

import bcrypt from 'bcryptjs';
import prisma from '@mic/backend/db';
import { checkLockout, recordFailedAttempt, resetFailedAttempts } from '@mic/backend/rate-limit';
import type { RequestContext } from './context';

export interface AuthenticatedHost {
  id: string;
  email: string;
  name: string;
}

/**
 * Returns the host when the credentials are right, null otherwise.
 * Throws (with a message for the login screen) while the lockout is active.
 */
export async function authenticateHost(
  ctx: RequestContext,
  email: string,
  password: string
): Promise<AuthenticatedHost | null> {
  let clientIp = '127.0.0.1';
  try {
    clientIp = await ctx.clientIp();
  } catch {
    // Fallback if headers context is unavailable
  }

  const normalizedEmail = email.toLowerCase().trim();
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

  const passwordValid = await bcrypt.compare(password, user.password_hash);
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
}
