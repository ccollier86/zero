import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPlatformSQLiteService } from '../persistence';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { DatabaseCoordinator } from './database-coordinator';
import { DatabaseError } from './database-error';
import { DatabaseManager } from './database-manager';
import { DatabaseRuntime } from './database-runtime';
import { SubprocessDatabaseExecutor } from './subprocess-database-executor';
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
      expect(named.databaseRef).not.toBeUndefined();
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
      expect(checks).toBe(1);
      expect(await binding.client.get('todos', 'a')).toMatchObject({
        value: { id: 'a', title: 'Before' },
      });
      expect(checks).toBe(3);

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
