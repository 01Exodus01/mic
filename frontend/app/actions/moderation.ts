'use server';

/**
 * app/actions/moderation.ts
 * Server actions: thin web adapters over @mic/backend/services/moderation.
 */

import * as service from '@mic/backend/services/moderation';
import { requestContext } from '@/lib/request-context';

export type { ModerationData, ModerationOptionItem, ModerationReasonItem } from '@mic/backend/services/moderation';

type Args<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export async function getReasonsForModeration(...args: Args<typeof service.getReasonsForModeration>) {
  return service.getReasonsForModeration(requestContext(), ...args);
}

export async function setReasonHidden(...args: Args<typeof service.setReasonHidden>) {
  return service.setReasonHidden(requestContext(), ...args);
}
