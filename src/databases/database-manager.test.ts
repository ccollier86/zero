import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPlatformSQLiteService } from '../persistence';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import {
  createNamedDatabaseRef,
  createTenantDatabaseRef,
} from './database-binding-ref';
import { DatabaseCoordinator } from './database-coordinator';
import { DatabaseError } from './database-error';
import { createDatabaseRef } from './database-file';
import { DatabaseManager } from './database-manager';
import { DatabaseRuntime } from './database-runtime';
import { SubprocessDatabaseExecutor } from './subprocess-database-executor';
import type { DatabaseTenantSyncBinding } from './database-tenant-sync';
import { databaseActorFixtureRealm } from './test-fixtures/database-actor-realm';

const CHILD_PATH = fileURLToPath(new URL(
  './test-fixtures/database-actor-child.ts',
  import.meta.url,
));

describe('DatabaseManager', () => {
  const managers: DatabaseManager[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    for (const manager of managers.splice(0).reverse()) {
      await manager.close().catch(() => undefined);
    }
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('preserves the pinned default runtime and exact single-database behavior', async () => {
    const defaultRuntime = createDefaultRuntime();
    const manager = new DatabaseManager({ defaultRuntime });
    managers.push(manager);

    expect(manager.defaultRuntime).toBe(defaultRuntime);
    expect(manager.defaultRuntime.db).toBe(defaultRuntime.db);
    expect(manager.defaultRuntime.sqlite).toBe(defaultRuntime.sqlite);
    expect(manager.diagnostics()).toMatchObject({
      state: 'created',
      multipleEnabled: false,
      tenantDatabasesEnabled: false,
      coordinator: null,
      authority: null,
    });

    manager.start();
    expect(manager.diagnostics().default.started).toBe(true);
    await expect(databaseCode(() => manager.acquireNamed('unused')))
      .resolves.toBe('DATABASE_OPERATION_UNSUPPORTED');

    await manager.close();
    expect(manager.diagnostics()).toMatchObject({
      state: 'closed',
      default: { closed: true },
    });
  });

  test('keeps named and tenant namespaces isolated and exposes only an opaque bound client', async () => {
    const harness = createMultipleManager(roots, { tenantDatabases: true });
    managers.push(harness.manager);
    harness.manager.start();

    const named = await harness.manager.acquireNamed('same-logical-value');
    const tenant = await harness.manager.bindTenant({
      tenantId: 'same-logical-value',
      assertCurrentAuthoritySync: () => undefined,
    });
    try {
      expect(named.databaseRef).toBe(createNamedDatabaseRef('same-logical-value'));
      expect(harness.coordinator.diagnostics().databases.map((entry) => entry.databaseRef))
        .toContain(createTenantDatabaseRef('same-logical-value'));
      expect(createNamedDatabaseRef('same-logical-value'))
        .not.toBe(createTenantDatabaseRef('same-logical-value'));
      expect(createTenantDatabaseRef('same-logical-value'))
        .not.toBe(createDatabaseRef('same-logical-value'));
      expect(Reflect.ownKeys(tenant)).toEqual([]);
      expect(Reflect.ownKeys(tenant.client)).toEqual([]);
      expect(JSON.stringify(tenant)).toBe('{}');
      expect(JSON.stringify(tenant.client)).toBe('{}');
      expect('execute' in tenant.client).toBe(false);

      await named.execute(createTodo('row', 'Named'));
      await tenant.client.mutate({
        type: 'create',
        table: 'todos',
        row: { id: 'row', title: 'Tenant' },
      }, { idempotencyKey: 'tenant:create:row' });

      expect(await named.execute(readTodo('row'))).toMatchObject({
        value: { id: 'row', title: 'Named' },
      });
      expect(await tenant.client.get('todos', 'row')).toMatchObject({
        value: { id: 'row', title: 'Tenant' },
      });
    } finally {
      named.release();
      tenant.release();
    }
  }, 20_000);

  test('revalidates tenant reads and writes and fails closed after revocation', async () => {
    const harness = createMultipleManager(roots, { tenantDatabases: true });
    managers.push(harness.manager);
    harness.manager.start();
    let current = true;
    let checks = 0;
    const binding = await harness.manager.bindTenant({
      tenantId: 'tenant-a',
      assertCurrentAuthoritySync() {
        checks += 1;
        if (!current) throw new Error('/private/revocation secret');
        return undefined;
      },
    });
    try {
      await binding.client.mutate({
        type: 'create', table: 'todos', row: { id: 'a', title: 'Before' },
      }, { idempotencyKey: 'tenant:create:a' });
      expect(checks).toBe(2);
      expect(await binding.client.get('todos', 'a')).toMatchObject({
        value: { id: 'a', title: 'Before' },
      });
      expect(checks).toBe(4);

      current = false;
      const readFailure = await databaseError(
        () => binding.client.get('todos', 'a'),
      );
      expect(readFailure.code).toBe('DATABASE_AUTHORITY_CHANGED');
      expect(readFailure.message).not.toContain('secret');
      const writeFailure = await databaseError(() => binding.client.mutate({
        type: 'update', table: 'todos', id: 'a', patch: { title: 'After' },
      }, { idempotencyKey: 'tenant:update:a' }));
      expect(writeFailure.code).toBe('DATABASE_AUTHORITY_CHANGED');
      expect(writeFailure.outcome).toBe('not-started');
    } finally {
      binding.release();
    }
  }, 20_000);

  test('rejects already-revoked tenant bindings before file or actor admission', async () => {
    const harness = createMultipleManager(roots, { tenantDatabases: true });
    managers.push(harness.manager);
    harness.manager.start();

    const error = await databaseError(() => harness.manager.bindTenant({
      tenantId: 'tenant-must-not-be-created',
      assertCurrentAuthoritySync() {
        throw new Error('/private/revoked-tenant');
      },
    }));

    expect(error).toMatchObject({
      code: 'DATABASE_AUTHORITY_CHANGED',
      retryable: false,
      outcome: 'not-started',
    });
    expect(error.message).not.toContain('private');

    const readError = await databaseError(() => harness.manager.bindTenantSync({
      tenantId: 'read-revoked-tenant-must-not-be-created',
      assertCurrentAuthoritySync: () => undefined,
      assertCurrentReadAuthority() {
        throw new Error('/private/read-revoked-tenant');
      },
    }));
    expect(readError).toMatchObject({
      code: 'DATABASE_AUTHORITY_CHANGED',
      retryable: false,
      outcome: 'not-started',
    });
    expect(readError.message).not.toContain('private');
    expect(harness.coordinator.diagnostics()).toMatchObject({
      databaseFiles: 0,
      openDatabases: 0,
      databases: [],
      availableSlots: 2,
    });
  }, 20_000);

  test('serializes an exclusive authority fence against tenant commits', async () => {
    const harness = createMultipleManager(roots, { tenantDatabases: true });
    managers.push(harness.manager);
    harness.manager.start();
    const exclusive = await harness.authority!.acquireExclusive();
    const binding = await harness.manager.bindTenant({
      tenantId: 'tenant-a',
      assertCurrentAuthoritySync: () => undefined,
    });
    let committed = false;
    const write = binding.client.mutate({
      type: 'create', table: 'todos', row: { id: 'a', title: 'A' },
    }, { idempotencyKey: 'tenant:create:a' }).then(() => { committed = true; });
    await Bun.sleep(10);
    expect(committed).toBe(false);
    exclusive.release();
    await write;

    expect(harness.authority!.diagnostics()).toMatchObject({
      activeExclusive: false,
      activeShared: 0,
    });
    binding.release();
  }, 20_000);

  test('exposes a narrow authority-fenced logical receipt writer', async () => {
    const harness = createMultipleManager(roots, { tenantDatabases: true });
    managers.push(harness.manager);
    harness.manager.start();
    let authorized = true;
    const binding = await harness.manager.bindTenant({
      tenantId: 'tenant-a',
      assertCurrentAuthoritySync: () => {
        if (!authorized) throw new Error('revoked');
        return undefined;
      },
    });
    const fingerprint = `sha256:${'e'.repeat(64)}` as const;
    try {
      expect(Reflect.ownKeys(binding.trustedWriter)).toEqual([]);
      expect(await binding.trustedWriter.findReceipt(
        'trusted:create:a',
        fingerprint,
      )).toEqual({ status: 'miss' });
      const first = await binding.trustedWriter.executeWrite({
        type: 'mutate',
        idempotencyKey: 'trusted:create:a',
        mutation: {
          type: 'create', table: 'todos', row: { id: 'a', title: 'A' },
        },
      }, { logicalReceiptFingerprint: fingerprint });
      expect(first).toMatchObject({
        replayed: false,
        value: {
          mutation: {
            row: { id: 'a', title: 'A' },
            previousRow: null,
          },
        },
      });
      expect(await binding.trustedWriter.findReceipt(
        'trusted:create:a',
        fingerprint,
      )).toMatchObject({
        status: 'hit',
        result: { replayed: true, value: first.value },
      });
      const replay = await binding.trustedWriter.executeWrite({
        type: 'mutate',
        idempotencyKey: 'trusted:create:a',
        mutation: { type: 'delete', table: 'todos', id: 'a' },
      }, { logicalReceiptFingerprint: fingerprint });
      expect(replay.replayed).toBe(true);
      expect(replay.value).toEqual(first.value);
      expect(await binding.client.get('todos', 'a')).toMatchObject({
        value: { id: 'a', title: 'A' },
      });

      authorized = false;
      expect(await databaseCode(() => binding.trustedWriter.findReceipt(
        'trusted:create:a',
        fingerprint,
      ))).toBe('DATABASE_AUTHORITY_CHANGED');
    } finally {
      binding.release();
    }
  }, 20_000);

  test('binds tenant Sync to the same file with isolated authority-fenced leases', async () => {
    const harness = createMultipleManager(roots, { tenantDatabases: true });
    managers.push(harness.manager);
    harness.manager.start();
    let commitAuthorityCurrent = true;
    let readAuthorityCurrent = true;
    const authority = {
      assertCurrentAuthoritySync: () => {
        if (!commitAuthorityCurrent) throw new Error('private commit revocation');
        return undefined;
      },
      assertCurrentReadAuthority: () => {
        if (!readAuthorityCurrent) throw new Error('private read revocation');
        return undefined;
      },
    } as const;
    const tenantA = await harness.manager.bindTenant({
      tenantId: 'tenant-a',
      ...authority,
    });
    const syncA = await harness.manager.bindTenantSync({
      tenantId: 'tenant-a',
      ...authority,
    });
    const syncB = await harness.manager.bindTenantSync({
      tenantId: 'tenant-b',
      assertCurrentAuthoritySync: () => undefined,
    });
    try {
      await tenantA.client.mutate({
        type: 'create', table: 'todos', row: { id: 'shared', title: 'A' },
      }, { idempotencyKey: 'tenant-a:create:shared' });
      expect((await collectTenantSnapshot(syncA, ['todos'])).tables.todos).toEqual([
        { id: 'shared', title: 'A' },
      ]);
      expect((await collectTenantSnapshot(syncB, ['todos'])).tables.todos).toEqual([]);

      await syncA.client.mutate({
        type: 'create', table: 'todos', row: { id: 'from-sync', title: 'A2' },
      }, { idempotencyKey: 'tenant-a:create:from-sync' });
      expect(await tenantA.client.get('todos', 'from-sync')).toMatchObject({
        value: { id: 'from-sync', title: 'A2' },
      });
      await syncB.client.mutate({
        type: 'create', table: 'todos', row: { id: 'shared', title: 'B' },
      }, { idempotencyKey: 'tenant-b:create:shared' });
      expect(await tenantA.client.get('todos', 'shared')).toMatchObject({
        value: { id: 'shared', title: 'A' },
      });
      expect((await collectTenantSnapshot(syncB, ['todos'])).tables.todos).toEqual([
        { id: 'shared', title: 'B' },
      ]);

      readAuthorityCurrent = false;
      expect(await databaseCode(() => syncA.beginSnapshot([])))
        .toBe('DATABASE_AUTHORITY_CHANGED');
      expect(await databaseCode(() => syncA.client.get('todos', 'shared')))
        .toBe('DATABASE_AUTHORITY_CHANGED');
      // The optional read fence does not replace committed write authority.
      await syncA.client.mutate({
        type: 'create', table: 'todos', row: { id: 'write-only', title: 'A3' },
      }, { idempotencyKey: 'tenant-a:create:write-only' });

      commitAuthorityCurrent = false;
      expect(await databaseCode(() => syncA.client.mutate({
        type: 'create', table: 'todos', row: { id: 'revoked', title: 'No' },
      }, { idempotencyKey: 'tenant-a:create:revoked' })))
        .toBe('DATABASE_AUTHORITY_CHANGED');
      expect(await databaseCode(() => syncA.trustedWriter.findReceipt(
        'tenant-a:create:shared',
        `sha256:${'f'.repeat(64)}`,
      ))).toBe('DATABASE_AUTHORITY_CHANGED');

      const beforeRelease = harness.coordinator.diagnostics().databases;
      expect(beforeRelease.find((entry) => entry.databaseRef === syncA.databaseRef))
        .toMatchObject({ leases: 2 });
      expect(beforeRelease.find((entry) => entry.databaseRef === syncB.databaseRef))
        .toMatchObject({ leases: 1 });
      syncA.release();
      expect(syncA.released).toBe(true);
      expect(harness.coordinator.diagnostics().databases
        .find((entry) => entry.databaseRef === syncA.databaseRef))
        .toMatchObject({ leases: 1 });
      expect(await databaseCode(() => syncA.beginSnapshot([]))).toBe('DATABASE_CLOSED');
    } finally {
      tenantA.release();
      syncA.release();
      syncB.release();
    }
    expect(harness.coordinator.diagnostics().databases
      .every((entry) => entry.leases === 0)).toBe(true);
  }, 20_000);

  test('closes actors and the authority gate before disposing the default runtime', async () => {
    const harness = createMultipleManager(roots, { tenantDatabases: true });
    managers.push(harness.manager);
    harness.manager.start();
    const binding = await harness.manager.bindTenant({
      tenantId: 'tenant-a',
      assertCurrentAuthoritySync: () => undefined,
    });
    await binding.client.mutate({
      type: 'create', table: 'todos', row: { id: 'a', title: 'A' },
    }, { idempotencyKey: 'tenant:create:a' });

    await harness.manager.close();
    expect(harness.coordinator.diagnostics().state).toBe('closed');
    expect(harness.authority!.diagnostics().state).toBe('closed');
    expect(harness.defaultRuntime.diagnostics().closed).toBe(true);
    await expect(databaseCode(() => binding.client.get('todos', 'a')))
      .resolves.toBe('DATABASE_CLOSED');
    binding.release();

    // Closing released the physical-root owner, so a fresh app topology may
    // claim the same root without unlinking or replacing its ownership file.
    const nextDefault = createDefaultRuntime();
    const nextCoordinator = createCoordinator(harness.root, null, false);
    const next = new DatabaseManager({
      defaultRuntime: nextDefault,
      multiple: { coordinator: nextCoordinator },
    });
    managers.push(next);
    next.start();
    await next.close();
  }, 20_000);
});

function createMultipleManager(
  roots: string[],
  options: { tenantDatabases: boolean },
) {
  const root = createRoot(roots);
  const defaultRuntime = createDefaultRuntime();
  const authority = options.tenantDatabases
    ? new AuthorityCommitCoordinator()
    : null;
  const coordinator = createCoordinator(
    root,
    authority,
    options.tenantDatabases,
  );
  const manager = new DatabaseManager({
    defaultRuntime,
    multiple: {
      coordinator,
      ...(authority ? { authorityCommitCoordinator: authority } : {}),
      tenantDatabases: options.tenantDatabases,
    },
  });
  return { root, defaultRuntime, authority, coordinator, manager };
}

function createCoordinator(
  rootDirectory: string,
  authority: AuthorityCommitCoordinator | null,
  requireCommitAuthority: boolean,
): DatabaseCoordinator {
  return new DatabaseCoordinator({
    rootDirectory,
    realm: databaseActorFixtureRealm,
    maxDatabases: 2,
    maxTenantSyncDatabases: 2,
    sweepIntervalMs: false,
    operationTimeoutMs: 5_000,
    ...(authority ? { authorityCommitCoordinator: authority } : {}),
    requireCommitAuthority,
    createExecutor: ({ role, slot }) => new SubprocessDatabaseExecutor({
      command: [process.execPath, CHILD_PATH, role, String(slot)],
      env: {},
      role,
      slot,
      maxInFlight: 1,
      startupTimeoutMs: 2_000,
      operationTimeoutMs: 5_000,
      shutdownAckTimeoutMs: 1_000,
      shutdownExitTimeoutMs: 1_000,
      sigtermTimeoutMs: 500,
      sigkillTimeoutMs: 500,
    }),
  });
}

function createDefaultRuntime(): DatabaseRuntime {
  return DatabaseRuntime.open({
    id: 'default',
    role: 'default',
    sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }),
    ownsSQLite: true,
  });
}

function createTodo(id: string, title: string) {
  return {
    type: 'mutate' as const,
    idempotencyKey: `create:${id}:${title}`,
    mutation: {
      type: 'create' as const,
      table: 'todos',
      row: { id, title },
    },
  };
}

function readTodo(id: string) {
  return {
    type: 'get' as const,
    table: 'todos',
    id,
    consistency: { mode: 'snapshot' as const },
  };
}

async function collectTenantSnapshot(
  binding: DatabaseTenantSyncBinding,
  tables: readonly string[],
) {
  const session = await binding.beginSnapshot(tables);
  const rowsByTable: Record<string, unknown[]> = Object.fromEntries(
    tables.map((table) => [table, []]),
  );
  try {
    let cursor = 0;
    while (true) {
      const page = await session.page(cursor);
      for (const entry of page.rows) {
        rowsByTable[tables[entry.tableIndex]!]!.push(entry.row);
      }
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    return { tables: rowsByTable };
  } finally {
    await session.abort();
  }
}

function createRoot(roots: string[]): string {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'zero-database-manager-')),
  );
  roots.push(root);
  return root;
}

async function databaseError(operation: () => Promise<unknown>): Promise<DatabaseError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}

async function databaseCode(operation: () => Promise<unknown>): Promise<string> {
  return (await databaseError(operation)).code;
}
