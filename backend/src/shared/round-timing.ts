/**
 * backend/src/shared/round-timing.ts
 * How long a round lasts: no deadline (the default: the host closes it, or it
 * closes when everyone sent if the group asks for that), a duration in minutes,
 * or an exact closing date and time chosen on a calendar. Same rule on the
 * server and in the browser for the last two:
 * the round ends at least 1 minute and at most 30 days after its start
 * (now, the current deadline when extending, or the scheduled opening).
 */

import { z } from 'zod';
import { MAX_ROUND_MINUTES, RoundDurationSchema } from './validations';

/** No deadline: the round stays open until the host closes it (or everyone sent, with early close) */
export const NO_DEADLINE = { noDeadline: true } as const;
export type RoundTiming = number | { closesAt: string } | { noDeadline: true };

export const RoundTimingSchema = z.union([
  z.object({ noDeadline: z.literal(true) }),
  RoundDurationSchema,
  z.object({
    closesAt: z.string({ invalid_type_error: 'Elige la fecha y hora de cierre.' }).datetime({
      offset: true,
      message: 'Elige la fecha y hora de cierre.',
    }),
  }),
]);

export interface ResolvedRoundEnd {
  /** null: no deadline */
  deadline: Date | null;
  /** Whole minutes between the start and the deadline (for the log and the export); null without deadline */
  minutes: number | null;
  /** 'date' when the host picked the closing date and time; 'none' without deadline */
  timing: 'duration' | 'date' | 'none';
}

export function isNoDeadline(timing: unknown): timing is { noDeadline: true } {
  return typeof timing === 'object' && timing !== null && (timing as { noDeadline?: unknown }).noDeadline === true;
}

const MINUTE = 60 * 1000;

/**
 * Deadline for a round that starts (or is extended) at `base`.
 * `baseLabel` names the base in the error message ("ahora" / "la hora límite actual").
 */
export function resolveRoundEnd(
  timing: unknown,
  base: Date,
  baseLabel: 'ahora' | 'la hora límite actual' | 'la hora de inicio' = 'ahora'
): { ok: true; value: ResolvedRoundEnd } | { ok: false; error: string } {
  const parsed = RoundTimingSchema.safeParse(timing);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message || 'Duración inválida.' };
  }
  if (isNoDeadline(parsed.data)) {
    return { ok: true, value: { deadline: null, minutes: null, timing: 'none' } };
  }
  if (typeof parsed.data === 'number') {
    return {
      ok: true,
      value: { deadline: new Date(base.getTime() + parsed.data * MINUTE), minutes: parsed.data, timing: 'duration' },
    };
  }
  const deadline = new Date(parsed.data.closesAt);
  const diff = deadline.getTime() - base.getTime();
  if (diff < MINUTE) {
    return { ok: false, error: `La hora de cierre tiene que ser al menos un minuto después de ${baseLabel}.` };
  }
  if (diff > MAX_ROUND_MINUTES * MINUTE) {
    return { ok: false, error: 'La ronda puede durar hasta 30 días.' };
  }
  return { ok: true, value: { deadline, minutes: Math.round(diff / MINUTE), timing: 'date' } };
}
