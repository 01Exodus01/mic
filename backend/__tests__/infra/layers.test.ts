/**
 * backend/__tests__/infra/layers.test.ts
 * Layer rules of the monorepo (frontend/backend separation):
 *  1. backend/ never imports Next.js, NextAuth, React or frontend code (@/…).
 *  2. frontend/ reaches the backend only through services/*, shared/*, plus
 *     env (secrets of the web layer) and rate-limit (client IP from headers);
 *     never the database client or @prisma/client.
 *  3. Code that runs in the browser ('use client') imports only shared/*.
 *  4. Server actions are thin adapters: no database access, and the host
 *     login check is never exposed as a server action.
 * Tests are exempt (they build fixtures with Prisma on purpose).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SKIP = new Set(['node_modules', '.next', '__tests__']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Module specifiers a file imports (static, dynamic, require, re-export). */
function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const specs: string[] = [];
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|^import\s+['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(re)) specs.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return specs;
}

const rel = (f: string) => path.relative(ROOT, f);
const backendFiles = [...sourceFiles(path.join(ROOT, 'backend/src')), path.join(ROOT, 'backend/worker.js')];
const frontendFiles = sourceFiles(path.join(ROOT, 'frontend'));

describe('capas: backend independiente de la web', () => {
  it('el backend no importa Next.js, NextAuth, React ni código del frontend', () => {
    const bad = backendFiles.flatMap((f) =>
      importsOf(f)
        .filter((s) => /^(next|next-auth|react|react-dom)(\/|$)/.test(s) || s.startsWith('@/') || s.includes('frontend/'))
        .map((s) => `${rel(f)} → ${s}`)
    );
    expect(bad).toEqual([]);
  });

  it('hay código en ambas capas (la prueba mira donde corresponde)', () => {
    expect(backendFiles.length).toBeGreaterThan(30);
    expect(frontendFiles.length).toBeGreaterThan(40);
  });
});

describe('capas: el frontend usa el backend solo por sus puertas', () => {
  const ALLOWED = /^@mic\/backend\/(services\/|shared\/|env$|rate-limit$)/;

  it('solo services/*, shared/*, env y rate-limit; nunca la base de datos', () => {
    const bad = frontendFiles.flatMap((f) =>
      importsOf(f)
        .filter((s) => (s.startsWith('@mic/backend/') && !ALLOWED.test(s)) || s.startsWith('@prisma/client') || s.includes('backend/src'))
        .map((s) => `${rel(f)} → ${s}`)
    );
    expect(bad).toEqual([]);
  });

  it("lo que corre en el navegador ('use client') importa solo shared/*", () => {
    const clientFiles = frontendFiles.filter((f) => /^\s*['"]use client['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(clientFiles.length).toBeGreaterThan(10);
    const bad = clientFiles.flatMap((f) =>
      importsOf(f)
        .filter((s) => s.startsWith('@mic/backend/') && !s.startsWith('@mic/backend/shared/'))
        .map((s) => `${rel(f)} → ${s}`)
    );
    expect(bad).toEqual([]);
  });

  it('las server actions son adaptadores: sin base de datos y sin exponer el login', () => {
    const actions = sourceFiles(path.join(ROOT, 'frontend/app/actions'));
    expect(actions.length).toBe(3);
    for (const f of actions) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src.startsWith("'use server';"), rel(f)).toBe(true);
      expect(importsOf(f).sort(), rel(f)).toEqual(
        [`@mic/backend/services/${path.basename(f, '.ts')}`, `@mic/backend/services/${path.basename(f, '.ts')}`, '@/lib/request-context'].sort()
      );
      expect(src, rel(f)).not.toMatch(/prisma|host-login|authenticateHost|host-dashboard/);
    }
  });
});
