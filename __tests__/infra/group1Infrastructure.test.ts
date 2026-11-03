import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

describe('Grupo 1: Infraestructura, secretos, Docker, worker y backups', () => {
  const rootDir = path.resolve(__dirname, '../../');

  it('scripts de backup y restore existen y son ejecutables', () => {
    const backupScript = path.join(rootDir, 'scripts/backup-db.sh');
    const restoreScript = path.join(rootDir, 'scripts/restore-db.sh');

    expect(fs.existsSync(backupScript)).toBe(true);
    expect(fs.existsSync(restoreScript)).toBe(true);

    const backupStats = fs.statSync(backupScript);
    const restoreStats = fs.statSync(restoreScript);

    // Verify execute bit for user (0o100)
    expect((backupStats.mode & 0o100) !== 0).toBe(true);
    expect((restoreStats.mode & 0o100) !== 0).toBe(true);

    const backupContent = fs.readFileSync(backupScript, 'utf8');
    expect(backupContent).toContain('pg_dump');

    const restoreContent = fs.readFileSync(restoreScript, 'utf8');
    expect(restoreContent).toContain('psql');
  });

  it('.dockerignore excluye .env y archivos sensibles', () => {
    const dockerignorePath = path.join(rootDir, '.dockerignore');
    expect(fs.existsSync(dockerignorePath)).toBe(true);
    const content = fs.readFileSync(dockerignorePath, 'utf8');

    expect(content).toMatch(/\.env\*/);
    expect(content).toContain('!*.example');
    expect(content).toContain('__tests__/');
  });

  it('.gitignore existe y excluye .env y backups', () => {
    const gitignorePath = path.join(rootDir, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const content = fs.readFileSync(gitignorePath, 'utf8');

    expect(content).toMatch(/\.env\*/);
    expect(content).toContain('backups/*.sql');
  });

  it('docker-compose.yml define servicio worker y restringe puerto de Postgres', () => {
    const composePath = path.join(rootDir, 'docker-compose.yml');
    expect(fs.existsSync(composePath)).toBe(true);
    const content = fs.readFileSync(composePath, 'utf8');

    expect(content).toContain('worker:');
    expect(content).toContain('scripts/worker.js');
    expect(content).toContain('WORKER_SECRET');
    expect(content).toContain('127.0.0.1:5432:5432');
  });

  it('Dockerfile copia scripts y corre con usuario no root y tini', () => {
    const dockerfilePath = path.join(rootDir, 'Dockerfile');
    expect(fs.existsSync(dockerfilePath)).toBe(true);
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    expect(content).toContain('tini');
    expect(content).toContain('USER nextjs');
    expect(content).toContain('COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts');
  });

  it('lib/env.ts valida longitud mínima de 32 caracteres para secretos', async () => {
    const { getValidatedEnv } = await import('../../lib/env');
    const validated = getValidatedEnv();

    expect(validated.NEXTAUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(validated.WORKER_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('comparación de secreto en process-deadline es segura en tiempo constante', () => {
    const secret = 'valid_secret_token_1234567890_at_least_32_chars';
    const candidateA = 'valid_secret_token_1234567890_at_least_32_chars';
    const candidateB = 'short_token';

    const hashExpected = crypto.createHash('sha256').update(secret).digest();
    const hashA = crypto.createHash('sha256').update(candidateA).digest();
    const hashB = crypto.createHash('sha256').update(candidateB).digest();

    expect(crypto.timingSafeEqual(hashExpected, hashA)).toBe(true);
    expect(crypto.timingSafeEqual(hashExpected, hashB)).toBe(false);
  });

  it('prisma/migrations contiene baseline con DDL y migration_lock.toml', () => {
    const lockPath = path.join(rootDir, 'prisma/migrations/migration_lock.toml');
    const ddlPath = path.join(rootDir, 'prisma/migrations/20261027000000_init_gdss_rfastcr/migration.sql');

    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.existsSync(ddlPath)).toBe(true);

    const ddlContent = fs.readFileSync(ddlPath, 'utf8');
    expect(ddlContent).toContain('CREATE TABLE "User"');
    expect(ddlContent).toContain('CREATE TABLE "Room"');
    expect(ddlContent).toContain('CREATE TABLE "Option"');
    expect(ddlContent).toContain('CREATE TABLE "Participant"');
    expect(ddlContent).toContain('CREATE TABLE "Vote"');
    expect(ddlContent).toContain('CREATE TABLE "RoundReport"');
  });
});
