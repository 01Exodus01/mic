/**
 * lib/vote-revision.ts
 * Normalized ballot snapshot stored in VoteRevision (PT-09).
 * A new revision is written only when the snapshot differs from the latest one.
 */

export interface VoteSnapshotEntry {
  optionId: string;
  position: number;
  justification: string | null;
  reasonsFor: string[];
  reasonsAgainst: string[];
}

export interface VoteSnapshot {
  entries: VoteSnapshotEntry[];
}

export interface VoteSnapshotInput {
  optionId: string;
  position: number;
  justification?: string | null;
  reasonsFor?: string[];
  reasonsAgainst?: string[];
}

/** Builds a snapshot ordered by position so equal ballots serialize identically. */
export function buildVoteSnapshot(entries: VoteSnapshotInput[]): VoteSnapshot {
  return {
    entries: [...entries]
      .sort((a, b) => a.position - b.position || a.optionId.localeCompare(b.optionId))
      .map((e) => ({
        optionId: e.optionId,
        position: e.position,
        justification: e.justification ?? null,
        reasonsFor: [...(e.reasonsFor ?? [])],
        reasonsAgainst: [...(e.reasonsAgainst ?? [])],
      })),
  };
}

/** True when a stored snapshot (JSON from the database) equals the new one. */
export function isSameSnapshot(stored: unknown, next: VoteSnapshot): boolean {
  if (typeof stored !== 'object' || stored === null) return false;
  const entries = (stored as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return false;
  const normalized = buildVoteSnapshot(entries as VoteSnapshotInput[]);
  return JSON.stringify(normalized) === JSON.stringify(next);
}
