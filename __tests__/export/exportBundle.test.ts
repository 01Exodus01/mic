/**
 * __tests__/export/exportBundle.test.ts
 * Plan de mejora P3.1–P3.3 on the pilot room R7PUEM:
 *  - the ZIP has every CSV, README_data_dictionary.md and manifest.json;
 *  - the dictionary describes every column, in both modes and room variants;
 *  - the manifest hashes match the files;
 *  - publication mode leaves no absolute timestamp, internal id, room name or
 *    free text (unless approved), and keeps the relative times right.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { buildExportZip, exportTables, type ExportManifest } from '@/lib/export/bundle';
import { undocumentedColumns } from '@/lib/export/dictionary';
import { exportOptionsFrom } from '@/lib/export/request';
import type { ExportDataset } from '@/lib/export/dataset';
import { loadPilotDataset } from '../fixtures/pilot_R7PUEM/loadPilot';
import { readZip } from '../helpers/readZip';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const CSV_NAMES = [
  'rooms.csv', 'options.csv', 'participants.csv', 'rounds.csv', 'votes_long.csv', 'voter_round_metrics.csv',
  'option_round_scores.csv', 'round_metrics.csv', 'reasons.csv', 'events.csv',
];
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const CUID = /\bc[a-z0-9]{20,}\b/;

function variants(): Array<[string, ExportDataset]> {
  const base = loadPilotDataset();
  const withTies = loadPilotDataset();
  withTies.room.concordance_variant = 'WITH_TIES';
  const noRule = loadPilotDataset();
  noRule.room.tie_break_rule = 'NONE';
  return [['piloto', base], ['con empates', withTies], ['sin regla de desempate', noRule]];
}

function unpack(ds: ExportDataset, mode: 'research' | 'publication', includeText: boolean) {
  const { zip, manifest } = buildExportZip(ds, { mode, includeText, now: NOW });
  const files = readZip(zip);
  const text = (name: string) => files.get(name)!.toString('utf8');
  return { files, manifest, text };
}

describe('P3.1: ZIP con CSV, diccionario y manifiesto', () => {
  it('trae todos los archivos y cada CSV en UTF-8 con BOM', () => {
    const { files } = unpack(loadPilotDataset(), 'research', true);
    expect([...files.keys()]).toEqual([...CSV_NAMES, 'README_data_dictionary.md', 'manifest.json']);
    for (const name of CSV_NAMES) expect(files.get(name)!.subarray(0, 3).toString('hex')).toBe('efbbbf');
  });

  it('el manifiesto trae hash SHA-256, filas, fecha y versiones', () => {
    const { files, manifest } = unpack(loadPilotDataset(), 'research', true);
    const parsed = JSON.parse(files.get('manifest.json')!.toString('utf8')) as ExportManifest;
    expect(parsed).toEqual(manifest);
    expect(manifest.files.map((f) => f.name)).toEqual([...CSV_NAMES, 'README_data_dictionary.md']);
    for (const f of manifest.files) {
      const data = files.get(f.name)!;
      expect(f.sha256).toBe(createHash('sha256').update(data).digest('hex'));
      expect(f.bytes).toBe(data.length);
    }
    for (const t of exportTables(loadPilotDataset(), { mode: 'research', includeText: true })) {
      expect(manifest.files.find((f) => f.name === t.name)!.rows).toBe(t.rows.length);
    }
    expect(manifest.files.find((f) => f.name === 'README_data_dictionary.md')!.rows).toBeNull();
    expect(manifest).toMatchObject({
      export_format: 'r-fast-cr-export/1',
      mode: 'research',
      includes_free_text: true,
      generated_at: NOW.toISOString(),
      timezone: 'UTC',
      procedure_versions: ['r-fast-cr-2'],
    });
    expect(manifest.app_version).toMatch(/^\d+\.\d+\.\d+/);
  });

  for (const [label, ds] of variants()) {
    for (const mode of ['research', 'publication'] as const) {
      it(`el diccionario describe cada columna (${label}, ${mode})`, () => {
        const tables = exportTables(ds, { mode, includeText: false });
        expect(undocumentedColumns(tables)).toEqual([]);
        const readme = unpack(ds, mode, false).text('README_data_dictionary.md');
        for (const t of tables) {
          expect(readme).toContain(`## ${t.name}`);
          for (const h of t.headers) expect(readme).toContain(`| \`${h}\` |`);
        }
      });
    }
  }
});

describe('P3.3: modo anonimizado para publicar', () => {
  const pub = unpack(loadPilotDataset(), 'publication', false);

  it('no quedan fechas absolutas ni identificadores internos en ningún archivo', () => {
    for (const name of CSV_NAMES) {
      expect(pub.text(name), name).not.toMatch(ISO_TIMESTAMP);
      expect(pub.text(name), name).not.toMatch(CUID);
    }
    expect(pub.text('manifest.json')).not.toMatch(ISO_TIMESTAMP);
    expect(pub.manifest.generated_at).toBe('2026-11-05');
    expect(pub.manifest.room_id).toBe('room');
  });

  it('sin nombre de sala ni texto libre por defecto', () => {
    const tables = exportTables(loadPilotDataset(), { mode: 'publication', includeText: false });
    expect(tables.find((t) => t.name === 'rooms.csv')!.headers).not.toContain('room_name');
    expect(pub.text('rooms.csv')).not.toContain('Sala piloto');
    const reasons = tables.find((t) => t.name === 'reasons.csv')!;
    const textCol = reasons.headers.indexOf('text');
    expect(reasons.rows.length).toBeGreaterThan(0);
    expect(reasons.rows.every((r) => r[textCol] === '')).toBe(true);
    for (const name of CSV_NAMES) expect(pub.text(name)).not.toContain('razones en contra');
  });

  it('con la publicación aprobada, el texto de las razones vuelve', () => {
    expect(unpack(loadPilotDataset(), 'publication', true).text('reasons.csv')).toContain('razones en contra 1');
  });

  it('alias estables: opciones por su orden, ranking y empates con los mismos alias', () => {
    const tables = exportTables(loadPilotDataset(), { mode: 'publication', includeText: false });
    expect(tables.find((t) => t.name === 'options.csv')!.rows).toEqual([['opt_01', 1], ['opt_02', 2], ['opt_03', 3]]);
    const rm = tables.find((t) => t.name === 'round_metrics.csv')!;
    // golden: round 2 …0003 > …0004 > …0002
    expect(rm.rows[1][rm.headers.indexOf('collective_ranking')]).toBe('opt_02:1 > opt_03:2 > opt_01:3');
    const ev = tables.find((t) => t.name === 'events.csv')!;
    expect(ev.rows[0][0]).toBe('ev_0001');
  });

  it('los tiempos absolutos pasan a segundos desde la apertura de la ronda', () => {
    const ds = loadPilotDataset();
    const research = exportTables(ds, { mode: 'research', includeText: true });
    const published = exportTables(ds, { mode: 'publication', includeText: false });
    const pick = (tables: typeof research, name: string) => tables.find((t) => t.name === name)!;

    const rounds = pick(research, 'rounds.csv');
    const opened = new Map(rounds.rows.map((r) => [r[0], new Date(String(r[rounds.headers.indexOf('opened_at')]))]));
    const closed = new Map(rounds.rows.map((r) => [r[0], new Date(String(r[rounds.headers.indexOf('closed_at')]))]));

    const vr = pick(research, 'votes_long.csv');
    const vp = pick(published, 'votes_long.csv');
    expect(vp.headers).toContain('t_since_round_open_s');
    expect(vp.headers).not.toContain('submitted_at');
    vr.rows.forEach((row, i) => {
      const round = row[vr.headers.indexOf('round')];
      const at = new Date(String(row[vr.headers.indexOf('submitted_at')]));
      const expected = (at.getTime() - opened.get(round)!.getTime()) / 1000;
      expect(vp.rows[i][vp.headers.indexOf('t_since_round_open_s')]).toBeCloseTo(expected, 3);
    });

    const rp = pick(published, 'rounds.csv');
    expect(rp.headers).toEqual(expect.arrayContaining(['opened_t_since_first_round_s', 'duration_s']));
    expect(rp.rows[0][rp.headers.indexOf('opened_t_since_first_round_s')]).toBe(0);
    const r1 = (closed.get(1)!.getTime() - opened.get(1)!.getTime()) / 1000;
    expect(rp.rows[0][rp.headers.indexOf('duration_s')]).toBeCloseTo(r1, 3);

    const ep = pick(published, 'events.csv');
    expect(ep.headers).not.toContain('created_at');
    expect(ep.headers).toContain('t_since_round_open_s');
  });

  it('opciones de la URL: publicación sin texto salvo include_text=1; investigación con texto salvo include_text=0', () => {
    expect(exportOptionsFrom(new URLSearchParams(''))).toEqual({ mode: 'research', includeText: true });
    expect(exportOptionsFrom(new URLSearchParams('include_text=0'))).toEqual({ mode: 'research', includeText: false });
    expect(exportOptionsFrom(new URLSearchParams('mode=publication'))).toEqual({ mode: 'publication', includeText: false });
    expect(exportOptionsFrom(new URLSearchParams('mode=publication&include_text=1'))).toEqual({ mode: 'publication', includeText: true });
    expect(exportOptionsFrom(new URLSearchParams('mode=otro&include_text=1'))).toEqual({ mode: 'research', includeText: true });
  });
});
