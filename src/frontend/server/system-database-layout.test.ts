import { describe, expect, test } from 'bun:test';

import { DatabaseError } from '../../databases';
import { createPlatformSQLiteService } from '../../persistence';
import { assertApplicationDatabaseHasNoLegacySystemLayout } from './system-database-layout';

describe('legacy combined database fence', () => {
  test('allows a clean application database', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    try {
      sqlite.raw.run('CREATE TABLE todos (id TEXT PRIMARY KEY)');
      expect(() => assertApplicationDatabaseHasNoLegacySystemLayout(sqlite))
        .not.toThrow();
    } finally {
      sqlite.close();
    }
  });

  test('allows the ID-only Guardian user anchor on application database restart', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    try {
      sqlite.raw.run('CREATE TABLE users (user_id TEXT PRIMARY KEY)');
      expect(() => assertApplicationDatabaseHasNoLegacySystemLayout(sqlite))
        .not.toThrow();
    } finally {
      sqlite.close();
    }
  });

  test('allows an application-owned users table without Guardian companions', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    try {
      sqlite.raw.run(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          marketing_opt_in INTEGER NOT NULL DEFAULT 0
        )
      `);
      expect(() => assertApplicationDatabaseHasNoLegacySystemLayout(sqlite))
        .not.toThrow();
    } finally {
      sqlite.close();
    }
  });

  test('does not mistake application migration ledgers for legacy authority', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    try {
      sqlite.raw.run('CREATE TABLE _migrations (version TEXT PRIMARY KEY)');
      sqlite.raw.run('CREATE TABLE _zero_migrations (id TEXT PRIMARY KEY)');
      expect(() => assertApplicationDatabaseHasNoLegacySystemLayout(sqlite))
        .not.toThrow();
    } finally {
      sqlite.close();
    }
  });

  test('detects actual legacy Guardian and Zero authority tables', () => {
    for (const table of [
      '_credentials',
      '_refresh_tokens',
      '_zero_action_tokens',
      '_zero_resume_tokens',
    ]) {
      const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
      try {
        sqlite.raw.run(`CREATE TABLE ${table} (token_hash TEXT PRIMARY KEY)`);
        expect(() => assertApplicationDatabaseHasNoLegacySystemLayout(sqlite))
          .toThrow(DatabaseError);
      } finally {
        sqlite.close();
      }
    }
  });

  test('fails closed without changing a legacy combined database', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    try {
      sqlite.raw.run('CREATE TABLE users (id TEXT PRIMARY KEY)');
      sqlite.raw.run('CREATE TABLE _auth_config (key TEXT PRIMARY KEY)');
      let failure: unknown;
      try {
        assertApplicationDatabaseHasNoLegacySystemLayout(sqlite);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(DatabaseError);
      expect(failure).toMatchObject({
        code: 'DATABASE_SCHEMA_MISMATCH',
        retryable: false,
        outcome: 'not-started',
        details: {
          layout: 'legacy-combined',
          requiredAction: 'split-system-database',
        },
      });
      expect(sqlite.raw.query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'",
      ).get()).toBeTruthy();
    } finally {
      sqlite.close();
    }
  });
});
