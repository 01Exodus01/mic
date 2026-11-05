/**
 * __tests__/navigation/roundFeedbackReport.test.tsx
 * PT-19: feedback component. Own concordance, per-option collapsible sections
 * with own and group position, and every reason verbatim with its blind code.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import RoundFeedbackReport, { formatRankPosition } from '@/components/RoundFeedbackReport';

const options = [
  { id: 'a', title: 'Huerto' },
  { id: 'b', title: 'Biblioteca' },
  { id: 'c', title: 'Torneo' },
];

const many = Array.from({ length: 40 }, (_, i) => ({
  text: `Razón número ${i + 1} con <etiqueta> y "comillas" sin acortar`,
}));

describe('PT-19: componente de retroalimentación', () => {
  it('muestra el nivel de concordancia propio y, por opción, posiciones y razones textuales', () => {
    const html = renderToStaticMarkup(
      <RoundFeedbackReport
        options={options}
        defaultOpen
        report={{
          collective_ranking: [{ id: 'a', midRank: 1.5 }, { id: 'b', midRank: 1.5 }, { id: 'c', midRank: 3 }],
          reasonsByOption: { a: { reasonsFor: many, reasonsAgainst: [{ text: 'Caro' }] } },
          myConcordance: { voted: true, cix: 0.725 },
          myPositions: { a: 2, b: 1, c: 3 },
          tieBreak: { rule: 'NONE', applied: false },
        }}
      />
    );
    expect(html).toContain('Tu nivel de concordancia');
    expect(html).toContain('73%');
    expect(html).toContain('Grupo: 1.º y 2.º empatadas');
    expect(html).toContain('Tú: 2.º');
    expect(html).toContain('<details');
    // All 40 reasons, verbatim and escaped
    for (let i = 1; i <= 40; i++) {
      expect(html).toContain(`Razón número ${i} con &lt;etiqueta&gt; y &quot;comillas&quot; sin acortar`);
    }
    expect(html).toContain('Caro');
    // Reasons are a plain list per side: no author signature or position per reason
    expect(html).not.toContain('Participante');
    expect(html).not.toContain('lugar');
    expect(html).toContain('A favor');
    expect(html).toContain('En contra');
  });

  it('si no votó muestra un aviso y si hubo desempate dice qué regla actuó', () => {
    const html = renderToStaticMarkup(
      <RoundFeedbackReport
        options={options}
        report={{
          collective_ranking: [{ id: 'a', midRank: 1 }, { id: 'b', midRank: 2 }, { id: 'c', midRank: 3 }],
          myConcordance: { voted: false, cix: null },
          tieBreak: { rule: 'LEXICOGRAPHIC', applied: true },
        }}
      />
    );
    expect(html).toContain('No votaste en esta ronda');
    expect(html).toContain('se desempataron por el orden de la lista');
    expect(html).toContain('Tú: sin voto');
  });

  it('formatea empates de tres posiciones', () => {
    const ranks = [{ id: 'a', midRank: 2 }, { id: 'b', midRank: 2 }, { id: 'c', midRank: 2 }];
    expect(formatRankPosition(2, ranks).label).toBe('1.º, 2.º y 3.º empatadas');
  });
});
