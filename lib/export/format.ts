/**
 * lib/export/format.ts
 * Shared formatting for the normalized export (plan de mejora P0.2, P3.2).
 *  - every metric rounded to 4 decimals (same rule everywhere, delta included);
 *  - timestamps in ISO 8601 UTC ("...Z");
 *  - booleans as true / false; missing values as an empty cell.
 */

import packageJson from '../../package.json';
import { buildCsv } from '@/lib/csv';

export const APP_VERSION: string = packageJson.version;
export const EXPORT_TIMEZONE = 'UTC';
export const METRIC_DECIMALS = 4;

export type Cell = string | number | boolean | null | undefined;

/** Rounds a metric to 4 decimals; empty when not a finite number. Avoids -0. */
export function metric(value: number | null | undefined): number | '' {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const rounded = Number(value.toFixed(METRIC_DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function isoUtc(date: Date | null | undefined): string {
  return date ? date.toISOString() : '';
}

export function bool(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value ? 'true' : 'false';
}

/** camelCase → snake_case for flattened event data keys */
export function snakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export interface CsvTable {
  /** File name inside the export, e.g. "rooms.csv" */
  name: string;
  headers: string[];
  rows: Cell[][];
}

/** CSV text for a table: BOM, CRLF, RFC 4180 escaping and formula-injection defense. */
export function tableToCsv(table: CsvTable): string {
  const toField = (v: Cell): string | number | null | undefined => (typeof v === 'boolean' ? (v ? 'true' : 'false') : v);
  return buildCsv(table.headers, table.rows.map((r) => r.map(toField)));
}
