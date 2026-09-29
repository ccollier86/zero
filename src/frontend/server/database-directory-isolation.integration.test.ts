import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineDatabaseRealm } from '../../databases/database-realm';
import { createApp } from './app-factory';

test('createApp rejects canonical control/Fabric overlap before startup side effects', async () => {
  if (process.platform === 'win32') return;

  const base = await mkdtemp(join(tmpdir(), 'zero-directory-isolation-'));
  try {
    const physical = join(base, 'physical');
    const physicalFabric = join(physical, 'fabric');
    const alias = join(base, 'alias');
    const controlPath = join(physicalFabric, 'control.db');
    const outDir = join(physical, 'build');
    const storageDir = join(physical, 'storage');
    const tables = { notes: { id: 'text primary key' } };

    await mkdir(physicalFabric, { recursive: true });
    await symlink(physical, alias, 'dir');

    await expect(createApp({
      db: { mode: 'file', path: controlPath },
      tables,
      auth: false,
      outDir,
      storageDir,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: join(alias, 'fabric'),
        realm: defineDatabaseRealm({
          name: 'directory-isolation-test',
          version: '1',
          tables,
        }),
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
      },
    })).rejects.toThrow(
      'databaseTopology.rootDirectory must not overlap a default/control database path',
    );

    expect(existsSync(controlPath)).toBe(false);
    expect(existsSync(outDir)).toBe(false);
    expect(existsSync(storageDir)).toBe(false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('createApp rejects initially-missing case-only ownership aliases', async () => {
  const base = await mkdtemp(join(tmpdir(), 'zero-directory-case-isolation-'));
  try {
    const rootDirectory = join(base, 'Fabric');
    const outDir = join(base, 'fabric', 'build');
    const storageDir = join(base, 'storage');
    const tables = { notes: { id: 'text primary key' } };

    await expect(createApp({
      db: { mode: 'memory' },
      tables,
      auth: false,
      outDir,
      storageDir,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory,
        realm: defineDatabaseRealm({
          name: 'directory-case-isolation-test',
          version: '1',
          tables,
        }),
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
      },
    })).rejects.toThrow(
      'databaseTopology.rootDirectory must not overlap outDir',
    );

    expect(existsSync(rootDirectory)).toBe(false);
    expect(existsSync(outDir)).toBe(false);
    expect(existsSync(storageDir)).toBe(false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
