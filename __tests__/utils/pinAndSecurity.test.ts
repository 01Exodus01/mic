import { describe, it, expect } from 'vitest';
import {
  generateRoomPin,
  hashParticipantPin,
  verifyParticipantPin,
  isValidParticipantPin,
  generateBlindCode,
  generateRandomBlindCode,
  sanitizeNickname,
} from '../../lib/pin';
import { checkRateLimit, extractClientIp } from '../../lib/rate-limit';

describe('PIN Generation and Verification', () => {
  it('generates a 6-character uppercase alphanumeric room PIN', () => {
    const pin = generateRoomPin();
    expect(pin).toHaveLength(6);
    expect(/^[A-Z0-9]{6}$/.test(pin)).toBe(true);
  });

  it('validates 4-digit participant PINs strictly', () => {
    expect(isValidParticipantPin('1234')).toBe(true);
    expect(isValidParticipantPin('0000')).toBe(true);
    expect(isValidParticipantPin('9999')).toBe(true);
    expect(isValidParticipantPin('123')).toBe(false);
    expect(isValidParticipantPin('12345')).toBe(false);
    expect(isValidParticipantPin('abcd')).toBe(false);
    expect(isValidParticipantPin('12a4')).toBe(false);
  });

  it('hashes participant PIN with bcrypt and verifies correctly', async () => {
    const pin = '4821';
    const hash = await hashParticipantPin(pin);
    expect(hash).toMatch(/^\$2[aby]\$10\$/); // bcrypt cost 10 format

    const valid = await verifyParticipantPin(pin, hash);
    expect(valid).toBe(true);

    const invalid = await verifyParticipantPin('9999', hash);
    expect(invalid).toBe(false);
  });

  it('generates zero-PII blind codes sequentially', () => {
    expect(generateBlindCode(0)).toBe('Sujeto_01');
    expect(generateBlindCode(9)).toBe('Sujeto_10');
    expect(generateBlindCode(24)).toBe('Sujeto_25');
  });

  it('generates random blind codes matching Participante XX without collision', () => {
    const existing = ['Participante 01', 'Participante 02'];
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const code = generateRandomBlindCode(existing, 40);
      expect(code).toMatch(/^Participante \d{2,}$/);
      expect(existing).not.toContain(code);
      codes.add(code);
    }
    // Random distribution should generate more than 1 distinct code
    expect(codes.size).toBeGreaterThan(1);
  });

  it('sanitizes nicknames and rejects invalid ones', () => {
    expect(sanitizeNickname('  Juan   Pérez  ')).toBe('Juan Pérez');
    expect(sanitizeNickname('A')).toBeNull(); // Less than 2 chars
    expect(sanitizeNickname('   ')).toBeNull();
    const veryLong = 'A'.repeat(50);
    expect(sanitizeNickname(veryLong)).toHaveLength(30);
  });
});

describe('Rate Limiter & IP Extraction', () => {
  it('allows requests up to the limit and then blocks with reset time', () => {
    const key = `test:${Date.now()}`;
    const limit = 3;
    const windowSec = 10;

    const r1 = checkRateLimit(key, limit, windowSec);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit(key, limit, windowSec);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit(key, limit, windowSec);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = checkRateLimit(key, limit, windowSec);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.resetIn).toBeGreaterThan(0);
  });

  it('extracts client IP safely with TRUSTED_PROXY_HOPS', () => {
    // Zero hops: untrusted proxy headers are ignored
    expect(extractClientIp('198.51.100.1, 203.0.113.5', '198.51.100.1', 0)).toBe('127.0.0.1');

    // 1 hop: takes the rightmost IP
    expect(extractClientIp('198.51.100.1, 203.0.113.5', null, 1)).toBe('203.0.113.5');

    // 2 hops: takes the second from right
    expect(extractClientIp('198.51.100.1, 203.0.113.5, 10.0.0.1', null, 2)).toBe('203.0.113.5');

    // Invalid IP is not accepted
    expect(extractClientIp('invalid-ip, 127.0.0.1', null, 2)).toBe('127.0.0.1');
  });
});
