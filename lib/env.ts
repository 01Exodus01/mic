/**
 * lib/env.ts
 * Fail-fast validation of required environment variables.
 * Enforces rule: secrets must be at least 32 characters long and system fails at startup if missing.
 */

import fs from 'fs';
import path from 'path';

function loadDotenvIfNeeded() {
  if (process.env.NEXTAUTH_SECRET && process.env.WORKER_SECRET) return;
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch {
    // Ignore error
  }
}

loadDotenvIfNeeded();

function validateSecret(name: string, value: string | undefined): string {
  if (!value || value.trim().length < 32) {
    throw new Error(
      `[SEGURIDAD] Variable de entorno obligatoria '${name}' falta o tiene menos de 32 caracteres (${value ? value.trim().length : 0} caracteres). El arranque falla de acuerdo con AGENTS.md.`
    );
  }
  return value.trim();
}

export function getValidatedEnv() {
  loadDotenvIfNeeded();
  const nextAuthSecret = validateSecret('NEXTAUTH_SECRET', process.env.NEXTAUTH_SECRET);
  const workerSecret = validateSecret('WORKER_SECRET', process.env.WORKER_SECRET);

  return {
    NEXTAUTH_SECRET: nextAuthSecret,
    WORKER_SECRET: workerSecret,
    DATABASE_URL: process.env.DATABASE_URL || '',
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'http://localhost:3000',
    BACKGROUND_WORKER_INTERVAL_SEC: parseInt(process.env.BACKGROUND_WORKER_INTERVAL_SEC || '60', 10),
    TRUSTED_PROXY_HOPS: parseInt(process.env.TRUSTED_PROXY_HOPS || '0', 10),
    NODE_ENV: process.env.NODE_ENV || 'development',
  };
}

/**
 * Invite code required to register a host account. Read at call time.
 * Missing or empty means host registration is closed.
 */
export function getHostInviteCode(): string | null {
  loadDotenvIfNeeded();
  const value = (process.env.HOST_INVITE_CODE || '').trim();
  return value.length > 0 ? value : null;
}

export const env = getValidatedEnv();
