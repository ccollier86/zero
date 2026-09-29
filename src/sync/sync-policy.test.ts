/**
 * sync-policy.test.ts
 *
 * Verifies the standalone sync policy contract. Integration tests cover the
 * WebSocket transport; this file keeps policy behavior fast and deterministic.
 */

import { describe, expect, test } from 'bun:test';
import { MemoryEventStore, OBS_CODES } from '../observability';
import {
  allowAllSyncPolicy,
  combineSyncPolicies,
  createDefaultSyncPolicy,
  evaluateSyncMutationPolicy,
  getReadableSyncTables,
} from './sync-policy';
import type { SyncAuthContext } from './types';
import type { SyncPolicy } from './sync-policy';

const authContext: SyncAuthContext = {
  userId: 'user-1',
  email: 'user@test.local',
  role: 'user',
};

describe('sync policy helpers', () => {
  test('allow-all policy preserves standalone sync behavior', () => {
    expect(getReadableSyncTables(['todos', 'projects'], null, allowAllSyncPolicy)).toEqual(
      new Set(['todos', 'projects'])
    );

    expect(
      evaluateSyncMutationPolicy(allowAllSyncPolicy, {
        table: 'todos',
        op: 'INSERT',
        row: { id: '1' },
        authContext: null,
      })
    ).toEqual({ ok: true });
  });

  test('default policy separates read protection from write protection', () => {
    const policy = createDefaultSyncPolicy({
      readProtectedTables: ['private_notes'],
      writeProtectedTables: ['audit_log'],
    });

    expect(
      getReadableSyncTables(['todos', 'private_notes', 'audit_log'], authContext, policy)
    ).toEqual(new Set(['todos', 'audit_log']));

    expect(
      evaluateSyncMutationPolicy(policy, {
        table: 'audit_log',
        op: 'INSERT',
        row: { id: '1' },
        authContext,
      })
    ).toEqual({
      ok: false,
      reason: 'Table is read-only over sync: audit_log',
    });

    expect(
      evaluateSyncMutationPolicy(policy, {
        table: 'todos',
        op: 'INSERT',
        row: { id: '1' },
        authContext,
      })
    ).toEqual({ ok: true });
  });

  test('operation-specific policy can deny one mutation type', () => {
    const policy: SyncPolicy = {
      canDelete: () => ({ ok: false, reason: 'Deletes are disabled' }),
    };

    expect(
      evaluateSyncMutationPolicy(policy, {
        table: 'todos',
        op: 'UPDATE',
        rowId: '1',
        row: { title: 'Keep' },
        authContext,
      })
    ).toEqual({ ok: true });

    expect(
      evaluateSyncMutationPolicy(policy, {
        table: 'todos',
        op: 'DELETE',
        rowId: '1',
        authContext,
      })
    ).toEqual({ ok: false, reason: 'Deletes are disabled' });
  });

  test('combined policies use deny-wins semantics', () => {
    const platformPolicy = createDefaultSyncPolicy({
      writeProtectedTables: ['users'],
    });
    const appPolicy: SyncPolicy = {
      canMutateTable: () => true,
      canReadTable: ({ table }) => table !== 'secret_notes',
    };
    const policy = combineSyncPolicies(platformPolicy, appPolicy);

    expect(
      evaluateSyncMutationPolicy(policy, {
        table: 'users',
        op: 'UPDATE',
        rowId: 'user-1',
        row: { role: 'admin' },
        authContext,
      })
    ).toEqual({
      ok: false,
      reason: 'Table is read-only over sync: users',
    });

    expect(getReadableSyncTables(['todos', 'secret_notes'], authContext, policy)).toEqual(
      new Set(['todos'])
    );
  });

  test('policy errors fail closed', () => {
    const events = new MemoryEventStore();
    const policy: SyncPolicy = {
      canMutateTable: () => {
        throw new Error('private /workspace/customer.sqlite PHI-SECRET');
      },
    };

    expect(
      evaluateSyncMutationPolicy(policy, {
        table: 'todos',
        op: 'INSERT',
        row: { id: '1' },
        authContext,
      }, {
        sink: events,
        store: events,
        config: { console: false, store: events },
      })
    ).toEqual({ ok: false, reason: 'Sync policy evaluation failed' });

    const page = events.query({ code: OBS_CODES.SYNC_POLICY_CALLBACK_FAILED.code });
    expect(page.count).toBe(1);
    expect(page.events[0]?.metadata).toEqual({ table: 'todos', operation: 'INSERT' });
    expect(page.events[0]?.error).toBeUndefined();
    expect(JSON.stringify(page.events[0])).not.toContain('PHI-SECRET');
  });
});
