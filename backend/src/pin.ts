/**
 * lib/pin.ts
 * Utilities for generating and hashing PINs.
 * - Room PINs: 6 alphanumeric characters (uppercase + digits, unambiguous)
 * - Participant PINs: 4-digit numeric (bcrypt cost=10)
 * - Blind codes: "Sujeto_NN" style sequential identifiers
 */

import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';

const PIN_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O/0, I/1 ambiguity

/**
 * Generates a 6-character alphanumeric room PIN using cryptographically secure random integers.
 */
export function generateRoomPin(): string {
  let pin = '';
  for (let i = 0; i < 6; i++) {
    pin += PIN_CHARSET[randomInt(0, PIN_CHARSET.length)];
  }
  return pin;
}

/**
 * Hashes a 4-digit participant PIN using bcrypt (cost=10).
 */
export async function hashParticipantPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export const hashStudentPin = hashParticipantPin;

/**
 * Verifies a 4-digit participant PIN against its hash.
 */
export async function verifyParticipantPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export const verifyStudentPin = verifyParticipantPin;

/**
 * Validates that a string is a valid 4-digit PIN.
 */
export function isValidParticipantPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export const isValidStudentPin = isValidParticipantPin;

/**
 * Generates a blind code for a participant: "Sujeto_01", "Sujeto_02", etc.
 * (Preserved for backward compatibility)
 */
export function generateBlindCode(index: number): string {
  return `Sujeto_${String(index + 1).padStart(2, '0')}`;
}

/**
 * Generates a blind code at random among available slots (AUD-02).
 * Format: "Participante 04", preventing correlation between arrival time and code.
 */
export function generateRandomBlindCode(existingCodes: string[], maxMembers: number = 40): string {
  const existingSet = new Set(existingCodes);
  const totalSlots = Math.max(maxMembers, 40);
  const available: number[] = [];
  for (let i = 1; i <= totalSlots; i++) {
    const code = `Participante ${String(i).padStart(2, '0')}`;
    if (!existingSet.has(code)) {
      available.push(i);
    }
  }

  if (available.length === 0) {
    let candidate = 100 + randomInt(0, 900);
    while (existingSet.has(`Participante ${candidate}`)) {
      candidate++;
    }
    return `Participante ${candidate}`;
  }

  const chosenIndex = available[randomInt(0, available.length)];
  return `Participante ${String(chosenIndex).padStart(2, '0')}`;
}

/**
 * Sanitizes a nickname: trims, normalizes Unicode NFKC, removes control characters,
 * collapses whitespace, and limits to 30 chars.
 * Rejects if empty or less than 2 chars after sanitization.
 */
export function sanitizeNickname(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 30);
  if (cleaned.length < 2) return null;
  return cleaned;
}
