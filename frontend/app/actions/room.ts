'use server';

/**
 * app/actions/room.ts
 * Server actions: thin web adapters over @mic/backend/services/room.
 * Each one builds the request context (IP, sessions, host, revalidation)
 * and calls the service with the same arguments. No business logic here.
 */

import * as service from '@mic/backend/services/room';
import { requestContext } from '@/lib/request-context';

export type { EstadoSala, CreateRoomInput, MappedParticipantItem, MappedReportItem, MappedRoomDetails, RoomStatusData, RoomMemberItem, IssuedMemberCode, ParticipationState, ParticipationRow, ParticipationData, ActionResult } from '@mic/backend/services/room';

/** Arguments of a service function after its request context */
type Args<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export async function createRoom(...args: Args<typeof service.createRoom>) {
  return service.createRoom(requestContext(), ...args);
}

export async function startRoom(...args: Args<typeof service.startRoom>) {
  return service.startRoom(requestContext(), ...args);
}

export async function closeRoundManually(...args: Args<typeof service.closeRoundManually>) {
  return service.closeRoundManually(requestContext(), ...args);
}

export async function extendDeadline(...args: Args<typeof service.extendDeadline>) {
  return service.extendDeadline(requestContext(), ...args);
}

export async function cancelRoom(...args: Args<typeof service.cancelRoom>) {
  return service.cancelRoom(requestContext(), ...args);
}

export async function openNextRound(...args: Args<typeof service.openNextRound>) {
  return service.openNextRound(requestContext(), ...args);
}

export async function getRoomStatus(...args: Args<typeof service.getRoomStatus>) {
  return service.getRoomStatus(requestContext(), ...args);
}

export async function resetParticipantPin(...args: Args<typeof service.resetParticipantPin>) {
  return service.resetParticipantPin(requestContext(), ...args);
}

export async function expelParticipant(...args: Args<typeof service.expelParticipant>) {
  return service.expelParticipant(requestContext(), ...args);
}

export async function reinstateParticipant(...args: Args<typeof service.reinstateParticipant>) {
  return service.reinstateParticipant(requestContext(), ...args);
}

export async function addRoomMember(...args: Args<typeof service.addRoomMember>) {
  return service.addRoomMember(requestContext(), ...args);
}

export async function importRoomMembers(...args: Args<typeof service.importRoomMembers>) {
  return service.importRoomMembers(requestContext(), ...args);
}

export async function getRoomMembers(...args: Args<typeof service.getRoomMembers>) {
  return service.getRoomMembers(requestContext(), ...args);
}

export async function removeRoomMember(...args: Args<typeof service.removeRoomMember>) {
  return service.removeRoomMember(requestContext(), ...args);
}

export async function regenerateMemberCode(...args: Args<typeof service.regenerateMemberCode>) {
  return service.regenerateMemberCode(requestContext(), ...args);
}

export async function getRoomParticipation(...args: Args<typeof service.getRoomParticipation>) {
  return service.getRoomParticipation(requestContext(), ...args);
}
