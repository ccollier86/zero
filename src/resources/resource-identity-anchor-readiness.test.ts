import { afterEach, describe, expect, test } from 'bun:test';

import { identityProjectionError } from '../auth/identity-projection-error';
import { defineAuthTables } from '../auth/auth-schema';
import type { AuthContext } from '../auth/types';
import { createAppIdentityProjectionRuntime } from '../frontend/server/identity-projection-runtime';
import { MemoryEventStore, OBS_CODES } from '../observability';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { defineTable, field } from '../schema';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  ResourceCrudService,
  type ResourceCrudRequestContext,
} from './resource-crud-service';
import { ResourceCrudFailureMapper } from './resource-crud-failures';
import { authenticatedOnly } from './resource-policy-helpers';
import { defineResource } from './resource-definition';
import { ResourceRegistry } from './resource-registry';

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('Resource Guardian identity-anchor readiness', () => {
  test('returns a stable retryable response before a raw Guardian FK failure', async () => {
    const fixture = createGuardianResource();
    const service = new ResourceCrudService({
      ...fixture.options,
      ensureIdentityAnchors() {
        throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
      },
    });

    const result = await service.create('documents', {
      document_id: 'doc-1',
      owner_user_id: 'user-1',
      title: 'Private',
    }, requestContext());

    expect(result).toEqual({
      ok: false,
      status: 503,
      body: {
        error: 'Application data realm is still provisioning',
        code: 'data-realm-not-ready',
        retryable: true,
      },
    });
    expect(fixture.db.get('documents', 'doc-1')).toBeNull();
  });

  test('routes unrelated barrier failures through standard mutation telemetry', async () => {
    const fixture = createGuardianResource();
    const events = new MemoryEventStore();
    const privateDetail = '/private/tenant/acme.sqlite SELECT * FROM secrets';
    const service = new ResourceCrudService({
      ...fixture.options,
      observability: runtimeFor(events),
      ensureIdentityAnchors() {
        throw new Error(privateDetail);
      },
    });

    const result = await service.create('documents', {
      document_id: 'doc-private-failure',
      owner_user_id: 'user-1',
      title: 'Must not commit',
    }, requestContext());

    expect(result).toEqual({
      ok: false,
      status: 500,
      body: {
        error: 'Resource mutation failed',
        code: 'resource-mutation-failed',
      },
    });
    const failures = events.query({ code: OBS_CODES.RESOURCE_CRUD_FAILED.code }).events;
    expect(failures).toHaveLength(1);
    expect(failures[0]?.metadata).toEqual({
      resource: 'documents',
      table: 'documents',
      action: 'create',
      failureKind: 'mutation',
      databasePlane: 'default',
    });
    expect(JSON.stringify({ result, failures })).not.toContain(privateDetail);
    expect(fixture.db.get('documents', 'doc-private-failure')).toBeNull();
  });

  test('revalidates full request authority after the readiness barrier yields', async () => {
    const fixture = createGuardianResource();
    let barrierCalls = 0;
    const service = new ResourceCrudService({
      ...fixture.options,
      ensureIdentityAnchors({ authContext }) {
        barrierCalls += 1;
        expect(authContext?.userId).toBe('user-1');
        fixture.db.prepare('INSERT INTO users (user_id) VALUES (?)').run('user-1');
      },
    });
    const context = requestContext();
    let revalidations = 0;
    context.revalidateAuthContext = async () => {
      revalidations += 1;
      return revalidations === 1
        ? context.authContext!
        : { ...context.authContext!, authGeneration: 2 };
    };

    const result = await service.create('documents', {
      document_id: 'doc-2',
      owner_user_id: 'user-1',
      title: 'Must not commit',
    }, context);

    expect(barrierCalls).toBe(1);
    expect(revalidations).toBe(2);
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      body: { code: 'resource-authority-changed' },
    });
    expect(fixture.db.get('documents', 'doc-2')).toBeNull();
  });

  test('does not impose projection work on tables without Guardian references', async () => {
    const db = memoryDb();
    const plain = defineTable('notes', {
      title: field.text({ required: true }),
    }, { pk: 'note_id' });
    db.defineTable('notes', plain.serverTable);
    const registry = new ResourceRegistry();
    registry.register(defineResource({
      table: plain,
      exposure: 'http',
      realm: 'global',
      actions: ['create'],
      policy: authenticatedOnly(),
    }), {
      tables: { notes: plain.serverTable },
      authConfig: { userProperties: {} },
    });
    let barrierCalls = 0;
    const service = new ResourceCrudService({
      db,
      registry,
      tables: { notes: plain.serverTable },
      authConfig: { userProperties: {} },
      ensureIdentityAnchors() { barrierCalls += 1; },
    });

    const result = await service.create('notes', {
      note_id: 'note-1',
      title: 'No Guardian FK',
    }, requestContext());

    expect(result.ok).toBe(true);
    expect(barrierCalls).toBe(0);
  });

  test('allows repeated Resource mutations for an already-projected caller', async () => {
    const system = memoryDb();
    defineAuthTables(system);
    system.prepare(`
      INSERT INTO users (
        user_id, username, email, role, status, password_change_required,
        email_verification_required, mfa_required, created_at
      ) VALUES (?, ?, ?, 'user', 'active', 0, 0, 0, ?)
    `).run('user-repeat', 'repeat-user', 'repeat@example.test', 1);
    const fixture = createGuardianResource();
    const runtime = createAppIdentityProjectionRuntime({
      systemDB: system,
      applicationDB: fixture.db,
      tables: fixture.options.tables,
      tenancyMode: 'single',
      getDatabaseManager: () => null,
      emitCode: () => ({}) as never,
    })!;
    await runtime.lifecycle.initialize?.();
    const service = new ResourceCrudService({
      ...fixture.options,
      ensureIdentityAnchors: ({ resource, authContext }) =>
        runtime.ensureApplicationIdentityAnchors(resource.table, authContext),
    });

    for (const suffix of ['one', 'two']) {
      const result = await service.create('documents', {
        document_id: `doc-${suffix}`,
        owner_user_id: 'user-repeat',
        title: `Document ${suffix}`,
      }, requestContext('user-repeat', `key-${suffix}`));
      expect(result.ok).toBe(true);
    }
    expect(fixture.db.prepare('SELECT user_id FROM users').all()).toEqual([
      { user_id: 'user-repeat' },
    ]);
  });

  test.each([
    ['IDENTITY_PROJECTION_NOT_READY', 'data-realm-not-ready', true],
    ['IDENTITY_PROJECTION_QUARANTINED', 'data-realm-unavailable', false],
  ] as const)('maps tenant admission %s to a safe Resource contract', (
    projectionCode,
    publicCode,
    retryable,
  ) => {
    const fixture = createGuardianResource();
    const resource = fixture.options.registry.get('documents')!;
    const result = new ResourceCrudFailureMapper(null).tenantDatabase(
      identityProjectionError(projectionCode),
      resource,
      'create',
      'write',
    );

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      body: { code: publicCode, retryable },
    });
    expect(JSON.stringify(result)).not.toContain('tenant');
  });
});

function createGuardianResource() {
  const db = memoryDb();
  db.exec('CREATE TABLE users (user_id TEXT PRIMARY KEY)');
  const documents = defineTable('documents', {
    owner_user_id: field.guardianUser(),
    title: field.text({ required: true }),
  }, { pk: 'document_id' });
  db.defineTable('documents', documents.serverTable);
  const registry = new ResourceRegistry();
  registry.register(defineResource({
    table: documents,
    exposure: 'http',
    realm: 'global',
    actions: ['create'],
    policy: authenticatedOnly(),
  }), {
    tables: { documents: documents.serverTable },
    authConfig: { userProperties: {} },
  });
  return {
    db,
    options: {
      db,
      registry,
      tables: { documents: documents.serverTable },
      authConfig: { userProperties: {} },
    },
  };
}

function requestContext(
  userId = 'user-1',
  idempotencyKey = 'test-key',
): ResourceCrudRequestContext {
  const authContext: AuthContext = {
    userId,
    email: `${userId}@example.test`,
    role: 'user',
    authGeneration: 1,
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
  };
  return {
    authContext,
    idempotencyKey,
    resolveAuthContextAtCommit: () => authContext,
  };
}

function memoryDb(): ReactiveDB {
  const db = createReactiveDB({ mode: 'memory' });
  db.exec('PRAGMA foreign_keys = ON');
  databases.push(db);
  return db;
}

function runtimeFor(store: MemoryEventStore): PlatformObservabilityRuntime {
  return {
    sink: store,
    store,
    config: { console: false, store },
  };
}
