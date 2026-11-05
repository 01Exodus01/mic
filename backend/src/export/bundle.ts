/**
 * lib/export/bundle.ts
 * The complete normalized export as one ZIP (plan de mejora P3.1–P3.4):
 * every CSV, README_data_dictionary.md and manifest.json with the SHA-256 of
 * each file, the date and the versions.
 *
 * Two modes:
 *  - research: full data of the room, ISO 8601 UTC timestamps;
 *  - publication: anonymized (lib/export/publication.ts).
 * Free text (reasons) is included in research mode by default and in
 * publication mode only when the researcher states it was approved.
 * The course roster is never loaded (lib/export/dataset.ts), so no label can
 * reach any file.
 */

import { createHash } from 'crypto';
import { buildDataDictionary } from './dictionary';
import { APP_VERSION, EXPORT_TIMEZONE, tableToCsv } from './format';
import type { CsvTable } from './format';
import type { ExportDataset } from './dataset';
import { toPublicationTables } from './publication';
import { buildExportTables } from './tables';
import { createZip } from './zip';

export const EXPORT_FORMAT = 'r-fast-cr-export/1';

export type ExportMode = 'research' | 'publication';

export interface BundleOptions {
  mode: ExportMode;
  includeText: boolean;
  /** Generation time (tests pass a fixed one) */
  now?: Date;
}

export interface BundleFile {
  name: string;
  data: Buffer;
}

export interface ExportManifest {
  export_format: string;
  mode: ExportMode;
  includes_free_text: boolean;
  /** research: full ISO timestamp; publication: date only */
  generated_at: string;
  timezone: string;
  app_version: string;
  procedure_versions: string[];
  room_id: string;
  files: Array<{ name: string; rows: number | null; bytes: number; sha256: string }>;
}

export function exportTables(ds: ExportDataset, opts: Pick<BundleOptions, 'mode' | 'includeText'>): CsvTable[] {
  const tables = buildExportTables(ds, { includeText: opts.includeText });
  return opts.mode === 'publication' ? toPublicationTables(tables, ds, { includeText: opts.includeText }) : tables;
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export function buildExportFiles(ds: ExportDataset, opts: BundleOptions): { files: BundleFile[]; manifest: ExportManifest } {
  const now = opts.now ?? new Date();
  const tables = exportTables(ds, opts);
  const files: BundleFile[] = tables.map((t) => ({ name: t.name, data: Buffer.from(tableToCsv(t), 'utf8') }));
  const rows = new Map(tables.map((t) => [t.name, t.rows.length]));
  files.push({
    name: 'README_data_dictionary.md',
    data: Buffer.from(buildDataDictionary(tables, { mode: opts.mode, includesFreeText: opts.includeText }), 'utf8'),
  });

  const metrics = tables.find((t) => t.name === 'round_metrics.csv');
  const versionCol = metrics ? metrics.headers.indexOf('procedure_version') : -1;
  const procedureVersions = [...new Set((metrics?.rows ?? []).map((r) => r[versionCol]).filter((v): v is string => typeof v === 'string' && v !== ''))].sort();
  const rooms = tables.find((t) => t.name === 'rooms.csv');

  const manifest: ExportManifest = {
    export_format: EXPORT_FORMAT,
    mode: opts.mode,
    includes_free_text: opts.includeText,
    generated_at: opts.mode === 'publication' ? now.toISOString().slice(0, 10) : now.toISOString(),
    timezone: EXPORT_TIMEZONE,
    app_version: APP_VERSION,
    procedure_versions: procedureVersions,
    room_id: String(rooms?.rows[0]?.[rooms.headers.indexOf('room_id')] ?? ''),
    files: files.map((f) => ({ name: f.name, rows: rows.get(f.name) ?? null, bytes: f.data.length, sha256: sha256(f.data) })),
  };
  files.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') });
  return { files, manifest };
}

export function buildExportZip(ds: ExportDataset, opts: BundleOptions): { zip: Buffer; manifest: ExportManifest } {
  const now = opts.now ?? new Date();
  const { files, manifest } = buildExportFiles(ds, { ...opts, now });
  // Publication: no generation time inside the archive either (fixed entry date)
  const stamp = opts.mode === 'publication' ? new Date(Date.UTC(1980, 0, 1)) : now;
  return { zip: createZip(files, stamp), manifest };
}
