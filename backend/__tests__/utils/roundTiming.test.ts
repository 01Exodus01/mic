/**
 * backend/__tests__/utils/roundTiming.test.ts
 * A round lasts a duration in minutes or until an exact closing date and time;
 * either way between 1 minute and 30 days after its start.
 */

import { describe, it, expect } from 'vitest';
import { resolveRoundEnd } from '@mic/backend/shared/round-timing';

const base = new Date('2026-11-05T15:00:00.000Z');
const at = (iso: string) => ({ closesAt: iso });

describe('duración o fecha de cierre de una ronda', () => {
  it('con minutos, la hora límite es el inicio más esos minutos', () => {
    const res = resolveRoundEnd(90, base);
    expect(res).toEqual({ ok: true, value: { deadline: new Date('2026-11-05T16:30:00.000Z'), minutes: 90, timing: 'duration' } });
  });

  it('con una fecha, la hora límite es exactamente esa fecha', () => {
    const res = resolveRoundEnd(at('2026-11-07T23:59:00.000Z'), base);
    expect(res.ok && res.value.deadline.toISOString()).toBe('2026-11-07T23:59:00.000Z');
    expect(res.ok && res.value).toMatchObject({ minutes: 3419, timing: 'date' });
  });

  it('acepta fechas con zona horaria (lo que manda el navegador)', () => {
    const res = resolveRoundEnd(at('2026-11-05T13:30:00-03:00'), base);
    expect(res.ok && res.value).toMatchObject({ minutes: 90, timing: 'date' });
  });

  it('rechaza una fecha pasada o a menos de un minuto', () => {
    expect(resolveRoundEnd(at('2026-11-05T14:00:00.000Z'), base)).toEqual({
      ok: false,
      error: 'La hora de cierre tiene que ser al menos un minuto después de ahora.',
    });
    expect(resolveRoundEnd(at('2026-11-05T15:00:30.000Z'), base).ok).toBe(false);
    expect(resolveRoundEnd(at('2026-11-05T15:01:00.000Z'), base).ok).toBe(true);
  });

  it('al extender, la nueva fecha debe ser posterior a la hora límite actual', () => {
    expect(resolveRoundEnd(at('2026-11-05T14:59:00.000Z'), base, 'la hora límite actual')).toEqual({
      ok: false,
      error: 'La hora de cierre tiene que ser al menos un minuto después de la hora límite actual.',
    });
  });

  it('rechaza más de 30 días y valores sin forma de fecha', () => {
    expect(resolveRoundEnd(at('2026-12-05T15:01:00.000Z'), base)).toEqual({ ok: false, error: 'La ronda puede durar hasta 30 días.' });
    expect(resolveRoundEnd(at('2026-12-05T15:00:00.000Z'), base).ok).toBe(true);
    expect(resolveRoundEnd(at('mañana'), base).ok).toBe(false);
    expect(resolveRoundEnd({ closesAt: 5 }, base).ok).toBe(false);
    expect(resolveRoundEnd(0, base).ok).toBe(false);
    expect(resolveRoundEnd(43201, base).ok).toBe(false);
  });
});
