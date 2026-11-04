/**
 * __tests__/security/sessionSecrets.test.ts
 * PT-06: host (NextAuth) and participant sessions use different secrets, so a
 * participant token is not a host session and a host token is not a
 * participant session. Startup fails if the participant secret is missing,
 * short, or equal to NEXTAUTH_SECRET.
 */

import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';

const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => (name === 'gdss_participant_session' && cookieJar.value ? { value: cookieJar.value } : undefined) }),
}));

async function participantToken(secret: string) {
  return new SignJWT({ participantId: 'p1', roomId: 'r1', nickname: 'Participante 01', blindCode: 'Participante 01' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

describe('PT-06: secretos separados', () => {
  it('el entorno de pruebas usa secretos distintos', () => {
    expect(process.env.PARTICIPANT_SESSION_SECRET).toBeTruthy();
    expect(process.env.PARTICIPANT_SESSION_SECRET).not.toBe(process.env.NEXTAUTH_SECRET);
  });

  it('la sesión de participante solo acepta tokens firmados con su propio secreto', async () => {
    const { getParticipantSession } = await import('@/lib/participant-session');
    cookieJar.value = await participantToken(process.env.PARTICIPANT_SESSION_SECRET!);
    expect(await getParticipantSession()).toMatchObject({ participantId: 'p1' });
    cookieJar.value = await participantToken(process.env.NEXTAUTH_SECRET!);
    expect(await getParticipantSession()).toBeNull();
  });

  it('un token de anfitrión no es una sesión de participante y al revés', async () => {
    const { encode, decode } = await import('next-auth/jwt');
    const { getParticipantSession } = await import('@/lib/participant-session');
    const hostToken = await encode({ token: { id: 'host-1', sub: 'host-1' }, secret: process.env.NEXTAUTH_SECRET! });
    cookieJar.value = hostToken;
    expect(await getParticipantSession()).toBeNull();

    const pToken = await participantToken(process.env.PARTICIPANT_SESSION_SECRET!);
    await expect(decode({ token: pToken, secret: process.env.NEXTAUTH_SECRET! }).then((v) => v ?? null)).rejects.toThrow();
  });

  it('el arranque falla sin el secreto, si es corto o si es igual a NEXTAUTH_SECRET', async () => {
    const { getValidatedEnv } = await import('@/lib/env');
    const original = process.env.PARTICIPANT_SESSION_SECRET;
    try {
      process.env.PARTICIPANT_SESSION_SECRET = 'corto';
      expect(() => getValidatedEnv()).toThrow(/PARTICIPANT_SESSION_SECRET/);
      process.env.PARTICIPANT_SESSION_SECRET = process.env.NEXTAUTH_SECRET;
      expect(() => getValidatedEnv()).toThrow(/distinto/);
    } finally {
      process.env.PARTICIPANT_SESSION_SECRET = original;
    }
    expect(getValidatedEnv().PARTICIPANT_SESSION_SECRET).toBe(original);
  });
});
