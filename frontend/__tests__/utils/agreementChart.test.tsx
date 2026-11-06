/**
 * frontend/__tests__/utils/agreementChart.test.tsx
 * Host chart of the group's agreement per round: accessible description and
 * table with every round, the required agreement as a reference.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import AgreementChart from '@/components/AgreementChart';

describe('gráfico del nivel de acuerdo por ronda', () => {
  it('describe cada ronda y el acuerdo requerido, también como tabla', () => {
    const html = renderToStaticMarkup(
      <AgreementChart points={[{ round: 2, value: 0.6667 }, { round: 1, value: 0.5556 }]} threshold={0.8} maxRounds={3} />
    );
    expect(html).toContain('aria-label="Nivel de acuerdo por ronda: ronda 1 56%, ronda 2 67%. Acuerdo requerido 80%."');
    expect(html).toContain('<td>1</td><td>56%</td>');
    expect(html).toContain('<td>2</td><td>67%</td>');
    expect(html).toContain('R3');
    expect(html).toContain('stroke-dasharray="5 4"');
  });
});
