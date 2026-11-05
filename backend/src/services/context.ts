/**
 * backend/src/services/context.ts
 * What a service needs from the web layer, as an explicit interface. The
 * frontend builds it from the request (cookies, headers, NextAuth); tests and
 * other callers can build their own. Services never import Next.js.
 */

/** Signed participant session (cookie content). Zero PII: blind code only. */
export interface ParticipantSession {
  participantId: string;
  roomId: string;
  nickname: string;
  /** Participant.session_version when the session was created (PIN reset / code regeneration raise it) */
  sessionVersion?: number;
  blindCode: string;
}

export interface RequestContext {
  /** Client IP, for rate limits and lockouts */
  clientIp(): Promise<string>;
  /** Participant session of this request, or null */
  participantSession(): Promise<ParticipantSession | null>;
  /** Starts (or replaces) the participant session of this client */
  startParticipantSession(session: ParticipantSession): Promise<void>;
  /** Ends the participant session of this client */
  endParticipantSession(): Promise<void>;
  /** Id of the signed-in host (User), or null */
  hostUserId(): Promise<string | null>;
  /** Tells the web layer that the pages under this path show changed data */
  revalidate(path: string): void;
}

/** Protocol-neutral answer of a service behind an HTTP route. */
export interface ServiceResponse {
  status: number;
  /** string, bytes, or an object sent as JSON; null for an empty body */
  body: string | Uint8Array<ArrayBuffer> | object | null;
  headers?: Record<string, string>;
}
