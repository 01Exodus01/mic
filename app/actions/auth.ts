/**
 * app/actions/auth.ts
 * Server Actions for host account management.
 */

'use server';

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { RegisterHostSchema, HostInviteCodeSchema } from '@/lib/validations';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { getHostInviteCode } from '@/lib/env';
import { headers } from 'next/headers';
import type { ActionResult } from '@/types/actions';

export type RegisterResult = ActionResult;

const INVITE_CODE_ERROR = 'No se pudo crear la cuenta con ese código de invitación.';

function inviteCodeMatches(candidate: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(candidate, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Registers a new host account with strict Zod validation.
 * Requires the invite code from HOST_INVITE_CODE; without it registration is closed.
 * Password is hashed with bcrypt cost=10.
 */
export async function registerHost(
  name: string,
  email: string,
  password: string,
  inviteCode: string
): Promise<ActionResult> {
  try {
    const hdrs = await headers();
    const ip = getClientIp(hdrs);
    const rl = checkRateLimit(`register:${ip}`, 5, 60);
    if (!rl.allowed) {
      return { success: false, error: `Demasiadas solicitudes. Reintenta en ${rl.resetIn} segundos.` };
    }

    const expectedCode = getHostInviteCode();
    const codeValidation = HostInviteCodeSchema.safeParse(inviteCode);
    if (!expectedCode || !codeValidation.success || !inviteCodeMatches(codeValidation.data, expectedCode)) {
      return { success: false, error: INVITE_CODE_ERROR };
    }

    const validation = RegisterHostSchema.safeParse({ name, email, password });
    if (!validation.success) {
      const firstError = validation.error.errors[0]?.message || 'Datos de registro inválidos.';
      return { success: false, error: firstError };
    }

    const validated = validation.data;

    const existing = await prisma.user.findUnique({ where: { email: validated.email } });
    if (existing) {
      return { success: false, error: 'El correo ya está registrado.' };
    }

    const passwordHash = await bcrypt.hash(validated.password, 10);
    await prisma.user.create({
      data: {
        name: validated.name,
        email: validated.email,
        password_hash: passwordHash,
      },
    });

    return { success: true };
  } catch {
    return { success: false, error: 'Error al registrar la cuenta.' };
  }
}
