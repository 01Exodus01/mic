/**
 * frontend/__tests__/utils/rankingHasTies.test.ts
 * The host results table shows the "Rango" (mid-rank) column only with ties.
 */

import { describe, it, expect } from 'vitest';
import { rankingHasTies } from '@/lib/ranking';

describe('rankingHasTies', () => {
  it('sin empates: posiciones enteras distintas', () => {
    expect(rankingHasTies([{ midRank: 1 }, { midRank: 2 }, { midRank: 3 }])).toBe(false);
  });

  it('con empates: rangos medios repetidos o fraccionarios', () => {
    expect(rankingHasTies([{ midRank: 1.5 }, { midRank: 1.5 }, { midRank: 3 }])).toBe(true);
    expect(rankingHasTies([{ midRank: 2 }, { midRank: 2 }, { midRank: 2 }])).toBe(true);
  });
});
