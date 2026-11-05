/**
 * backend/src/shared/domain.ts
 * Domain enums the screens use, re-exported as types so the frontend never
 * imports @prisma/client.
 */

export type { AggregationMethod, RoomStatus, TieBreakRule, ConcordanceVariant, AccessMode } from '@prisma/client';
