/**
 * __tests__/security/validationAndHardening.test.ts
 * Rigorous security audit test suite:
 *  1. Boundary testing for reason lengths (no minimum since PT-13; maximum 200 chars).
 *  2. Participant name/alias length bounds (2, 3, 30, 31 chars).
 *  3. PIN personal (4 digits) and Room PIN (6 alphanumeric chars).
 *  4. Room creation parameter bounds and mandatory numeric fields without hidden defaults.
 *  5. CSV formula injection neutralization (CWE-1236).
 *  6. Brute force temporal lockout after 5 consecutive failed attempts.
 *  7. Unicode NFKC normalization and control character sanitization.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SingleVoteEntrySchema,
  ParticipantJoinSchema,
  ParticipantNicknameSchema,
  CreateRoomSchema,
  RoundDurationSchema,
  HostLoginSchema,
  HostRegisterSchema,
  sanitizeText,
  sanitizeNickname,
  getUnicodeLength,
} from '../../lib/validations';
import { escapeCsvField } from '../../lib/csv';
import {
  checkLockout,
  recordFailedAttempt,
  resetFailedAttempts,
} from '../../lib/rate-limit';

// PT-13: las razones pasaron a ser opcionales y sin mínimo (enmienda E-6 de AGENTS.md).
// Antes este bloque exigía 25 caracteres; ahora comprueba que no hay mínimo y que
// el máximo de 200 se mantiene, tanto en la razón heredada como en las nuevas listas.
describe('1. Justification Length Boundary Tests (sin mínimo, máximo 200)', () => {
  const baseEntry = {
    optionId: 'opt-123',
    position: 1,
  };

  it('accepts a 24-character justification (no minimum since PT-13)', () => {
    const text24 = '123456789012345678901234'; // length = 24
    expect(text24.length).toBe(24);

    const result = SingleVoteEntrySchema.safeParse({
      ...baseEntry,
      justification: text24,
    });
    expect(result.success).toBe(true);
  });

  it('turns a justification of only spaces into no justification', () => {
    const spaces25 = ' '.repeat(25);
    const result = SingleVoteEntrySchema.safeParse({
      ...baseEntry,
      justification: spaces25,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.justification).toBeNull();
    }
  });

  it('accepts a vote without any reason', () => {
    const result = SingleVoteEntrySchema.safeParse(baseEntry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reasonsFor).toEqual([]);
      expect(result.data.reasonsAgainst).toEqual([]);
      expect(result.data.justification).toBeNull();
    }
  });

  it('counts unicode emojis accurately in justifications', () => {
    const emojiText = 'Á'.repeat(195) + '🚀🎯💡✨🌟'; // 200 code points, more UTF-16 units
    expect(getUnicodeLength(emojiText)).toBe(200);
    expect(emojiText.length).toBeGreaterThan(200);

    const result = SingleVoteEntrySchema.safeParse({
      ...baseEntry,
      justification: emojiText,
    });
    expect(result.success).toBe(true);
  });

  it('accepts justification with 199 characters (near upper bound)', () => {
    const text199 = 'A'.repeat(199);
    expect(text199.length).toBe(199);

    const result = SingleVoteEntrySchema.safeParse({
      ...baseEntry,
      justification: text199,
    });
    expect(result.success).toBe(true);
  });

  it('accepts justification with exactly 200 characters (upper bound)', () => {
    const text200 = 'B'.repeat(200);
    expect(text200.length).toBe(200);

    const result = SingleVoteEntrySchema.safeParse({
      ...baseEntry,
      justification: text200,
    });
    expect(result.success).toBe(true);
  });

  it('rejects justification with 201 characters (exceeds upper bound)', () => {
    const text201 = 'C'.repeat(201);
    expect(text201.length).toBe(201);

    const result = SingleVoteEntrySchema.safeParse({
      ...baseEntry,
      justification: text201,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]?.message).toMatch(/máximo 200 caracteres/i);
    }
  });
});

describe('2. Participant Name and PIN Boundaries', () => {
  const baseJoin = {
    roomPin: 'ABC123',
    pin4: '1234',
  };

  it('rejects participant nickname with 2 characters (below minimum 3)', () => {
    const result = ParticipantJoinSchema.safeParse({
      ...baseJoin,
      nickname: 'Jo',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]?.message).toMatch(/mínimo 3 caracteres/i);
    }
  });

  it('accepts participant nickname with exactly 3 characters (lower bound)', () => {
    const result = ParticipantJoinSchema.safeParse({
      ...baseJoin,
      nickname: 'Ana',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nickname).toBe('Ana');
    }
  });

  it('accepts participant nickname with whitelist characters (accents, spaces, - _ . \')', () => {
    const validNicknames = [
      'María José',
      "D'Artagnan",
      'Jean-Luc',
      'Dr. Watson',
      'User_99',
    ];
    for (const nick of validNicknames) {
      const res = ParticipantNicknameSchema.safeParse(nick);
      expect(res.success).toBe(true);
    }
  });

  it('rejects nicknames with non-whitelisted characters', () => {
    const invalidNicknames = [
      '<script>alert(1)</script>',
      'Carlos@home',
      'Admin#1',
      'User$Dollar',
    ];
    for (const nick of invalidNicknames) {
      const res = ParticipantNicknameSchema.safeParse(nick);
      expect(res.success).toBe(false);
    }
  });

  it('accepts participant nickname with exactly 30 characters (upper bound)', () => {
    const nick30 = 'N'.repeat(30);
    const result = ParticipantJoinSchema.safeParse({
      ...baseJoin,
      nickname: nick30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects participant nickname with 31 characters', () => {
    const nick31 = 'N'.repeat(31);
    const result = ParticipantJoinSchema.safeParse({
      ...baseJoin,
      nickname: nick31,
    });
    expect(result.success).toBe(false);
  });

  it('validates 4-digit personal PIN strictly', () => {
    expect(ParticipantJoinSchema.safeParse({ ...baseJoin, nickname: 'Carlos', pin4: '123' }).success).toBe(false);
    expect(ParticipantJoinSchema.safeParse({ ...baseJoin, nickname: 'Carlos', pin4: '12345' }).success).toBe(false);
    expect(ParticipantJoinSchema.safeParse({ ...baseJoin, nickname: 'Carlos', pin4: 'abcd' }).success).toBe(false);
    expect(ParticipantJoinSchema.safeParse({ ...baseJoin, nickname: 'Carlos', pin4: '1234' }).success).toBe(true);
  });

  it('validates 6-character room PIN strictly', () => {
    expect(ParticipantJoinSchema.safeParse({ ...baseJoin, roomPin: '12345', nickname: 'Carlos' }).success).toBe(false);
    expect(ParticipantJoinSchema.safeParse({ ...baseJoin, roomPin: '1234567', nickname: 'Carlos' }).success).toBe(false);
    expect(ParticipantJoinSchema.safeParse({ ...baseJoin, roomPin: 'ABC#45', nickname: 'Carlos' }).success).toBe(false);
    expect(ParticipantJoinSchema.safeParse({ ...baseJoin, roomPin: 'abc123', nickname: 'Carlos' }).success).toBe(true);
    if (ParticipantJoinSchema.safeParse({ ...baseJoin, roomPin: 'abc123', nickname: 'Carlos' }).success) {
      const res = ParticipantJoinSchema.parse({ ...baseJoin, roomPin: 'abc123', nickname: 'Carlos' });
      expect(res.roomPin).toBe('ABC123'); // Normalized uppercase
    }
  });
});

describe('3. Room Configuration and Mandatory Numeric Parameters', () => {
  const validOptions = [
    { title: 'Opción Alpha', description: 'Descripción de alcance 1' },
    { title: 'Opción Beta', description: 'Descripción de alcance 2' },
    { title: 'Opción Gamma', description: 'Descripción de alcance 3' },
  ];

  it('rejects room creation if mandatory numeric fields are undefined or empty', () => {
    const missingMaxMembers = {
      title: 'Priorización Anual',
      method: 'BORDA',
      minMembers: 3,
      tauThreshold: 80,
      maxRounds: 3,
      options: validOptions,
    };
    expect(CreateRoomSchema.safeParse(missingMaxMembers).success).toBe(false);

    const missingRounds = {
      title: 'Priorización Anual',
      method: 'BORDA',
      minMembers: 3,
      maxMembers: 20,
      tauThreshold: 80,
      options: validOptions,
    };
    expect(CreateRoomSchema.safeParse(missingRounds).success).toBe(false);
  });

  it('rejects maxMembers < 3 or maxMembers > 40', () => {
    const base = {
      title: 'Priorización de Equipamiento',
      method: 'BORDA' as const,
      minMembers: 3,
      tauThreshold: 80,
      maxRounds: 3,
      options: validOptions,
    };

    expect(CreateRoomSchema.safeParse({ ...base, maxMembers: 2 }).success).toBe(false);
    expect(CreateRoomSchema.safeParse({ ...base, maxMembers: 41 }).success).toBe(false);
    expect(CreateRoomSchema.safeParse({ ...base, maxMembers: 20 }).success).toBe(true);
  });

  it('rejects maxRounds < 1 or maxRounds > 10', () => {
    const base = {
      title: 'Priorización de Equipamiento',
      method: 'BORDA' as const,
      minMembers: 3,
      maxMembers: 20,
      tauThreshold: 80,
      options: validOptions,
    };

    expect(CreateRoomSchema.safeParse({ ...base, maxRounds: 0 }).success).toBe(false);
    expect(CreateRoomSchema.safeParse({ ...base, maxRounds: 11 }).success).toBe(false);
    expect(CreateRoomSchema.safeParse({ ...base, maxRounds: 5 }).success).toBe(true);
  });

  it('rejects tauThreshold < 1 or tauThreshold > 100', () => {
    const base = {
      title: 'Priorización de Equipamiento',
      method: 'BORDA' as const,
      minMembers: 3,
      maxMembers: 20,
      maxRounds: 3,
      options: validOptions,
    };

    expect(CreateRoomSchema.safeParse({ ...base, tauThreshold: 0 }).success).toBe(false);
    expect(CreateRoomSchema.safeParse({ ...base, tauThreshold: 101 }).success).toBe(false);
    const parsed = CreateRoomSchema.safeParse({ ...base, tauThreshold: 75 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tauThreshold).toBe(0.75); // Normalized percentage
    }
  });

  it('correctly transforms tauThreshold boundary values (1 -> 0.01 and 100 -> 1.0)', () => {
    const base = {
      title: 'Priorización de Equipamiento',
      method: 'BORDA' as const,
      minMembers: 3,
      maxMembers: 20,
      maxRounds: 3,
      options: validOptions,
    };

    const parsedMin = CreateRoomSchema.safeParse({ ...base, tauThreshold: 1 });
    expect(parsedMin.success).toBe(true);
    if (parsedMin.success) {
      expect(parsedMin.data.tauThreshold).toBe(0.01);
    }

    const parsedMax = CreateRoomSchema.safeParse({ ...base, tauThreshold: 100 });
    expect(parsedMax.success).toBe(true);
    if (parsedMax.success) {
      expect(parsedMax.data.tauThreshold).toBe(1.0);
    }
  });

  it('CreateRoomSchema requires integer percentage in 1..100 and normalizes to float', () => {
    const base = {
      title: 'Priorización de Equipamiento',
      method: 'BORDA' as const,
      maxMembers: 20,
      maxRounds: 3,
      options: validOptions,
    };

    // Client form state holds integer percentage (80)
    const clientState = 80;
    const parsed = CreateRoomSchema.safeParse({ ...base, tauThreshold: clientState });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tauThreshold).toBe(0.8);
    }
  });

  it('rejects fewer than 3 options or more than 8 options', () => {
    const base = {
      title: 'Priorización de Equipamiento',
      method: 'BORDA' as const,
      minMembers: 3,
      maxMembers: 20,
      maxRounds: 3,
      tauThreshold: 80,
    };

    const twoOptions = validOptions.slice(0, 2);
    expect(CreateRoomSchema.safeParse({ ...base, options: twoOptions }).success).toBe(false);

    const nineOptions = Array.from({ length: 9 }, (_, i) => ({
      title: `Opción Número ${i + 1}`,
      description: `Descripción detallada de la opción ${i + 1}`,
    }));
    expect(CreateRoomSchema.safeParse({ ...base, options: nineOptions }).success).toBe(false);
  });

  it('validates option title length (3 to 80 chars)', () => {
    const base = {
      title: 'Priorización de Equipamiento',
      method: 'BORDA' as const,
      minMembers: 3,
      maxMembers: 20,
      maxRounds: 3,
      tauThreshold: 80,
    };

    const shortOptTitle = [
      { title: 'Ab', description: '' }, // length = 2 (too short)
      validOptions[1],
      validOptions[2],
    ];
    expect(CreateRoomSchema.safeParse({ ...base, options: shortOptTitle }).success).toBe(false);
  });
});

describe('4. CSV Formula Injection Neutralization (CWE-1236)', () => {
  it('neutralizes formula injection characters (=, +, -, @, \\t, \\r)', () => {
    expect(escapeCsvField('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(escapeCsvField('+1+1')).toBe("'+1+1");
    expect(escapeCsvField('-2+2')).toBe("'-2+2");
    expect(escapeCsvField('@cmd|/C calc')).toBe("'@cmd|/C calc");
    expect(escapeCsvField('\tcmd')).toBe("'\tcmd");
  });

  it('preserves legitimate numeric negative and positive numbers without quoting issues', () => {
    expect(escapeCsvField(-0.04)).toBe('-0.04');
    expect(escapeCsvField(15)).toBe('15');
    expect(escapeCsvField(0.785)).toBe('0.785');
  });

  it('escapes quotes and commas appropriately alongside formula neutralization', () => {
    expect(escapeCsvField('=cmd, "run"')).toBe('"\'=cmd, ""run"""');
  });
});

describe('5. Temporal Brute Force Lockout Engine', () => {
  const testKey = 'test_lockout_user_123';

  beforeEach(() => {
    resetFailedAttempts(testKey);
  });

  it('permits attempts 1 to 4 without lockout', () => {
    for (let i = 1; i <= 4; i++) {
      const result = recordFailedAttempt(testKey, 5, 900);
      expect(result.isLocked).toBe(false);
      expect(result.attemptsLeft).toBe(5 - i);
    }
    const status = checkLockout(testKey);
    expect(status.isLocked).toBe(false);
  });

  it('locks out upon the 5th consecutive failure for 900 seconds (15 minutes)', () => {
    for (let i = 1; i <= 4; i++) {
      recordFailedAttempt(testKey, 5, 900);
    }
    const fifthAttempt = recordFailedAttempt(testKey, 5, 900);
    expect(fifthAttempt.isLocked).toBe(true);
    expect(fifthAttempt.remainingSec).toBeGreaterThan(890);

    const status = checkLockout(testKey);
    expect(status.isLocked).toBe(true);
    expect(status.remainingSec).toBeGreaterThan(890);
  });

  it('resets lockout tracking upon successful authentication', () => {
    recordFailedAttempt(testKey, 5, 900);
    recordFailedAttempt(testKey, 5, 900);
    resetFailedAttempts(testKey);

    const status = checkLockout(testKey);
    expect(status.isLocked).toBe(false);
  });
});

describe('6. Text Sanitization and Unicode Normalization', () => {
  it('strips non-printable ASCII and Unicode control characters while preserving accents and newlines', () => {
    const raw = 'Hola\u0000 mundo\u0007! ¿Cómo estás?\nLínea 2\u001F.';
    const cleaned = sanitizeText(raw);
    expect(cleaned).toBe('Hola mundo! ¿Cómo estás?\nLínea 2.');
  });

  it('normalizes NFKC unicode characters', () => {
    const fullwidth = 'ＦＵＬＬＷＩＤＴＨ';
    const cleaned = sanitizeText(fullwidth);
    expect(cleaned).toBe('FULLWIDTH');
  });

  it('sanitizes nicknames: trims, collapses repeated whitespace and strips control characters', () => {
    const rawNick = '  María   \u0000José  López  ';
    const cleanNick = sanitizeNickname(rawNick);
    expect(cleanNick).toBe('María José López');
  });
});

describe('7. Host Credentials and Password Length Bounds (bcrypt 72-byte limit)', () => {
  it('accepts password with 8 to 72 characters in registration', () => {
    const valid8 = 'P@ssw0rd';
    const valid72 = 'X'.repeat(72);

    expect(
      HostRegisterSchema.safeParse({
        name: 'Anfitrión Principal',
        email: 'host@test.com',
        password: valid8,
      }).success
    ).toBe(true);

    expect(
      HostRegisterSchema.safeParse({
        name: 'Anfitrión Principal',
        email: 'host@test.com',
        password: valid72,
      }).success
    ).toBe(true);
  });

  it('rejects password below 8 characters or above 72 characters in registration', () => {
    const short7 = '1234567';
    const long73 = 'X'.repeat(73);

    const resShort = HostRegisterSchema.safeParse({
      name: 'Anfitrión Principal',
      email: 'host@test.com',
      password: short7,
    });
    expect(resShort.success).toBe(false);
    if (!resShort.success) {
      expect(resShort.error.errors[0]?.message).toBe('Mínimo 8 caracteres.');
    }

    const resLong = HostRegisterSchema.safeParse({
      name: 'Anfitrión Principal',
      email: 'host@test.com',
      password: long73,
    });
    expect(resLong.success).toBe(false);
    if (!resLong.success) {
      expect(resLong.error.errors[0]?.message).toBe('Máximo 72 caracteres.');
    }
  });

  it('requires password to be non-empty in host login (no format restriction)', () => {
    expect(
      HostLoginSchema.safeParse({
        email: 'host@test.com',
        password: '',
      }).success
    ).toBe(false);

    expect(
      HostLoginSchema.safeParse({
        email: 'host@test.com',
        password: 'any-password-value',
      }).success
    ).toBe(true);
  });
});

describe('8. Additional Forms: Round Duration & Duplicate Options', () => {
  it('rejects duplicate option titles regardless of case', () => {
    const duplicateOptions = [
      { title: 'Opción Alpha', description: 'Descripción de alcance 1' },
      { title: 'opción alpha', description: 'Descripción de alcance 2' },
      { title: 'Opción Gamma', description: 'Descripción de alcance 3' },
    ];

    const result = CreateRoomSchema.safeParse({
      title: 'Priorización Anual de Equipo',
      method: 'BORDA',
      maxMembers: 10,
      maxRounds: 3,
      tauThreshold: 75,
      options: duplicateOptions,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0]?.message).toBe('No puede haber opciones con el mismo título.');
    }
  });

  // PT-28: maximum raised from 10080 minutes (1 week) to 43200 (30 days)
  it('validates round duration between 1 and 43200 minutes (presets and custom)', () => {
    expect(RoundDurationSchema.safeParse(0).success).toBe(false);
    expect(RoundDurationSchema.safeParse(1).success).toBe(true);
    expect(RoundDurationSchema.safeParse(5).success).toBe(true);
    expect(RoundDurationSchema.safeParse(60).success).toBe(true);
    expect(RoundDurationSchema.safeParse(1440).success).toBe(true);
    expect(RoundDurationSchema.safeParse(10080).success).toBe(true);
    expect(RoundDurationSchema.safeParse(43200).success).toBe(true);
    expect(RoundDurationSchema.safeParse(43201).success).toBe(false);
  });
});
