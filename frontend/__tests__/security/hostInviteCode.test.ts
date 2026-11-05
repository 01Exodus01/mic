/**
 * __tests__/security/hostInviteCode.test.ts
 * PT-04: creating a host account requires the invite code from HOST_INVITE_CODE.
 * Without the variable, registration is closed. Login does not change.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const created: Array<{ email: string }> = [];

vi.mock('next/headers', () => ({ headers: () => new Headers() }));

vi.mock('@mic/backend/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetIn: 0 }),
  getClientIp: () => '127.0.0.1',
}));

vi.mock('@mic/backend/db', () => ({
  default: {
    user: {
      findUnique: async () => null,
      create: async ({ data }: { data: { email: string } }) => {
        created.push({ email: data.email });
        return { id: 'new-user', ...data };
      },
    },
  },
}));

const GOOD_CODE = 'codigo-de-invitacion-de-prueba';
const GENERIC_ERROR = 'No se pudo crear la cuenta con ese código de invitación.';
const originalCode = process.env.HOST_INVITE_CODE;

async function register(inviteCode: string) {
  const { registerHost } = await import('@/app/actions/auth');
  return registerHost('Anfitrión Prueba', 'host@example.test', 'una-clave-larga', inviteCode);
}

describe('PT-04: registro de anfitrión con código de invitación', () => {
  beforeEach(() => {
    created.length = 0;
  });

  afterEach(() => {
    if (originalCode === undefined) delete process.env.HOST_INVITE_CODE;
    else process.env.HOST_INVITE_CODE = originalCode;
  });

  it('sin HOST_INVITE_CODE el registro queda cerrado, incluso con un código', async () => {
    delete process.env.HOST_INVITE_CODE;
    const res = await register(GOOD_CODE);
    expect(res).toEqual({ success: false, error: GENERIC_ERROR });
    expect(created).toHaveLength(0);
  });

  it('HOST_INVITE_CODE vacío o solo espacios también cierra el registro', async () => {
    process.env.HOST_INVITE_CODE = '   ';
    const res = await register('   ');
    expect(res).toEqual({ success: false, error: GENERIC_ERROR });
    expect(created).toHaveLength(0);
  });

  it('código ausente o incorrecto falla con el mismo mensaje genérico', async () => {
    process.env.HOST_INVITE_CODE = GOOD_CODE;
    for (const code of ['', 'otro-codigo', GOOD_CODE + 'x', GOOD_CODE.toUpperCase()]) {
      const res = await register(code);
      expect(res).toEqual({ success: false, error: GENERIC_ERROR });
    }
    expect(created).toHaveLength(0);
  });

  it('el mensaje de error no revela el código esperado', async () => {
    process.env.HOST_INVITE_CODE = GOOD_CODE;
    const res = await register('otro-codigo');
    expect(JSON.stringify(res)).not.toContain(GOOD_CODE);
  });

  it('con el código correcto crea la cuenta', async () => {
    process.env.HOST_INVITE_CODE = GOOD_CODE;
    const res = await register(`  ${GOOD_CODE}  `);
    expect(res).toEqual({ success: true });
    expect(created).toEqual([{ email: 'host@example.test' }]);
  });

  it('el inicio de sesión no depende del código de invitación', () => {
    for (const file of ['../../lib/auth.ts', '../../../backend/src/services/host-login.ts']) {
      const authSource = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
      expect(authSource, file).not.toContain('HOST_INVITE_CODE');
      expect(authSource, file).not.toContain('getHostInviteCode');
    }
  });
});
