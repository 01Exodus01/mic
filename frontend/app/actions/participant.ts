'use server';

/**
 * app/actions/participant.ts
 * Server actions: thin web adapters over @mic/backend/services/participant.
 * Each one builds the request context (IP, sessions, host, revalidation)
 * and calls the service with the same arguments. No business logic here.
 */

import * as service from '@mic/backend/services/participant';
import { requestContext } from '@/lib/request-context';

export type { ParticipantRoomViewData, ParticipantRankingView, ParticipantArgumentView, ParticipantReasonView, ParticipantOptionReasonsView, ParticipantReportView, VoteEntry } from '@mic/backend/services/participant';

/** Arguments of a service function after its request context */
type Args<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export async function acceptConsent(...args: Args<typeof service.acceptConsent>) {
  return service.acceptConsent(requestContext(), ...args);
}

export async function verifyRoomPin(...args: Args<typeof service.verifyRoomPin>) {
  return service.verifyRoomPin(requestContext(), ...args);
}

export async function checkNicknameInRoom(...args: Args<typeof service.checkNicknameInRoom>) {
  return service.checkNicknameInRoom(requestContext(), ...args);
}

export async function joinRoom(...args: Args<typeof service.joinRoom>) {
  return service.joinRoom(requestContext(), ...args);
}

export async function joinRoomWithCode(...args: Args<typeof service.joinRoomWithCode>) {
  return service.joinRoomWithCode(requestContext(), ...args);
}

export async function submitVote(...args: Args<typeof service.submitVote>) {
  return service.submitVote(requestContext(), ...args);
}

export async function getParticipantRoomView(...args: Args<typeof service.getParticipantRoomView>) {
  return service.getParticipantRoomView(requestContext(), ...args);
}

export async function logoutParticipant(...args: Args<typeof service.logoutParticipant>) {
  return service.logoutParticipant(requestContext(), ...args);
}
