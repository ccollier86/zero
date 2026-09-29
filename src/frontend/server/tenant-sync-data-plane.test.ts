import { describe, expect, test } from 'bun:test';

import type { TenantDatabaseSyncBinding } from '../../databases';
import type {
  SyncTenantDataPlaneBindContext,
  SyncTenantDataPlaneWakeup,
} from '../../sync/sync-tenant-data-plane';
import { createManagedTenantSyncDataPlane } from './tenant-sync-data-plane';

describe('managed tenant Sync data plane', () => {
  test('binds only the verified auth tenant and preserves both authority fences', async () => {
    const writes = () => undefined;
    const reads = () => undefined;
    const binding = fakeBinding();
    const calls: unknown[] = [];
    const catalog = Object.freeze({
      documents: Object.freeze({
        primaryKey: 'id',
        columns: Object.freeze(['id', 'title']),
      }),
    });
    const plane = createManagedTenantSyncDataPlane({
      manager: {
        async bindTenantSync(options) {
          calls.push(options);
          return binding;
        },
      },
      tables: catalog,
    });

    expect(plane.tables).toBe(catalog);
    expect(calls).toHaveLength(0);
    const bound = await plane.bind(context('tenant-from-auth', writes, reads));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      tenantId: 'tenant-from-auth',
      assertCurrentAuthoritySync: writes,
      assertCurrentReadAuthority: reads,
    });
    expect(bound.client).toBe(binding.client);
    expect(bound.trustedWriter).toBe(binding.trustedWriter);
    expect(bound.released).toBe(false);

    bound.release();
    expect(binding.released).toBe(true);
    expect(bound.released).toBe(true);
  });

  test('fails closed before manager binding without verified tenant authority', async () => {
    let calls = 0;
    const plane = createManagedTenantSyncDataPlane({
      manager: {
        async bindTenantSync() {
          calls += 1;
          return fakeBinding();
        },
      },
      tables: Object.freeze({}),
    });
    const invalid = context(undefined, () => undefined, () => undefined);

    await expect(plane.bind(invalid)).rejects.toMatchObject({
      code: 'DATABASE_AUTHORITY_CHANGED',
    });
    const mismatched = {
      ...context('tenant-a', () => undefined, () => undefined),
      authContext: {
        ...context('tenant-a', () => undefined, () => undefined).authContext,
        sessionScopeId: 'tenant-b',
      },
    };
    await expect(plane.bind(mismatched)).rejects.toMatchObject({
      code: 'DATABASE_AUTHORITY_CHANGED',
    });
    expect(calls).toBe(0);
  });

  test('preserves exact actor snapshot-session and wakeup capabilities', async () => {
    const binding = fakeBinding();
    const plane = createManagedTenantSyncDataPlane({
      manager: { bindTenantSync: async () => binding },
      tables: Object.freeze({}),
    });
    const bound = await plane.bind(context(
      'tenant-a',
      () => undefined,
      () => undefined,
    ));

    const snapshot = await bound.beginSnapshot([]);
    expect(snapshot).toMatchObject({
      databaseRef: 'db:test',
      generation: 7,
      syncEpoch: 'epoch-7',
      sequence: { seq: 19 },
      tables: [],
      totalRows: 0,
      aborted: false,
    });
    expect(await snapshot.page(0)).toEqual({
      cursor: 0,
      rows: [],
      nextCursor: null,
    });
    await snapshot.abort();
    expect(snapshot.aborted).toBe(true);
    expect(binding.snapshotCalls).toEqual([[]]);

    const wakeups: SyncTenantDataPlaneWakeup[] = [];
    const unsubscribe = bound.onWakeup((wakeup) => wakeups.push(wakeup));
    binding.emit({
      type: 'changes',
      databaseRef: 'db:test',
      generation: 7,
      syncEpoch: 'epoch-7',
      afterSeq: 19,
      throughSeq: 20,
    });
    expect(wakeups).toHaveLength(1);
    unsubscribe();
  });
});

function context(
  tenantId: string | undefined,
  assertCurrentAuthoritySync: () => undefined,
  assertCurrentReadAuthority: () => undefined,
): SyncTenantDataPlaneBindContext {
  return Object.freeze({
    authContext: {
      userId: 'user-a',
      email: 'user@example.test',
      role: 'user',
      ...(tenantId ? {
        sessionKind: 'web' as const,
        sessionId: 'session-a',
        sessionGeneration: 1,
        sessionScopeKind: 'tenant' as const,
        sessionScopeId: tenantId,
        tenantId,
        membershipId: 'membership-a',
        tenantAuthorizationGeneration: 1,
        membershipAuthorizationGeneration: 1,
      } : {}),
    },
    assertCurrentAuthoritySync,
    assertCurrentReadAuthority,
  });
}

function fakeBinding(): TenantDatabaseSyncBinding & {
  readonly snapshotCalls: string[][];
  emit(wakeup: SyncTenantDataPlaneWakeup): void;
} {
  const listeners = new Set<(wakeup: SyncTenantDataPlaneWakeup) => void>();
  const snapshotCalls: string[][] = [];
  const value = {
    databaseRef: 'db:test',
    client: Object.freeze({}),
    trustedWriter: Object.freeze({}),
    released: false,
    snapshotCalls,
    async snapshot(tables: readonly string[]) {
      snapshotCalls.push([...tables]);
      return {
        databaseRef: 'db:test',
        generation: 7,
        syncEpoch: 'epoch-7',
        sequence: { seq: 19 },
        tables: Object.freeze({}),
      };
    },
    async beginSnapshot(tables: readonly string[]) {
      snapshotCalls.push([...tables]);
      let aborted = false;
      return {
        databaseRef: 'db:test',
        generation: 7,
        syncEpoch: 'epoch-7',
        sequence: { seq: 19 },
        tables: [...tables],
        totalRows: 0,
        totalSourceBytes: 0,
        expiresAt: Date.now() + 30_000,
        get aborted() { return aborted; },
        async page(cursor: number) {
          return { cursor, rows: [], nextCursor: null };
        },
        async abort() { aborted = true; },
        async [Symbol.asyncDispose]() { aborted = true; },
      };
    },
    async replay(afterSeq: number) {
      return {
        databaseRef: 'db:test',
        generation: 7,
        syncEpoch: 'epoch-7',
        sequence: { seq: afterSeq },
        value: {
          afterSeq,
          throughSeq: afterSeq,
          nextAfterSeq: null,
          changes: [],
        },
      };
    },
    onWakeup(listener: (wakeup: SyncTenantDataPlaneWakeup) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    release() {
      value.released = true;
    },
    emit(wakeup: SyncTenantDataPlaneWakeup) {
      for (const listener of listeners) listener(wakeup);
    },
    async [Symbol.asyncDispose]() {
      value.release();
    },
  };
  return value as unknown as TenantDatabaseSyncBinding & {
    readonly snapshotCalls: string[][];
    emit(wakeup: SyncTenantDataPlaneWakeup): void;
  };
}
