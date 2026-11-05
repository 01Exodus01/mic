/**
 * backend/src/shared/round-timing.ts
 * How long a round lasts: a duration in minutes or an exact closing date and
 * time chosen on a calendar. Same rule on the server and in the browser:
 * the round ends at least 1 minute and at most 30 days after its start
 * (now, or the current deadline when extending).
 */

import { z } from 'zod';
import { MAX_ROUND_MINUTES, RoundDurationSchema } from './validations';

export type RoundTiming = number | { closesAt: string };

export const RoundTimingSchema = z.union([
  RoundDurationSchema,
  z.object({
    closesAt: z.string({ invalid_type_error: 'Elige la fecha y hora de cierre.' }).datetime({
      offset: true,
      message: 'Elige la fecha y hora de cierre.',
    }),
  }),
]);

export interface ResolvedRoundEnd {
  deadline: Date;
  /** Whole minutes between the start and the deadline (for the log and the export) */
  minutes: number;
  /** 'date' when the host picked the closing date and time */
  timing: 'duration' | 'date';
}

const MINUTE = 60 * 1000;

/**
 * Deadline for a round that starts (or is extended) at `base`.
 * `baseLabel` names the base in the error message ("ahora" / "la hora límite actual").
 */
export function resolveRoundEnd(
  timing: unknown,
  base: Date,
  baseLabel: 'ahora' | 'la hora límite actual' = 'ahora'
): { ok: true; value: ResolvedRoundEnd } | { ok: false; error: string } {
  const parsed = RoundTimingSchema.safeParse(timing);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message || 'Duración inválida.' };
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
