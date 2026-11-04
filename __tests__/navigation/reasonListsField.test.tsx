/**
 * __tests__/navigation/reasonListsField.test.tsx
 * PT-14: optional reason lists on the vote screen.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import ReasonListsField, {
  ReasonListsSummary,
  addReason,
  removeReason,
  updateReason,
  reasonError,
  cleanReasons,
  EMPTY_REASONS,
} from '@/components/ReasonListsField';

describe('PT-14: estado de las listas de razones', () => {
  it('agrega hasta 5 por lado y no más', () => {
    let v = EMPTY_REASONS;
    for (let i = 0; i < 7; i++) v = addReason(v, 'for');
    expect(v.for).toHaveLength(5);
    expect(v.against).toHaveLength(0);
  });

  it('edita y quita sin tocar el otro lado', () => {
    let v = addReason(addReason(addReason(EMPTY_REASONS, 'for'), 'for'), 'against');
    v = updateReason(v, 'for', 1, 'Segunda');
    v = updateReason(v, 'against', 0, 'Contra');
    v = removeReason(v, 'for', 0);
    expect(v).toEqual({ for: ['Segunda'], against: ['Contra'] });
  });

  it('las vacías se descartan al enviar y el texto se conserva', () => {
    expect(cleanReasons(['', '  ', '  Texto  con  espacios ', 'Otra'])).toEqual(['Texto  con  espacios', 'Otra']);
  });

  it('solo marca error por encima de 200 caracteres', () => {
    expect(reasonError('')).toBeNull();
    expect(reasonError('a'.repeat(200))).toBeNull();
    expect(reasonError('a'.repeat(201))).toMatch(/200/);
  });
});

describe('PT-14: render del campo', () => {
  it('muestra los dos lados, contadores y botones de 44px, sin campos obligatorios', () => {
    const html = renderToStaticMarkup(
      <ReasonListsField optionId="o1" value={{ for: ['Barata'], against: [] }} onChange={() => undefined} />
    );
    expect(html).toContain('A favor');
    expect(html).toContain('En contra');
    expect(html).toContain('Agregar razón a favor');
    expect(html).toContain('Agregar razón en contra');
    expect(html).toContain('6/200');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('min-w-[44px] min-h-[44px]');
    expect(html).not.toContain('required');
    expect(html).toContain('for="reason-o1-for-0"');
  });

  it('con 5 razones deshabilita agregar y dice por qué', () => {
    const html = renderToStaticMarkup(
      <ReasonListsField optionId="o1" value={{ for: ['1', '2', '3', '4', '5'], against: [] }} onChange={() => undefined} />
    );
    expect(html).toContain('Llegaste al máximo de 5.');
    expect(html).toMatch(/disabled=""[^>]*>.*Agregar razón a favor/s);
  });

  it('el resumen muestra todas las razones textuales y escapa el contenido', () => {
    const html = renderToStaticMarkup(
      <ReasonListsSummary value={{ for: ['<b>uno</b>', 'dos'], against: ['tres'] }} />
    );
    expect(html).toContain('&lt;b&gt;uno&lt;/b&gt;');
    expect(html).toContain('dos');
    expect(html).toContain('tres');
    expect(renderToStaticMarkup(<ReasonListsSummary value={EMPTY_REASONS} />)).toContain('Sin razones escritas.');
  });
});
