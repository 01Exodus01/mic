/**
 * backend/__tests__/utils/conclusion.test.ts
 * One reason for the end of the process, the same as the engine's stop rule.
 */

import { describe, it, expect } from 'vitest';
import { conclusionReason } from '@mic/backend/conclusion';

describe('motivo de término', () => {
  it('acuerdo alcanzado o máximo de rondas; nada si la sala no terminó', () => {
    expect(conclusionReason('CONCLUDED', 0.8, { obtained_tau: 0.85 })).toBe('CONSENSUS');
    expect(conclusionReason('CONCLUDED', 0.8, { obtained_tau: 0.8 })).toBe('CONSENSUS');
    expect(conclusionReason('CONCLUDED', 0.8, { obtained_tau: 0.7999 })).toBe('MAX_ROUNDS');
    expect(conclusionReason('ROUND_FEEDBACK', 0.8, { obtained_tau: 0.9 })).toBeNull();
    expect(conclusionReason('CONCLUDED', 0.8, null)).toBeNull();
  });
});
