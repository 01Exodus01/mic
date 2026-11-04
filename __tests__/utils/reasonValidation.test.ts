/**
 * __tests__/utils/reasonValidation.test.ts
 * PT-13: optional reasons for and against each option.
 * 0 to 5 per side, each 1 to 200 characters after trimming; empty ones dropped;
 * kept verbatim otherwise.
 */

import { describe, it, expect } from 'vitest';
import { SingleVoteEntrySchema, MAX_REASONS_PER_SIDE, REASON_MAX_LENGTH } from '@/lib/validations';

const base = { optionId: 'opt-1', position: 1 };

describe('PT-13: razones opcionales a favor y en contra', () => {
  it('usa el tope de 5 por lado y 200 caracteres', () => {
    expect(MAX_REASONS_PER_SIDE).toBe(5);
    expect(REASON_MAX_LENGTH).toBe(200);
  });

  it('acepta un voto con todas las razones vacías y las descarta', () => {
    const res = SingleVoteEntrySchema.safeParse({ ...base, reasonsFor: ['', '   '], reasonsAgainst: ['\t'] });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.reasonsFor).toEqual([]);
      expect(res.data.reasonsAgainst).toEqual([]);
    }
  });

  it('acepta razones de un solo carácter y conserva el texto tal cual, salvo los extremos', () => {
    const res = SingleVoteEntrySchema.safeParse({
      ...base,
      reasonsFor: ['  x  ', 'Mantiene  dos espacios internos y MAYÚSCULAS'],
      reasonsAgainst: ['Costo alto'],
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.reasonsFor).toEqual(['x', 'Mantiene  dos espacios internos y MAYÚSCULAS']);
      expect(res.data.reasonsAgainst).toEqual(['Costo alto']);
    }
  });

  it('acepta 5 razones por lado y rechaza 6', () => {
    const five = Array.from({ length: 5 }, (_, i) => `Razón ${i + 1}`);
    expect(SingleVoteEntrySchema.safeParse({ ...base, reasonsFor: five, reasonsAgainst: five }).success).toBe(true);
    const six = [...five, 'Sexta'];
    const res = SingleVoteEntrySchema.safeParse({ ...base, reasonsAgainst: six });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.errors[0]?.message).toMatch(/Máximo 5 razones por lado/);
  });

  it('las vacías no cuentan para el tope', () => {
    const list = ['a', '', 'b', ' ', 'c', 'd', 'e', ''];
    expect(SingleVoteEntrySchema.safeParse({ ...base, reasonsFor: list }).success).toBe(true);
  });

  it('acepta 200 caracteres y rechaza 201', () => {
    expect(SingleVoteEntrySchema.safeParse({ ...base, reasonsFor: ['a'.repeat(200)] }).success).toBe(true);
    const res = SingleVoteEntrySchema.safeParse({ ...base, reasonsFor: ['a'.repeat(201)] });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.errors[0]?.message).toMatch(/Máximo 200 caracteres por razón/);
  });

  it('rechaza listas que no son texto', () => {
    expect(SingleVoteEntrySchema.safeParse({ ...base, reasonsFor: 'texto suelto' }).success).toBe(false);
    expect(SingleVoteEntrySchema.safeParse({ ...base, reasonsFor: [42] }).success).toBe(false);
  });
});
