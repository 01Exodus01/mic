'use server';

/**
 * app/actions/auth.ts
 * Server actions: thin web adapters over @mic/backend/services/auth.
 * Each one builds the request context (IP, sessions, host, revalidation)
 * and calls the service with the same arguments. No business logic here.
 */

import * as service from '@mic/backend/services/auth';
import { requestContext } from '@/lib/request-context';

export type { RegisterResult } from '@mic/backend/services/auth';

/** Arguments of a service function after its request context */
type Args<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;

export async function registerHost(...args: Args<typeof service.registerHost>) {
  return service.registerHost(requestContext(), ...args);
}
