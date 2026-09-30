import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';

import { createPlatformSQLiteService } from '../../persistence';
import { DatabaseError } from '../../databases';
import {
  assertCanonicalSeparateDatabaseConfigs,
  resolveSystemDatabaseConfig,
  resolveSystemDatabaseOwnedPaths,
  type SystemDatabaseConfig,
} from './system-database-config';

const typedSystemDatabaseConfig: SystemDatabaseConfig = {
  mode: 'file',
  path: './data/control.db',
};
const rawSystemDatabaseConfig: SystemDatabaseConfig = {
  // @ts-expect-error Managed system databases reject caller-owned raw handles.
  database: null as unknown as Database,
};
void typedSystemDatabaseConfig;
void rawSystemDatabaseConfig;

describe('system database configuration', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('defaults to an independent placement matching app durability', () => {
    expect(resolveSystemDatabaseConfig({ mode: 'memory' }, undefined))
      .toEqual({ mode: 'ephemeral' });
    expect(resolveSystemDatabaseConfig({
      mode: 'file',
      path: './data/application.db',
    }, undefined)).toEqual({
      mode: 'file',
      path: './data/zero.system.db',
    });
  });

  test('preserves an explicit separate system database', () => {
    const configured = {
      mode: 'hot' as const,
      path: './data/control.db',
      snapshotPath: './data/control.snapshot.db',
    };
    expect(resolveSystemDatabaseConfig({
      mode: 'file',
      path: './data/application.db',
    }, configured)).toBe(configured);
  });

  test('rejects shared handles and owned paths', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    try {
      let sharedHandleFailure: unknown;
      try {
        resolveSystemDatabaseConfig({ sqlite }, { sqlite });
      } catch (error) {
        sharedHandleFailure = error;
      }
      expect(sharedHandleFailure).toBeInstanceOf(DatabaseError);
      expect(sharedHandleFailure).toMatchObject({
        code: 'DATABASE_CONFIG_INVALID',
        retryable: false,
        outcome: 'not-started',
      });
      expect((sharedHandleFailure as Error).message)
        .toContain('must use separate SQLite services');
    } finally {
      sqlite.close();
    }

    expect(() => resolveSystemDatabaseConfig(
      { mode: 'file', path: './data/shared.db' },
      { mode: 'file', path: './DATA/SHARED.DB' },
    )).toThrow(expect.objectContaining({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
    }));

    expect(() => resolveSystemDatabaseConfig(
      { mode: 'file', path: './data/system.db.authority-fence.sqlite' },
      { mode: 'file', path: './data/system.db' },
    )).toThrow(expect.objectContaining({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
    }));
    expect(resolveSystemDatabaseOwnedPaths({
      mode: 'file',
      path: './data/system.db',
    })).toContain('./data/system.db.authority-fence.sqlite');
  });

  test('rejects filesystem aliases before either database opens', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-system-db-config-'));
    roots.push(root);
    const real = join(root, 'real');
    const alias = join(root, 'alias');
    mkdirSync(real);
    symlinkSync(real, alias, 'dir');

    expect(() => assertCanonicalSeparateDatabaseConfigs(
      { mode: 'file', path: join(real, 'shared.db') },
      { mode: 'file', path: join(alias, 'shared.db') },
    )).toThrow(expect.objectContaining({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
    }));
  });
});
