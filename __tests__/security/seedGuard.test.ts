/**
 * __tests__/security/seedGuard.test.ts
 * PT-03: the destructive seed refuses to run in production and takes the host
 * credentials from the environment instead of the source code.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const seedPath = path.resolve(__dirname, '../../backend/prisma/seed.js');
const seed = require(seedPath) as {
  assertSeedAllowed: (env: Record<string, string | undefined>) => void;
  readSeedHostConfig: (env: Record<string, string | undefined>) => { email: string; password: string; name: string };
  main: (env: Record<string, string | undefined>) => Promise<void>;
};

const validEnv = {
  SEED_HOST_EMAIL: 'host@example.test',
  SEED_HOST_PASSWORD: 'una-clave-larga',
};

describe('PT-03: guardián del seed', () => {
  it('se niega a correr con NODE_ENV=production', () => {
    expect(() => seed.assertSeedAllowed({ NODE_ENV: 'production' })).toThrow(/ALLOW_PRODUCTION_SEED=true/);
    expect(() => seed.assertSeedAllowed({ NODE_ENV: 'production', ALLOW_PRODUCTION_SEED: '1' })).toThrow();
  });

  it('corre en producción solo con ALLOW_PRODUCTION_SEED=true y fuera de producción', () => {
    expect(() => seed.assertSeedAllowed({ NODE_ENV: 'production', ALLOW_PRODUCTION_SEED: 'true' })).not.toThrow();
    expect(() => seed.assertSeedAllowed({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => seed.assertSeedAllowed({})).not.toThrow();
  });

  it('en producción falla antes de abrir la base', async () => {
    // Sin DATABASE_URL: si llegara a crear el cliente y consultar, el error sería otro.
    await expect(seed.main({ NODE_ENV: 'production', ...validEnv })).rejects.toThrow(/ALLOW_PRODUCTION_SEED/);
  });

  it('exige correo y contraseña del entorno', () => {
    expect(() => seed.readSeedHostConfig({})).toThrow(/SEED_HOST_EMAIL/);
    expect(() => seed.readSeedHostConfig({ SEED_HOST_EMAIL: 'host@example.test' })).toThrow(/SEED_HOST_PASSWORD/);
    expect(() => seed.readSeedHostConfig({ ...validEnv, SEED_HOST_PASSWORD: 'corta' })).toThrow(/SEED_HOST_PASSWORD/);
    expect(() => seed.readSeedHostConfig({ ...validEnv, SEED_HOST_PASSWORD: 'x'.repeat(73) })).toThrow(/SEED_HOST_PASSWORD/);
    expect(seed.readSeedHostConfig(validEnv)).toEqual({
      email: 'host@example.test',
      password: 'una-clave-larga',
      name: 'Anfitrión de prueba',
    });
  });

  it('el script no contiene credenciales fijas', () => {
    const source = fs.readFileSync(seedPath, 'utf8');
    expect(source).not.toMatch(/\$2[aby]\$\d{2}\$/);
    expect(source).not.toContain('DocentePass');
    expect(source).not.toContain('docente@universidad.edu');
  });
});
