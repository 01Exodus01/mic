/**
 * __tests__/security/contentSecurityPolicy.test.ts
 * PT-35: production CSP without 'unsafe-eval' and with object-src, base-uri and
 * form-action locked down. 'unsafe-inline' stays for scripts (Next.js inline
 * bootstrap; a nonce would need per-request middleware on every route) and
 * styles (React style attributes). Checked in a production build: no CSP errors.
 */

import { describe, it, expect, vi } from 'vitest';

async function cspFor(nodeEnv: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  const mod = (await import('../../next.config.mjs')) as {
    default: { headers: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>> };
  };
  const headers = await mod.default.headers();
  vi.unstubAllEnvs();
  return headers[0].headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
}

describe('PT-35: Content-Security-Policy', () => {
  it('en producción no permite eval y cierra object-src, base-uri y form-action', async () => {
    const csp = await cspFor('production');
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it('en desarrollo mantiene unsafe-eval para la recarga en caliente', async () => {
    expect(await cspFor('development')).toContain("'unsafe-eval'");
  });
});
