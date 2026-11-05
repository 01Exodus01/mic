/**
 * lib/participant-session.ts
 * Zero-PII participant session management.
 *
 * Participants authenticate with:
 *   1. Room PIN (6 chars) — identifies the room
 *   2. Nickname (display name)
 *   3. 4-digit personal PIN (bcrypt hashed in DB)
 *
 * A signed JWT is stored in an HttpOnly, SameSite=Strict cookie.
 * The cookie payload contains: { participantId, roomId, nickname, blindCode }
 *
 * No email, real name, or PII is ever stored or transmitted.
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { env } from '@mic/backend/env';

const COOKIE_NAME = 'gdss_participant_session';
const LEGACY_COOKIE_NAME = 'gdss_student_session';
const COOKIE_MAX_AGE = 12 * 60 * 60; // 12 hours
function getParticipantSecret(): Uint8Array {
  return new TextEncoder().encode(env.PARTICIPANT_SESSION_SECRET);
}

export interface ParticipantSessionPayload {
  participantId: string;
  roomId: string;
  nickname: string;
  /** Participant.session_version when the session was created (PIN reset / code regeneration raise it) */
  sessionVersion?: number;
  blindCode: string;
}

/**
 * Creates and sets a signed participant session cookie.
 */
export async function createParticipantSession(payload: ParticipantSessionPayload): Promise<void> {
  const normalizedPayload = {
    ...payload,
    roomId: payload.roomId,
  };

  const token = await new SignJWT(normalizedPayload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_MAX_AGE}s`)
    .sign(getParticipantSecret());

  const isSecure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecure,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

/**
 * Reads and verifies the participant session cookie.
 * Returns null if missing, expired, or tampered.
 */
export async function getParticipantSession(): Promise<ParticipantSessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value || cookieStore.get(LEGACY_COOKIE_NAME)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getParticipantSecret());
    const parsed = payload as unknown as ParticipantSessionPayload;
    if (!parsed || typeof parsed.roomId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Clears the participant session cookie (logout).
 */
export async function clearParticipantSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: COOKIE_NAME, path: '/' });
  cookieStore.delete({ name: LEGACY_COOKIE_NAME, path: '/' });
  // Also delete legacy path if set
  cookieStore.delete({ name: COOKIE_NAME, path: '/participant' });
  cookieStore.delete({ name: LEGACY_COOKIE_NAME, path: '/participant' });
}
