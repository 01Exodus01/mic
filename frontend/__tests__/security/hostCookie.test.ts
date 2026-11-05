/**
 * __tests__/security/hostCookie.test.ts
 * PT-05: the host session cookie is SameSite=Strict, HttpOnly, path "/", as
 * docs/auditoria-fase-b.md (AUD-28) states. Login was checked end to end.
 */

import { describe, it, expect } from 'vitest';
import { authOptions } from '@/lib/auth';

describe('PT-05: cookie de sesión del anfitrión', () => {
  it('usa SameSite=Strict, HttpOnly y path "/"', () => {
    const options = authOptions.cookies?.sessionToken?.options;
    expect(options).toMatchObject({ sameSite: 'strict', httpOnly: true, path: '/' });
  });
});
