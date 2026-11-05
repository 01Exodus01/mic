/**
 * __tests__/security/highBlockTests.test.tsx
 * Tests for HIGH-01 to HIGH-16 fixes:
 *  1. PasswordInput accessible component tests (rendering, aria, isPin mode, 44x44px button)
 *  2. Room creation participant boundaries (2, 3, 40, 41)
 *  3. Verification that payloads with minMembers are ignored
 *  4. Password length boundary tests (7, 8, 72, 73 bytes)
 *  5. CSV formula injection defense with leading whitespace (CWE-1236)
 *  6. IP sanitization against X-Forwarded-For bypass (HIGH-01)
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import PasswordInput from '../../components/ui/PasswordInput';
import { CreateRoomSchema, HostRegisterSchema } from '@mic/backend/shared/validations';
import { escapeCsvField } from '@mic/backend/shared/csv';
import { extractClientIp, getClientIp } from '@mic/backend/rate-limit';

describe('HIGH-06: PasswordInput Accessible Component', () => {
  it('renders standard password input with accessible toggle button', () => {
    const html = renderToStaticMarkup(
      <PasswordInput
        id="test-pwd"
        placeholder="Introduce contraseña"
        autoComplete="current-password"
      />
    );

    // Initial input type is password
    expect(html).toContain('type="password"');
    expect(html).toContain('id="test-pwd"');
    expect(html).toContain('autoComplete="current-password"');

    // Toggle button accessible attributes
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Mostrar contraseña"');
    expect(html).toContain('aria-pressed="false"');

    // Minimum touch target 44x44px
    expect(html).toContain('min-w-[44px]');
    expect(html).toContain('min-h-[44px]');
  });

  it('renders PIN mode with 4-digit constraints and Plex Mono styling', () => {
    const html = renderToStaticMarkup(
      <PasswordInput
        id="test-pin"
        isPin
        placeholder="••••"
      />
    );

    expect(html).toContain('type="password"');
    expect(html).toContain('maxLength="4"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('pattern="[0-9]*"');
    expect(html).toContain('font-mono');
    expect(html).toContain('text-center');
    expect(html).toContain('aria-label="Mostrar PIN"');
    expect(html).toContain('aria-pressed="false"');
  });
});

describe('HIGH-12: Room Creation Participant Boundaries (2, 3, 40, 41)', () => {
  const validOptions = [
    { title: 'Opción Alpha', description: 'Descripción detallada 1' },
    { title: 'Opción Beta', description: 'Descripción detallada 2' },
    { title: 'Opción Gamma', description: 'Descripción detallada 3' },
  ];

  const baseRoom = {
    title: 'Priorización Anual de Recursos',
    method: 'BORDA' as const,
    tauThreshold: 80,
    maxRounds: 3,
    options: validOptions,
  };

  it('rejects 2 participants (below minimum 3)', () => {
    const res = CreateRoomSchema.safeParse({ ...baseRoom, maxMembers: 2 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0]?.message).toMatch(/mínimo 3 participantes/i);
    }
  });

  it('accepts 3 participants (lower boundary)', () => {
    const res = CreateRoomSchema.safeParse({ ...baseRoom, maxMembers: 3 });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.maxMembers).toBe(3);
    }
  });

  it('accepts 40 participants (upper boundary)', () => {
    const res = CreateRoomSchema.safeParse({ ...baseRoom, maxMembers: 40 });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.maxMembers).toBe(40);
    }
  });

  it('rejects 41 participants (above maximum 40)', () => {
    const res = CreateRoomSchema.safeParse({ ...baseRoom, maxMembers: 41 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0]?.message).toMatch(/máximo 40 participantes/i);
    }
  });

  it('ignores minMembers in room creation payloads (HIGH-05 & HIGH-12)', () => {
    const payloadWithMinMembers = {
      ...baseRoom,
      maxMembers: 15,
      minMembers: 999, // Should be ignored without failing schema
    };

    const res = CreateRoomSchema.safeParse(payloadWithMinMembers);
    expect(res.success).toBe(true);
    if (res.success) {
      expect((res.data as Record<string, unknown>).minMembers).toBeUndefined();
      expect(res.data.maxMembers).toBe(15);
    }
  });
});

describe('HIGH-12: Password Length Boundaries (7, 8, 72, 73 bytes)', () => {
  const baseAccount = {
    name: 'Anfitrión GDSS',
    email: 'host@gdss.org',
  };

  it('rejects 7-character password (below minimum 8)', () => {
    const res = HostRegisterSchema.safeParse({
      ...baseAccount,
      password: 'A1b2C3d', // 7 chars
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0]?.message).toBe('Mínimo 8 caracteres.');
    }
  });

  it('accepts 8-character password (lower boundary)', () => {
    const res = HostRegisterSchema.safeParse({
      ...baseAccount,
      password: 'A1b2C3d4', // 8 chars
    });
    expect(res.success).toBe(true);
  });

  it('accepts 72-character password (upper boundary)', () => {
    const res = HostRegisterSchema.safeParse({
      ...baseAccount,
      password: 'X'.repeat(72), // 72 chars
    });
    expect(res.success).toBe(true);
  });

  it('rejects 73-character password (above maximum 72)', () => {
    const res = HostRegisterSchema.safeParse({
      ...baseAccount,
      password: 'X'.repeat(73), // 73 chars
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0]?.message).toBe('Máximo 72 caracteres.');
    }
  });
});

describe('HIGH-02: CSV Formula Injection Defense With Leading Spaces', () => {
  it('neutralizes formulas preceded by spaces, tabs or newlines', () => {
    expect(escapeCsvField('   =CMD()')).toBe("'   =CMD()");
    expect(escapeCsvField('  +1+1')).toBe("'  +1+1");
    expect(escapeCsvField('\t-2+2')).toBe("'\t-2+2");
    expect(escapeCsvField('   @SUM(A1:A5)')).toBe("'   @SUM(A1:A5)");
    expect(escapeCsvField(' \r =10+20')).toBe('"\' \r =10+20"');
  });
});

describe('HIGH-01 / AUD-05: Client IP Extraction with TRUSTED_PROXY_HOPS', () => {
  it('ignores untrusted proxy headers when TRUSTED_PROXY_HOPS is 0 (default)', () => {
    const ip = extractClientIp('203.0.113.195, 70.41.3.18, 150.172.238.178', null, 0);
    expect(ip).toBe('127.0.0.1');
  });

  it('extracts trusted hop from the right when TRUSTED_PROXY_HOPS > 0', () => {
    // 1 hop: takes the last proxy entry
    const ip1 = extractClientIp('203.0.113.195, 70.41.3.18, 150.172.238.178', null, 1);
    expect(ip1).toBe('150.172.238.178');

    // 3 hops: takes 3rd from right
    const ip3 = extractClientIp('203.0.113.195, 70.41.3.18, 150.172.238.178', null, 3);
    expect(ip3).toBe('203.0.113.195');
  });

  it('falls back to X-Real-IP if X-Forwarded-For contains no valid IP with trusted hop', () => {
    const ip = extractClientIp('invalid_ip_string', '192.0.2.1', 1);
    expect(ip).toBe('192.0.2.1');
  });

  it('works with getClientIp helper using header get method and trusted hop', () => {
    const mockHeaders = {
      get: (header: string) => {
        if (header.toLowerCase() === 'x-forwarded-for') {
          return '198.51.100.55, 10.0.0.2';
        }
        return null;
      },
    };
    expect(getClientIp(mockHeaders, 1)).toBe('10.0.0.2');
    expect(getClientIp(mockHeaders, 2)).toBe('198.51.100.55');
  });

  it('returns default fallback 127.0.0.1 when no valid IP header is provided', () => {
    const emptyHeaders = { get: () => null };
    expect(getClientIp(emptyHeaders)).toBe('127.0.0.1');
  });
});
