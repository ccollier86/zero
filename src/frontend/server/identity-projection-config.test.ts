import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { DatabaseError } from '../../databases/database-error';
import { defineTable, field } from '../../schema';
import {
  assertApplicationGuardianReferenceStorage,
  assertAppIdentityProjectionConfiguration,
} from './identity-projection-runtime';
import { createApp } from './app-factory';

describe('managed Guardian identity projection configuration', () => {
  test('rejects every Guardian reference when auth is disabled', () => {
    const records = defineTable('records', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'record_id' });

    expect(() => assertAppIdentityProjectionConfiguration({
      tables: { records: records.serverTable },
      authEnabled: false,
      tenancyMode: 'single',
    })).toThrow(expect.objectContaining({
      name: 'DatabaseError',
      code: 'DATABASE_CONFIG_INVALID',
      message: '[app] Guardian identity references require Guardian auth to be enabled.',
      retryable: false,
      outcome: 'not-started',
      details: {
        component: 'guardian-identity-projection',
        reason: 'auth-required',
      },
    }));
  });

  test('enforces the projection contract at managed app startup', async () => {
    const records = defineTable('records', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'record_id' });

    await expect(createApp({
      db: { mode: 'memory' },
      tables: { records },
      auth: false,
    })).rejects.toMatchObject({
      code: 'DATABASE_CONFIG_INVALID',
    });
  });

  test('rejects membership anchors outside multi-tenancy regardless of Resource policy', () => {
    const tasks = defineTable('tasks', {
      assignee_membership_id: field.guardianMembership(),
    }, { pk: 'task_id' });

    expect(() => assertAppIdentityProjectionConfiguration({
      tables: { tasks: tasks.serverTable },
      authEnabled: true,
      tenancyMode: 'single',
    })).toThrow(DatabaseError);
    expect(() => assertAppIdentityProjectionConfiguration({
      tables: { tasks: tasks.serverTable },
      authEnabled: true,
      tenancyMode: 'multi',
    })).not.toThrow();
  });

  test('allows user anchors in authenticated single-tenancy apps', () => {
    const records = defineTable('records', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'record_id' });

    expect(() => assertAppIdentityProjectionConfiguration({
      tables: { records: records.serverTable },
      authEnabled: true,
      tenancyMode: 'single',
    })).not.toThrow();
  });

  test('rejects Guardian metadata when its configured SQL was mutated', () => {
    const records = defineTable('records', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'record_id' });
    records.serverTable.owner_user_id =
      'text references users(user_id) on delete cascade not null';

    expect(() => assertAppIdentityProjectionConfiguration({
      tables: { records: records.serverTable },
      authEnabled: true,
      tenancyMode: 'single',
    })).toThrow(expect.objectContaining({
      code: 'DATABASE_CONFIG_INVALID',
      details: expect.objectContaining({
        reason: 'reference-schema-invalid',
        table: 'records',
        field: 'owner_user_id',
      }),
    }));
  });

  test('rejects an installed Guardian FK with the wrong delete contract', () => {
    const database = new Database(':memory:');
    const records = defineTable('records', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'record_id' });
    try {
      database.exec(`
        CREATE TABLE users (user_id TEXT PRIMARY KEY);
        CREATE TABLE records (
          record_id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL
            REFERENCES users(user_id) ON DELETE CASCADE
        );
      `);

      expect(() => assertApplicationGuardianReferenceStorage({
        database,
        tables: { records: records.serverTable },
        tenantTables: new Set(),
      })).toThrow(expect.objectContaining({
        code: 'DATABASE_SCHEMA_MISMATCH',
        details: expect.objectContaining({
          reason: 'reference-storage-invalid',
          issue: 'invalid-foreign-key',
        }),
      }));
    } finally {
      database.close();
    }
  });
});
