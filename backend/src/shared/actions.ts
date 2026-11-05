/**
 * types/actions.ts
 * Standard return type for Server Actions across the application.
 */

export type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string; code?: string };
