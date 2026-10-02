import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SYSTEM_MIGRATION_DATABASE_PATH,
  resolveMigrationCliTarget,
} from './migration-cli-target';

describe('migration CLI database targeting', () => {
  test('defaults framework migrations to the separated system database', () => {
    expect(resolveMigrationCliTarget({ schemaInspection: false })).toEqual({
      path: DEFAULT_SYSTEM_MIGRATION_DATABASE_PATH,
      plane: 'system',
      source: 'default',
    });
  });

  test('uses the documented system database environment path', () => {
    expect(resolveMigrationCliTarget({
      schemaInspection: false,
      systemDbPath: './state/custom.system.db',
    })).toEqual({
      path: './state/custom.system.db',
      plane: 'system',
      source: 'SYSTEM_DB_PATH',
    });
  });

  test('treats --db as an intentional exact system migration target', () => {
    expect(resolveMigrationCliTarget({
      explicitDbPath: './scratch/exact.db',
      schemaInspection: false,
      systemDbPath: './state/custom.system.db',
    })).toEqual({
      path: './scratch/exact.db',
      plane: 'system',
      source: '--db',
    });
  });

  test('requires an explicit application database for schema inspection', () => {
    expect(() => resolveMigrationCliTarget({
      schemaInspection: true,
      systemDbPath: './state/custom.system.db',
    })).toThrow('requires --db <application-db>');
  });

  test('never inherits the system target for app schema inspection', () => {
    expect(resolveMigrationCliTarget({
      explicitDbPath: './data/app.db',
      schemaInspection: true,
      systemDbPath: './data/zero.system.db',
    })).toEqual({
      path: './data/app.db',
      plane: 'application-schema',
      source: '--db',
    });
  });

  test('rejects blank explicit schema targets instead of falling back', () => {
    expect(() => resolveMigrationCliTarget({
      explicitDbPath: '   ',
      schemaInspection: true,
    })).toThrow('requires --db <application-db>');
  });
});
