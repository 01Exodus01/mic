/**
 * lib/csv.ts
 * CSV formatting and formula injection defense (CWE-1236).
 */

/**
 * Escapes a field for CSV export according to RFC 4180 and protects against
 * formula injection in spreadsheet software (Excel, LibreOffice Calc).
 *
 * Cells starting with =, +, -, @, \t, or \r are neutralized with a leading apostrophe.
 * Legitimate numeric numbers are preserved.
 */
export function escapeCsvField(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return String(val);
  let str = String(val);

  // Neutralize CSV formula injection (CWE-1236)
  if (/^[=+\-@\t\r]/.test(str) || /^[=+\-@\t\r]/.test(str.trim())) {
    str = `'${str}`;
  }

  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds a full CSV document: UTF-8 BOM, CRLF line ends, every field escaped
 * with escapeCsvField (RFC 4180 + formula-injection defense).
 */
export function buildCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.join(','), ...rows.map((r) => r.map((v) => escapeCsvField(v)).join(','))];
  return '﻿' + lines.join('\r\n');
}

export function csvResponseHeaders(filename: string): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store, private',
  };
}
