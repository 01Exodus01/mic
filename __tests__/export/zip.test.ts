/**
 * __tests__/export/zip.test.ts
 * Plan de mejora P3.1: the dependency-free ZIP writer produces archives that
 * standard tools open, with correct CRC-32 and UTF-8 names.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createZip, crc32 } from '@mic/backend/export/zip';
import { readZip } from '../helpers/readZip';

const hasUnzip = (() => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('P3.1: ZIP sin dependencias', () => {
  const files = [
    { name: 'rooms.csv', data: Buffer.from('﻿room_id,room_name\r\nr1,Votación de café ñandú\r\n', 'utf8') },
    { name: 'vacío.txt', data: Buffer.alloc(0) },
    { name: 'grande.csv', data: Buffer.from('a,b,c\r\n'.repeat(20000), 'utf8') },
  ];

  it('CRC-32 estándar', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it('se lee de vuelta byte por byte y comprime', () => {
    const zip = createZip(files, new Date('2026-11-05T10:20:30Z'));
    const back = readZip(zip);
    expect([...back.keys()]).toEqual(files.map((f) => f.name));
    for (const f of files) expect(back.get(f.name)!.equals(f.data)).toBe(true);
    expect(zip.length).toBeLessThan(files[2].data.length / 10);
  });

  it.skipIf(!hasUnzip)('unzip lo valida y extrae lo mismo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
    try {
      const file = path.join(dir, 'export.zip');
      fs.writeFileSync(file, createZip(files));
      expect(execFileSync('unzip', ['-t', file]).toString()).toMatch(/No errors detected/);
      execFileSync('unzip', ['-q', file, '-d', path.join(dir, 'out')]);
      expect(fs.readFileSync(path.join(dir, 'out', 'rooms.csv')).equals(files[0].data)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
