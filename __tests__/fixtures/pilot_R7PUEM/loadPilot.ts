/**
 * __tests__/fixtures/pilot_R7PUEM/loadPilot.ts
 * Rebuilds the pilot room R7PUEM (exported with the legacy CSVs on 2026-11-04)
 * as an in-memory ExportDataset, the same shape loadExportDataset returns.
 *
 * Known from the CSVs: options, ballots, reasons, events, collective rankings,
 * tie-break rule REASON_BALANCE, variant WITHOUT_TIES, procedure r-fast-cr-2.
 * Not in the CSVs (assumed): consensus threshold 0.8 and 3 max rounds (the room
 * stayed in ROUND_FEEDBACK after round 2 with 0.6667), late participants allowed
 * (Participante 36 joined in round 2), early close on (round 1 closed by the
 * system right after the last ballot). Per-voter metrics are not stored, so the
 * exporter recomputes them, as it does for any report before RoundVoterMetric.
 */

import fs from 'fs';
import path from 'path';
import { computeVoterCIX } from '@/lib/algorithms/kendallTau';
import type { WeakOrder } from '@/lib/algorithms/types';
import type { ExportDataset } from '@/lib/export/dataset';

function parseCsv(file: string): Array<Record<string, string>> {
  const text = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows.filter((r) => r.length > 1);
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export const PILOT_ROOM_ID = 'cmw2k9rzh0001o21beu62oj5o';
export const PILOT_OPTIONS = ['cmw2k9rzh0002o21bejgffma5', 'cmw2k9rzh0003o21b93v8hael', 'cmw2k9rzh0004o21b1gfcvsnt'];

export function loadPilotDataset(): ExportDataset {
  const long = parseCsv('matrix_long_R7PUEM.csv');
  const wide = parseCsv('matrix_wide_metrics_R7PUEM.csv');
  const reasons = parseCsv('reasons_R7PUEM.csv');
  const events = parseCsv('events_R7PUEM.csv');

  const codes = [...new Set([...long.map((r) => r.blind_code), ...events.map((e) => e.blind_code).filter(Boolean)])].sort();
  const pid = (code: string) => `p-${code.replace(/\D/g, '')}`;
  const firstJoin = (code: string) =>
    new Date(events.find((e) => e.type === 'participant_joined' && e.blind_code === code)!.created_at);
  const joinRound = (code: string) =>
    Number(events.find((e) => e.type === 'participant_joined' && e.blind_code === code)!.round);

  const votes = long.map((r, i) => ({
    id: `v-${i}`,
    participant_id: pid(r.blind_code),
    round: Number(r.round),
    option_id: r.option_id,
    position: Number(r.position),
    justification: r.justification_text || null,
    created_at: new Date(r.submitted_at),
    reasons: reasons
      .filter((x) => x.round === r.round && x.blind_code === r.blind_code && x.option_id === r.option_id)
      .map((x, k) => ({
        id: `r-${i}-${k}`,
        side: x.side as 'FOR' | 'AGAINST',
        order_index: Number(x.order),
        text: x.text,
        created_at: new Date(r.submitted_at),
      })),
  }));

  const reports = wide.map((w) => {
    const round = Number(w.round);
    const ranking: WeakOrder[] = w.collective_ranking.split(' > ').map((part) => {
      const [id, mid] = part.split(':');
      return { id, midRank: Number(mid), score: 0 };
    });
    const ballots = new Map<string, Map<string, number>>();
    for (const v of votes.filter((x) => x.round === round)) {
      const b = ballots.get(v.participant_id) ?? new Map<string, number>();
      b.set(v.option_id, v.position);
      ballots.set(v.participant_id, b);
    }
    const voters = [...ballots].map(([p, b]) => computeVoterCIX(b, ranking, p));
    const tauStar = voters.reduce((s, v) => s + v.cix, 0) / voters.length;
    // Round 1 was a total Borda tie resolved by the rule; round 2 had no ties
    const tiedGroups = round === 1 ? [PILOT_OPTIONS] : [];
    return {
      id: `rep-${round}`,
      room_id: PILOT_ROOM_ID,
      round,
      effective_voters: Number(w.effective_voters),
      collective_ranking: ranking as unknown as never,
      obtained_tau: tauStar,
      created_at: new Date(events.find((e) => e.type === 'round_processed' && e.round === w.round)!.created_at),
      arguments_json: {
        __metrics: { tauStar, voters: voters.map((v) => ({ participantId: v.participantId, cix: v.cix, tauB: v.tauB })) },
        __tieBreak: { rule: 'REASON_BALANCE', applied: tiedGroups.length > 0, tiedGroups },
        __concordance: { variant: w.concordance_variant },
        __procedure: { version: w.procedure_version, tauThreshold: 0.8, maxRounds: 3 },
      } as unknown as never,
    };
  });

  return {
    room: {
      id: PILOT_ROOM_ID,
      pin: 'R7PUEM',
      title: 'Sala piloto R7PUEM',
      method: 'BORDA',
      tau_threshold: 0.8,
      max_rounds: 3,
      current_round: 2,
      status: 'ROUND_FEEDBACK',
      deadline: null,
      created_at: new Date('2026-11-04T20:20:00.000Z'),
      access_mode: 'OPEN_PIN',
      allow_late_join: true,
      consent_required: false,
      consent_version: 1,
      close_when_all_voted: true,
      tie_break_rule: 'REASON_BALANCE',
      concordance_variant: 'WITHOUT_TIES',
    },
    options: PILOT_OPTIONS.map((id, i) => ({ id, order_index: i })),
    participants: codes.map((code) => ({
      id: pid(code),
      blind_code: code,
      joined_round: joinRound(code),
      is_retired: false,
      created_at: firstJoin(code),
    })),
    votes,
    revisions: [...new Set(votes.map((v) => `${v.round}:${v.participant_id}`))].map((k) => {
      const [round, participant_id] = k.split(':');
      return { round: Number(round), participant_id, _max: { version: 1 } };
    }),
    reports,
    voterMetrics: [],
    events: events.map((e, i) => ({
      id: `e-${i}`,
      room_id: PILOT_ROOM_ID,
      round: e.round ? Number(e.round) : null,
      type: e.type,
      actor: e.actor as 'HOST' | 'PARTICIPANT' | 'SYSTEM',
      participant_id: e.blind_code ? pid(e.blind_code) : null,
      data: e.data ? JSON.parse(e.data) : null,
      created_at: new Date(e.created_at),
    })),
    consents: [],
  } as unknown as ExportDataset;
}
