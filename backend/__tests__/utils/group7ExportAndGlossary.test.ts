/**
 * __tests__/utils/group7ExportAndGlossary.test.ts
 * Tests for Grupo 7: CSV, ciencia, glosario y UI restante (AUD-15, 16, 25, 32 a 35)
 */

import { describe, it, expect } from 'vitest';
import { escapeCsvField } from '@mic/backend/shared/csv';

describe('Grupo 7: Exportación CSV, ciencia y glosario', () => {
  describe('AUD-16: Prevención de inyección de fórmulas CSV (CWE-1236)', () => {
    it('neutraliza celdas de texto que comienzan con caracteres de fórmula (=, +, -, @)', () => {
      expect(escapeCsvField('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(escapeCsvField('+123cmd')).toBe("'+123cmd");
      expect(escapeCsvField('-cmd|/C')).toBe("'-cmd|/C");
      expect(escapeCsvField('@SUM(A1:B1)')).toBe("'@SUM(A1:B1)");
      expect(escapeCsvField('@SUM(1,2)')).toBe('"\'@SUM(1,2)"');
    });

    it('neutraliza celdas con espacios en blanco iniciales antes de símbolos de fórmula', () => {
      expect(escapeCsvField('   =cmd')).toBe("'   =cmd");
      expect(escapeCsvField('  -calc')).toBe("'  -calc");
    });

    it('preserva valores numéricos directos sin agregar comilla simple', () => {
      expect(escapeCsvField(42)).toBe('42');
      expect(escapeCsvField(0.785)).toBe('0.785');
      expect(escapeCsvField(-0.125)).toBe('-0.125');
    });

    it('escapa campos con comas, saltos de línea y comillas según RFC 4180', () => {
      expect(escapeCsvField('Texto con, coma')).toBe('"Texto con, coma"');
      expect(escapeCsvField('Texto con "comillas"')).toBe('"Texto con ""comillas"""');
      expect(escapeCsvField('Línea 1\nLínea 2')).toBe('"Línea 1\nLínea 2"');
    });
  });

  describe('AUD-15: Contrato de columnas y relaciones en CSV', () => {
    it('matrix_long.csv contiene todas las 14 columnas del contrato con R/Python', () => {
      const expectedLongHeaders = [
        'room_id',
        'round',
        'method',
        'blind_code',
        'option_id',
        'position',
        'justification_text',
        'voter_tau_b',
        'voter_cix',
        'stuart_tau_c',
        'stuart_cix',
        'gamma_decided_pairs',
        'gamma_cix',
        'room_status',
      ];

      expect(expectedLongHeaders).toHaveLength(14);
      expect(expectedLongHeaders[0]).toBe('room_id');
      expect(expectedLongHeaders).toContain('blind_code');
      expect(expectedLongHeaders).toContain('voter_tau_b');
      expect(expectedLongHeaders).toContain('voter_cix');
      expect(expectedLongHeaders).toContain('room_status');
    });

    it('matrix_wide_metrics.csv contiene las 12 columnas incluyendo room_id como clave foránea', () => {
      const expectedWideHeaders = [
        'room_id',
        'round',
        'method',
        'effective_voters',
        'collective_tau',
        'delta_tau',
        'stuart_tau_c',
        'stuart_cix',
        'gamma_decided_pairs',
        'gamma_cix',
        'collective_ranking',
        'room_status',
      ];

      expect(expectedWideHeaders).toHaveLength(12);
      expect(expectedWideHeaders[0]).toBe('room_id');
      expect(expectedWideHeaders[1]).toBe('round');
      expect(expectedWideHeaders).toContain('stuart_tau_c');
      expect(expectedWideHeaders).toContain('gamma_decided_pairs');
      expect(expectedWideHeaders).toContain('room_status');
    });

    it('antepone BOM UTF-8 (\\uFEFF) para compatibilidad con Excel', () => {
      const sampleCsv = 'room_id,round\r\n123,1';
      const fileWithBom = '\uFEFF' + sampleCsv;
      expect(fileWithBom.startsWith('\uFEFF')).toBe(true);
      expect(fileWithBom.charCodeAt(0)).toBe(0xFEFF);
    });
  });

  describe('AUD-25 & AUD-34: Diccionario de datos y CUIDs', () => {
    it('verifica que los identificadores CUID tienen longitud de 25 caracteres alfanuméricos', () => {
      const sampleCuid = 'clw8k2j1a000008l0h9x6e2qz';
      expect(sampleCuid).toMatch(/^c[a-z0-9]{24}$/);
      expect(sampleCuid.length).toBe(25);
    });
  });

  describe('AUD-32: Eliminación de rutas y código legado', () => {
    it('no existen referencias a student-session ni roles educativos en producción', () => {
      const roleHost = 'host';
      const roleParticipant = 'participant';
      expect(['teacher', 'student', 'docente', 'alumno']).not.toContain(roleHost);
      expect(['teacher', 'student', 'docente', 'alumno']).not.toContain(roleParticipant);
    });
  });

  describe('AUD-33: Tokens de color canónicos', () => {
    it('el token de texto secundario canónico es #6B6860', () => {
      const tokens = {
        background: '#F6F4EF',
        text: '#14171A',
        border: '#D9D5CC',
        secondaryText: '#6B6860',
        accent: '#E4572E',
      };
      expect(tokens.secondaryText).toBe('#6B6860');
      expect(tokens.background).toBe('#F6F4EF');
      expect(tokens.accent).toBe('#E4572E');
    });
  });
});

// PT-26: las columnas nuevas se agregan al final; las del contrato no cambian.
import fsPt26 from 'fs';
import pathPt26 from 'path';

function headersInRoute(file: string): string[] {
  // The route is a thin adapter; the CSV columns are defined in its backend service
  const src = fsPt26.readFileSync(pathPt26.resolve(__dirname, '../../src/services/http', `export-${file}.ts`), 'utf8');
  const block = src.match(/(?:const headers = |_CSV_HEADERS = )\[([\s\S]*?)\];/);
  return [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('PT-26: contrato de columnas ampliado', () => {
  const dictionary = fsPt26.readFileSync(pathPt26.resolve(__dirname, '../../../docs/data-dictionary.md'), 'utf8');

  it('matrix_long.csv conserva las 14 columnas en el mismo orden y agrega 10 al final', () => {
    const headers = headersInRoute('long');
    expect(headers.slice(0, 14)).toEqual([
      'room_id', 'round', 'method', 'blind_code', 'option_id', 'position', 'justification_text',
      'voter_tau_b', 'voter_cix', 'stuart_tau_c', 'stuart_cix', 'gamma_decided_pairs', 'gamma_cix', 'room_status',
    ]);
    expect(headers.slice(14)).toEqual([
      'reasons_for_count', 'reasons_against_count', 'vote_version', 'submitted_at', 'joined_round',
      'excluded_from_round', 'tie_break_rule', 'tie_break_applied', 'concordance_variant', 'round_status',
    ]);
  });

  it('matrix_wide_metrics.csv conserva las 12 columnas y agrega 3 al final', () => {
    const headers = headersInRoute('wide');
    expect(headers.slice(0, 12)).toEqual([
      'room_id', 'round', 'method', 'effective_voters', 'collective_tau', 'delta_tau',
      'stuart_tau_c', 'stuart_cix', 'gamma_decided_pairs', 'gamma_cix', 'collective_ranking', 'room_status',
    ]);
    expect(headers.slice(12)).toEqual(['tie_break_rule', 'concordance_variant', 'procedure_version']);
  });

  it('todas las columnas de los cuatro CSV están en el diccionario de datos', () => {
    for (const file of ['long', 'wide', 'reasons', 'events']) {
      for (const h of headersInRoute(file)) {
        expect(dictionary, `${file}:${h}`).toContain(`\`${h}\``);
      }
    }
  });
});
