import { afterEach, describe, expect, test } from 'bun:test';

import {
  DatabaseAutomationSourceCatalog,
} from '../database-automations/automation-source-catalog-store';
import { defineDatabaseAutomations } from '../database-automations/database-automations';
import { defineDatabaseFunction } from '../database-automations/database-function';
import { createPlatformSQLiteService } from '../persistence';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import {
  createNamedDatabaseRef,
  createTenantDatabaseRef,
} from './database-binding-ref';
import {
  assertDatabaseCommitAuthorityCurrent,
  type DatabaseCommitAuthority,
} from './database-commit-authority';
import { DatabaseCoordinator } from './database-coordinator';
import type {
  DatabaseAcquireOptions,
  DatabaseCoordinatorLease,
} from './database-coordinator-contract';
import { DatabaseError } from './database-error';
import { createDatabaseRef } from './database-file';
import {
  acquireDatabaseAutomationSourceForRecovery,
  DatabaseManager,
} from './database-manager';
import { DatabaseManagerActorRouter } from './database-manager-actor-router';
import { defineDatabaseRealm } from './database-realm';
import { DatabaseRuntime } from './database-runtime';
import * as publicDatabases from './index';

const durableFunction = defineDatabaseFunction({
  name: 'recovery.deliver',
  version: 1,
  mode: 'durable',
  handler: async () => undefined,
});

const durableRealm = defineDatabaseRealm({
  name: 'automation-source-tests',
  version: '1',
  tables: {
    todos: {
      id: 'text primary key',
      title: 'text not null',
    },
  },
  automations: defineDatabaseAutomations({ functions: [durableFunction] }),
});

interface TestResources {
  readonly runtimes: DatabaseRuntime[];
  readonly catalogs: DatabaseAutomationSourceCatalog[];
  readonly managers: DatabaseManager[];
}

const resources: TestResources = {
  runtimes: [],
  catalogs: [],
  managers: [],
};

afterEach(async () => {
  for (const manager of resources.managers.splice(0).reverse()) {
    await manager.close().catch(() => undefined);
  }
  for (const catalog of resources.catalogs.splice(0).reverse()) catalog.close();
  for (const runtime of resources.runtimes.splice(0).reverse()) {
    if (!runtime.diagnostics().closed) runtime.close();
  }
});

describe('DatabaseManager durable automation sources', () => {
  test('registers ready named and tenant files with exact trusted authority', async () => {
    const system = systemCatalog();
    const authority = new AuthorityCommitCoordinator();
    const fake = new FakeCoordinator();
    const router = createRouter(fake, system.catalog, {
      authority,
      tenantDatabases: true,
    });

    const named = await router.acquireNamed('analytics');
    const tenant = await router.bindTenant({
      tenantId: 'tenant-a',
      assertCurrentAuthoritySync: () => undefined,
    });
    try {
      expect(system.catalog.get(createNamedDatabaseRef('analytics'))).toMatchObject({
        sourceKind: 'named',
        logicalSourceId: 'analytics',
        authority: {
          scopeKind: 'application',
          scopeId: 'application',
          tenantId: null,
        },
        status: 'active',
      });
      expect(system.catalog.get(createTenantDatabaseRef('tenant-a'))).toMatchObject({
        sourceKind: 'tenant',
        logicalSourceId: 'tenant-a',
        authority: {
          scopeKind: 'tenant',
          scopeId: 'tenant-a',
          tenantId: 'tenant-a',
        },
        status: 'active',
      });
      expect(fake.acquireCalls).toHaveLength(2);
    } finally {
      named.release();
      tenant.release();
      await authority.close();
    }
  });

  test('releases a ready lease when exact catalog registration conflicts', async () => {
    const system = systemCatalog();
    const sourceRef = createNamedDatabaseRef('analytics');
    system.catalog.register({
      sourceRef,
      sourceKind: 'named',
      logicalSourceId: 'different-name',
      authority: {
        scopeKind: 'application',
        scopeId: 'application',
        tenantId: null,
      },
    });
    const fake = new FakeCoordinator();
    const router = createRouter(fake, system.catalog);

    const error = await captureDatabaseError(() => router.acquireNamed('analytics'));
    expect(error.code).toBe('DATABASE_CONFLICT');
    expect(fake.leases).toHaveLength(1);
    expect(fake.leases[0]!.released).toBe(true);
  });

  test('recovers only existing catalog-proven sources and fences tenant commits', async () => {
    const system = systemCatalog();
    const authority = new AuthorityCommitCoordinator();
    let eligible = true;
    const fake = new FakeCoordinator();
    const router = createRouter(fake, system.catalog, {
      authority,
      tenantDatabases: true,
      assertEligible() {
        if (!eligible) throw new Error('private tenant detail');
        return undefined;
      },
    });
    const created = await router.bindTenant({
      tenantId: 'tenant-a',
      assertCurrentAuthoritySync: () => undefined,
    });
    created.release();
    const source = system.catalog.get(createTenantDatabaseRef('tenant-a'))!;

    const recovered = await router.acquireAutomationSourceForRecovery(source);
    expect(recovered).not.toBeNull();
    expect(fake.acquireExistingCalls).toHaveLength(1);
    expect(fake.acquireExistingCalls[0]!.id).toBeTruthy();
    expect(fake.acquireExistingCalls[0]!.options.commitAuthority).toBeTruthy();
    const commitAuthority = fake.acquireExistingCalls[0]!.options
      .commitAuthority as DatabaseCommitAuthority;
    assertDatabaseCommitAuthorityCurrent(
      commitAuthority,
      authority,
      createTenantDatabaseRef('tenant-a'),
    );

    const disabled = system.catalog.setStatus({
      sourceRef: source.sourceRef,
      expectedRevision: source.revision,
      status: 'disabled',
    });
    expect(disabled.status).toBe('disabled');
    expect(() => assertDatabaseCommitAuthorityCurrent(
      commitAuthority,
      authority,
      createTenantDatabaseRef('tenant-a'),
    )).toThrow(expect.objectContaining({ code: 'DATABASE_AUTHORITY_CHANGED' }));
    recovered?.release();

    const active = system.catalog.setStatus({
      sourceRef: source.sourceRef,
      expectedRevision: disabled.revision,
      status: 'active',
    });
    eligible = false;
    const eligibilityError = await captureDatabaseError(
      () => router.acquireAutomationSourceForRecovery(active),
    );
    expect(eligibilityError).toMatchObject({
      code: 'DATABASE_AUTHORITY_CHANGED',
      outcome: 'not-started',
    });
    expect(eligibilityError.message).not.toContain('private');
    await authority.close();
  });

  test('uses existing-only recovery and releases a lease on a post-open race', async () => {
    const system = systemCatalog();
    const fake = new FakeCoordinator();
    const router = createRouter(fake, system.catalog);

    const setup = await router.acquireNamed('existing');
    setup.release();
    const existing = system.catalog.get(createNamedDatabaseRef('existing'))!;
    fake.existing = false;
    expect(await router.acquireAutomationSourceForRecovery(existing)).toBeNull();
    expect(fake.acquireCalls).toHaveLength(1);
    expect(fake.acquireExistingCalls).toHaveLength(1);

    fake.existing = true;
    fake.afterAcquireExisting = () => {
      system.catalog.setStatus({
        sourceRef: existing.sourceRef,
        expectedRevision: existing.revision,
        status: 'disabled',
      });
    };
    const race = await captureDatabaseError(
      () => router.acquireAutomationSourceForRecovery(existing),
    );
    expect(race.code).toBe('DATABASE_AUTHORITY_CHANGED');
    expect(fake.leases.at(-1)?.released).toBe(true);
  });

  test('rejects catalog records whose kind or physical reference cannot be derived', async () => {
    const system = systemCatalog();
    const fake = new FakeCoordinator();
    const router = createRouter(fake, system.catalog);
    const wrongReference = system.catalog.register({
      sourceRef: 'f'.repeat(64),
      sourceKind: 'named',
      logicalSourceId: 'reports',
      authority: {
        scopeKind: 'application',
        scopeId: 'application',
        tenantId: null,
      },
    }).source;

    const referenceError = await captureDatabaseError(
      () => router.acquireAutomationSourceForRecovery(wrongReference),
    );
    expect(referenceError.code).toBe('DATABASE_AUTHORITY_CHANGED');

    const actual = await router.acquireNamed('analytics');
    actual.release();
    const stored = system.catalog.get(createNamedDatabaseRef('analytics'))!;
    const kindError = await captureDatabaseError(
      () => router.acquireAutomationSourceForRecovery({
        ...stored,
        sourceKind: 'tenant',
        authority: {
          scopeKind: 'tenant',
          scopeId: stored.logicalSourceId,
          tenantId: stored.logicalSourceId,
        },
      }),
    );
    expect(kindError.code).toBe('DATABASE_AUTHORITY_CHANGED');
    expect(fake.acquireExistingCalls).toHaveLength(0);
  });

  test('requires a same-system catalog for durable realms and owns its shutdown', async () => {
    const system = createSystemRuntime();
    const app = createAppRuntime();
    const coordinator = createUnstartedCoordinator();
    expect(() => new DatabaseManager({
      systemRuntime: system,
      appRuntime: app,
      multiple: { coordinator },
    })).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));

    const otherSystem = createSystemRuntime();
    const wrongCatalog = createCatalog(otherSystem);
    expect(() => new DatabaseManager({
      systemRuntime: system,
      appRuntime: app,
      automationSourceCatalog: wrongCatalog,
      multiple: { coordinator },
    })).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));

    const catalog = createCatalog(system);
    const manager = new DatabaseManager({
      systemRuntime: system,
      appRuntime: app,
      automationSourceCatalog: catalog,
      multiple: { coordinator },
    });
    resources.managers.push(manager);
    await manager.close();
    expect(catalog.isBoundToSystemRuntime(system)).toBe(false);
    expect(system.diagnostics().closed).toBe(true);
  });

  test('keeps the recovery acquisition helper out of the public manager surface', () => {
    expect('acquireAutomationSourceForRecovery' in DatabaseManager.prototype).toBe(false);
    expect('acquireDatabaseAutomationSourceForRecovery' in publicDatabases).toBe(false);
    expect(typeof acquireDatabaseAutomationSourceForRecovery).toBe('function');
  });
});

class FakeCoordinator {
  readonly realm = durableRealm;
  readonly acquireCalls: Array<Readonly<{
    id: string;
    options: DatabaseAcquireOptions;
  }>> = [];
  readonly acquireExistingCalls: Array<Readonly<{
    id: string;
    options: DatabaseAcquireOptions;
  }>> = [];
  readonly leases: FakeLease[] = [];
  existing = true;
  afterAcquireExisting: (() => void) | null = null;

  start(): void {}
  async close(): Promise<void> {}
  diagnostics(): null { return null; }

  async acquire(
    id: string,
    options: DatabaseAcquireOptions = {},
  ): Promise<DatabaseCoordinatorLease> {
    this.acquireCalls.push(Object.freeze({ id, options }));
    const lease = new FakeLease(createDatabaseRef(id));
    this.leases.push(lease);
    return lease;
  }

  async acquireExisting(
    id: string,
    options: DatabaseAcquireOptions = {},
  ): Promise<DatabaseCoordinatorLease | null> {
    this.acquireExistingCalls.push(Object.freeze({ id, options }));
    if (!this.existing) return null;
    const lease = new FakeLease(createDatabaseRef(id));
    this.leases.push(lease);
    this.afterAcquireExisting?.();
    this.afterAcquireExisting = null;
    return lease;
  }
}

class FakeLease implements DatabaseCoordinatorLease {
  released = false;
  readonly trustedWriter = Object.freeze({}) as DatabaseCoordinatorLease['trustedWriter'];

  constructor(readonly databaseRef: DatabaseCoordinatorLease['databaseRef']) {}

  async execute(): Promise<never> { throw new Error('not used'); }
  async replay(): Promise<never> { throw new Error('not used'); }
  release(): void { this.released = true; }
  async [Symbol.asyncDispose](): Promise<void> { this.release(); }
}

function createRouter(
  coordinator: FakeCoordinator,
  catalog: DatabaseAutomationSourceCatalog,
  options: Readonly<{
    authority?: AuthorityCommitCoordinator;
    tenantDatabases?: boolean;
    assertEligible?: (tenantId: string) => undefined;
  }> = {},
): DatabaseManagerActorRouter {
  return new DatabaseManagerActorRouter({
    coordinator: coordinator as unknown as DatabaseCoordinator,
    authority: options.authority ?? null,
    tenantDatabases: options.tenantDatabases ?? false,
    tenantIdentityProjection: null,
    tenantDatabaseEligibility: options.assertEligible
      ? { assertEligible: options.assertEligible }
      : null,
    automationSourceCatalog: catalog,
  });
}

function systemCatalog(): Readonly<{
  runtime: DatabaseRuntime;
  catalog: DatabaseAutomationSourceCatalog;
}> {
  const runtime = createSystemRuntime();
  return Object.freeze({ runtime, catalog: createCatalog(runtime) });
}

function createCatalog(runtime: DatabaseRuntime): DatabaseAutomationSourceCatalog {
  const catalog = new DatabaseAutomationSourceCatalog({ runtime });
  resources.catalogs.push(catalog);
  return catalog;
}

function createSystemRuntime(): DatabaseRuntime {
  const runtime = DatabaseRuntime.open({
    id: `system-${crypto.randomUUID()}`,
    role: 'system',
    sqlite: createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false }),
    ownsSQLite: true,
  });
  resources.runtimes.push(runtime);
  return runtime;
}

function createAppRuntime(): DatabaseRuntime {
  const runtime = DatabaseRuntime.open({
    id: `app-${crypto.randomUUID()}`,
    role: 'default',
    sqlite: createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false }),
    ownsSQLite: true,
  });
  resources.runtimes.push(runtime);
  return runtime;
}

function createUnstartedCoordinator(): DatabaseCoordinator {
  const coordinator = new DatabaseCoordinator({
    rootDirectory: `/tmp/zero-automation-manager-${crypto.randomUUID()}`,
    realm: durableRealm,
    createExecutor: () => {
      throw new Error('not started');
    },
    sweepIntervalMs: false,
  });
  return coordinator;
}

async function captureDatabaseError(
  operation: () => Promise<unknown>,
): Promise<DatabaseError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}
