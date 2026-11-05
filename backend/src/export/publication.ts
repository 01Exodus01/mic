/**
 * lib/export/publication.ts
 * "Anonymized for publication" mode of the normalized export (plan de mejora P3.3).
 *
 * Starting from the research tables:
 *  - no absolute timestamp: each *_at column becomes seconds since its round
 *    opened (t_since_round_open_s), a duration, or is removed;
 *  - no internal ids: database ids (cuid, which embed their creation time) are
 *    replaced by stable aliases (opt_01, ev_0001, rs_0001, room);
 *  - no room name (it may name the course) and no free text, unless the
 *    researcher states that publishing the reasons was approved (includeText).
 * Blind codes stay: they are the only participant identifier in any export.
 */

import type { Cell, CsvTable } from './format';
import type { ExportDataset } from './dataset';
import { deriveContext } from './tables';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

function secondsBetween(later: Date | null | undefined, earlier: Date | null | undefined): Cell {
  if (!later || !earlier) return '';
  return Number(((later.getTime() - earlier.getTime()) / 1000).toFixed(3));
}

const parseIso = (v: Cell): Date | null => (typeof v === 'string' && v ? new Date(v) : null);

interface ColumnChange {
  /** removed column */
  drop?: boolean;
  /** new name and value computed from the row */
  rename?: string;
  value?: (row: Cell[], col: (name: string) => Cell) => Cell;
}

function transform(table: CsvTable, changes: Record<string, ColumnChange>): CsvTable {
  const headers: string[] = [];
  const builders: Array<(row: Cell[]) => Cell> = [];
  table.headers.forEach((h, i) => {
    const change = changes[h];
    if (change?.drop) return;
    headers.push(change?.rename ?? h);
    const col = (row: Cell[]) => (name: string) => row[table.headers.indexOf(name)];
    builders.push(change?.value ? (row) => change.value!(row, col(row)) : (row) => row[i]);
  });
  return { name: table.name, headers, rows: table.rows.map((row) => builders.map((b) => b(row))) };
}

export interface PublicationOptions {
  /** Free text (reasons) kept only when its publication was approved */
  includeText: boolean;
}

export function toPublicationTables(tables: CsvTable[], ds: ExportDataset, opts: PublicationOptions): CsvTable[] {
  const ctx = deriveContext(ds);
  const openedAt = (round: Cell): Date | null =>
    typeof round === 'number' ? ctx.timeline.get(round)?.openedAt ?? null : null;
  const firstOpen = ctx.rounds.length ? ctx.timeline.get(ctx.rounds[0])?.openedAt ?? null : null;
  const sinceRoundOpen = (roundCol: string, atCol: string): ColumnChange => ({
    rename: 't_since_round_open_s',
    value: (_row, col) => secondsBetween(parseIso(col(atCol)), openedAt(col(roundCol))),
  });

  // Aliases for every database id that can appear in a cell
  const alias = new Map<string, string>();
  alias.set(ds.room.id, 'room');
  const optionAlias = new Map<string, string>();
  [...ds.options]
    .sort((a, b) => a.order_index - b.order_index)
    .forEach((o, i) => {
      optionAlias.set(o.id, `opt_${pad(i + 1, 2)}`);
      alias.set(o.id, `opt_${pad(i + 1, 2)}`);
    });
  ds.events.forEach((e, i) => alias.set(e.id, `ev_${pad(i + 1, 4)}`));

  const reasons = tables.find((t) => t.name === 'reasons.csv');
  const reasonIdCol = reasons ? reasons.headers.indexOf('reason_id') : -1;
  reasons?.rows.forEach((r, i) => alias.set(String(r[reasonIdCol]), `rs_${pad(i + 1, 4)}`));

  const replaceIds = (v: Cell): Cell => {
    if (typeof v !== 'string' || v === '') return v;
    const exact = alias.get(v);
    if (exact) return exact;
    // collective_ranking ("id:1 > id:2"), tied_with ("id;id")
    let out = v;
    for (const [id, a] of optionAlias) if (out.includes(id)) out = out.split(id).join(a);
    return out;
  };

  const changes: Record<string, Record<string, ColumnChange>> = {
    'rooms.csv': { room_name: { drop: true }, created_at: { drop: true } },
    'participants.csv': {
      first_joined_at: {
        rename: 'first_joined_t_since_round_open_s',
        value: (_row, col) => secondsBetween(parseIso(col('first_joined_at')), openedAt(col('joined_round'))),
      },
      consent_at: { drop: true },
    },
    'rounds.csv': {
      opened_at: {
        rename: 'opened_t_since_first_round_s',
        value: (_row, col) => secondsBetween(parseIso(col('opened_at')), firstOpen),
      },
      closed_at: {
        rename: 'duration_s',
        value: (_row, col) => secondsBetween(parseIso(col('closed_at')), parseIso(col('opened_at'))),
      },
    },
    'votes_long.csv': { submitted_at: sinceRoundOpen('round', 'submitted_at') },
    'reasons.csv': {
      created_at: sinceRoundOpen('round', 'created_at'),
      ...(opts.includeText ? {} : { text: { value: () => '' } }),
    },
    'events.csv': { created_at: { drop: true } },
  };

  return tables.map((t) => {
    const changed = transform(t, changes[t.name] ?? {});
    return { ...changed, rows: changed.rows.map((row) => row.map(replaceIds)) };
  });
}
