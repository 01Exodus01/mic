/**
 * lib/member-codes.ts
 * Personal access codes for course-roster rooms (PT-21, PT-22).
 *
 * A code is 10 random characters from the unambiguous PIN alphabet (32^10 ≈ 2^50),
 * shown to the host once and stored only as a SHA-256 hash. The entropy is high
 * enough that a fast hash suffices, which also allows an indexed lookup.
 */

import { createHash, randomInt } from 'crypto';

const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O/0, I/1
export const MEMBER_CODE_LENGTH = 10;

/** Random code, displayed as "ABCDE-FGHJK". */
export function generateMemberCode(): string {
  let raw = '';
  for (let i = 0; i < MEMBER_CODE_LENGTH; i++) {
    raw += CODE_CHARSET[randomInt(0, CODE_CHARSET.length)];
  }
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Uppercase, without spaces or dashes: what is hashed and compared. */
export function normalizeMemberCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isWellFormedMemberCode(input: string): boolean {
  const normalized = normalizeMemberCode(input);
  return normalized.length === MEMBER_CODE_LENGTH && [...normalized].every((c) => CODE_CHARSET.includes(c));
}

export function hashMemberCode(code: string): string {
  return createHash('sha256').update(normalizeMemberCode(code), 'utf8').digest('hex');
}

/**
 * Parses pasted lines or a CSV file into labels: first field of each non-empty
 * line (comma, semicolon or tab separated), outer quotes removed. A first line
 * named "label", "etiqueta", "matricula" or "matrícula" is treated as a header.
 */
export function parseRosterText(text: string): string[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const labels: string[] = [];
  lines.forEach((line, i) => {
    const first = line.split(/[,;\t]/)[0]?.trim().replace(/^"(.*)"$/, '$1').trim() ?? '';
    if (!first) return;
    if (i === 0 && /^(label|etiqueta|matr[ií]cula)$/i.test(first)) return;
    labels.push(first);
  });
  return labels;
}
