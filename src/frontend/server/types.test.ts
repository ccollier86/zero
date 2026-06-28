/**
 * types.test.ts
 *
 * Verifies server app config normalization. These tests keep createApp's
 * backend contract explicit before plugins and HTTP routes are composed.
 */

import { describe, expect, test } from 'bun:test';
import { resolveConfig } from './types';

const tables = {
  todos: {
    id: 'text primary key',
    title: 'text not null',
  },
};

describe('resolveConfig', () => {
  test('allows state sync when auth is enabled', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: true,
      stateSync: true,
    });

    expect(config.auth).toEqual({});
    expect(config.stateSync).toBe(true);
  });

  test('preserves auth registration and user property config', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
      auth: {
        registration: { mode: 'admin-only' },
        accountEmails: {
          adminCreatedUser: true,
          passwordReset: true,
          actionTokenTTL: '2h',
        },
        userProperties: {
          department: {
            type: 'enum',
            values: ['accounting', 'operations'],
            editableBy: 'admin',
          },
        },
      },
    });

    expect(config.auth).not.toBe(false);
    if (config.auth !== false) {
      expect(config.auth.registration?.mode).toBe('admin-only');
      expect(config.auth.accountEmails?.adminCreatedUser).toBe(true);
      expect(config.auth.accountEmails?.actionTokenTTL).toBe('2h');
      expect(config.auth.userProperties?.department.values).toEqual([
        'accounting',
        'operations',
      ]);
    }
  });

  test('preserves app identity and email config', () => {
    const config = resolveConfig({
      app: {
        name: 'Zero CRM',
        publicUrl: 'https://crm.example.com',
      },
      db: { mode: 'memory' },
      tables,
      email: {
        from: 'Zero CRM <noreply@example.com>',
        provider: 'resend',
        resend: {
          apiKey: 'test_key',
        },
      },
    });

    expect(config.app.name).toBe('Zero CRM');
    expect(config.app.publicUrl).toBe('https://crm.example.com');
    expect(config.email).not.toBe(false);
    if (config.email !== false) {
      expect(config.email.from).toBe('Zero CRM <noreply@example.com>');
      expect(config.email.provider).toBe('resend');
      expect(config.email.resend?.apiKey).toBe('test_key');
    }
  });

  test('rejects state sync when auth is omitted', () => {
    expect(() =>
      resolveConfig({
        db: { mode: 'memory' },
        tables,
        stateSync: true,
      })
    ).toThrow('[app] stateSync requires auth: true');
  });

  test('rejects state sync when auth is explicitly disabled', () => {
    expect(() =>
      resolveConfig({
        db: { mode: 'memory' },
        tables,
        auth: false,
        stateSync: true,
      })
    ).toThrow('[app] stateSync requires auth: true');
  });

  test('defaults omitted table sync mode to auto', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables,
    });

    expect(config.declaredSyncModes.get('todos')).toBe('auto');
    expect(config.syncDefaults.defaultMode).toBe('auto');
    expect(config.syncDefaults.rowLimit).toBe(1000);
    expect(config.syncDefaults.action).toBe('lazy');
    expect(config.syncDefaults.persist).toBe(true);
  });

  test('preserves explicit table sync modes and config overrides', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables: {
        lazy_docs: {
          serverTable: { id: 'text primary key', title: 'text not null' },
          clientTable: { _pk: 'id', _sync: 'lazy', id: 'text', title: 'text' },
        },
        large_docs: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      syncDefaults: {
        tables: {
          large_docs: { mode: 'full', rowLimit: 50, action: 'warn', persist: false },
        },
      },
    });

    expect(config.declaredSyncModes.get('lazy_docs')).toBe('lazy');
    expect(config.declaredSyncModes.get('large_docs')).toBe('full');
    expect(config.lazyTables.has('lazy_docs')).toBe(true);
    expect(config.snapshotTables.has('large_docs')).toBe(true);
    expect(config.syncDefaults.tables.get('large_docs')).toEqual({
      mode: 'full',
      rowLimit: 50,
      action: 'warn',
      persist: false,
    });
  });
});
