/**
 * lib/telemetry/events.ts
 * Usability telemetry sent by the participant screens (plan de mejora P2.1–P2.3).
 * Client-safe: only types and the zod schema live here.
 *
 * Privacy: events carry ids, counts and durations only. No text the participant
 * typed is ever sent (a reason being written is logged, its content is not).
 */

import { z } from 'zod';

const Id = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
const Round = z.number().int().min(1).max(50);
const Surface = z.enum(['feedback', 'vote']);
const Side = z.enum(['for', 'against']);

export const ClientEventSchema = z.discriminatedUnion('type', [
  // P2.1 the report was on screen (page visible) for visible_ms; sent when the
  // page is hidden, left or the report changes. Never sent with 0 ms.
  z.object({
    type: z.literal('report_read'),
    report_round: Round,
    surface: Surface,
    visible_ms: z.number().int().min(1).max(6 * 60 * 60 * 1000),
    sections_opened: z.number().int().min(0).max(200),
  }),
  // P2.1 / P2.3 an option of the report was expanded: its reasons were shown
  z.object({ type: z.literal('report_section_opened'), report_round: Round, surface: Surface, option_id: Id }),
  // P2.2 the ballot form was shown (reference for time to first reorder)
  z.object({ type: z.literal('ballot_viewed'), editing: z.boolean() }),
  // P2.2 one reorder of the ballot before sending it
  z.object({
    type: z.literal('ranking_reordered'),
    method: z.enum(['buttons', 'drag', 'touch']),
    option_id: Id,
    from_position: z.number().int().min(1).max(50),
    to_position: z.number().int().min(1).max(50),
    reorder_index: z.number().int().min(1).max(10000),
  }),
  // P2.3 a reason field was added (panel opened) and first typed in
  z.object({ type: z.literal('reason_field_added'), option_id: Id, side: Side }),
  z.object({ type: z.literal('reason_typing_started'), option_id: Id, side: Side }),
]);

export type ClientEvent = z.infer<typeof ClientEventSchema>;
export type ClientEventType = ClientEvent['type'];

export const CLIENT_EVENT_TYPES = [
  'report_read',
  'report_section_opened',
  'ballot_viewed',
  'ranking_reordered',
  'reason_field_added',
  'reason_typing_started',
] as const satisfies readonly ClientEventType[];

export const MAX_EVENTS_PER_BATCH = 25;

/** Longest delay accepted between an event happening and reaching the server. */
export const MAX_EVENT_AGE_MS = 10 * 60 * 1000;

export const ClientEventBatchSchema = z
  .object({
    events: z.array(ClientEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
    // Milliseconds since each event happened, measured by the browser when the
    // batch is sent (one per event). Relative, so the browser clock does not matter.
    ages_ms: z.array(z.number().int().min(0)).max(MAX_EVENTS_PER_BATCH).optional(),
  })
  .refine((b) => !b.ages_ms || b.ages_ms.length === b.events.length, { message: 'ages_ms must match events' });
