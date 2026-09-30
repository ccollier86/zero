import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { AuthContext } from '../auth/types';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { DatabaseCoordinator } from '../databases/database-coordinator';
import { DatabaseError } from '../databases/database-error';
import { DatabaseManager } from '../databases/database-manager';
import { DatabaseRuntime } from '../databases/database-runtime';
import type {
  AsyncDatabaseClient,
  DatabaseOperationRow,
} from '../databases/database-operations';
import type { DatabaseTrustedWriteExecutor } from '../databases/database-trusted-writer';
import { SubprocessDatabaseExecutor } from '../databases/subprocess-database-executor';
import { databaseActorFixtureRealm } from '../databases/test-fixtures/database-actor-realm';
import {
  createRequestDatabaseClient,
  createResourceTenantDatabaseAccess,
} from '../frontend/server/request-database-client';
import { createPlatformSQLiteService } from '../persistence';
import { OBS_CODES } from '../observability/codes';
import { MemoryEventStore } from '../observability/memory-event-store';
import { configureObservability } from '../observability/sink';
import { createReactiveDB } from '../sync/reactive-db';
import type { TableSchema } from '../sync/types';
import { defineResource, tenantRealm } from './resource-definition';
import { authenticatedOnly, customPolicy } from './resource-policy-helpers';
import type { ResourcePolicyDecisionInput } from './resource-policy-types';
import { createResourceRegistry } from './resource-registry';
import {
  ResourceCrudService,
  type ResourceCrudRequestContext,
  type ResourceTenantDatabaseAccess,
} from './resource-crud-service';

const CHILD_PATH = fileURLToPath(new URL(
  '../databases/test-fixtures/database-actor-child.ts',
  import.meta.url,
));

const physicalTables = {
  todos: {
    id: 'text primary key',
    title: 'text not null',
  },
} satisfies Record<string, TableSchema>;

describe('tenant-database Resource CRUD', () => {
  test('routes through isolated actors with durable policy and concurrency fences', async () => {
    const harness = createActorHarness();
    const authA = tenantAuth('tenant-a');
    const authB = tenantAuth('tenant-b');
    let policyHook: (
      (action: string) => ResourcePolicyDecisionInput | void
        | Promise<ResourcePolicyDecisionInput | void>
    ) | null = null;
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'todos',
        exposure: 'http',
        realm: tenantRealm(),
        policy: customPolicy(async ({ action }) => {
          const allowed = await policyHook?.(action);
          return allowed ?? true;
        }, { name: 'tenant-database-test' }),
      })],
      tables: physicalTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      tenantIsolation: 'tenant-database',
      managedTables: ['todos'],
    });
    const service = new ResourceCrudService({
      db: harness.defaultRuntime.db,
      registry,
      tables: physicalTables,
      authConfig: { userProperties: {} },
      getTenantDatabaseClient: ({ scope, assertCurrentAuthoritySync }) =>
        createResourceTenantDatabaseAccess({
          manager: harness.manager,
          scope: trustedSystemServiceDataScope({
            scopeKind: 'tenant',
            tenantId: scope.tenantId,
          }),
          assertCurrentAuthoritySync,
        }),
    });

    try {
      harness.manager.start();

      const contextA = requestContext(authA, 'create-shared-a');
      const contextB = requestContext(authB, 'create-shared-b');
      expect(await service.create('todos', {
        id: 'shared-id', title: 'Tenant A',
      }, contextA)).toMatchObject({
        ok: true,
        status: 201,
        body: { row: { id: 'shared-id', title: 'Tenant A' } },
      });
      expect(await service.create('todos', {
        id: 'shared-id', title: 'Tenant B',
      }, contextB)).toMatchObject({
        ok: true,
        status: 201,
        body: { row: { id: 'shared-id', title: 'Tenant B' } },
      });
      expect(await service.get('todos', 'shared-id', contextA)).toMatchObject({
        ok: true,
        body: { row: { id: 'shared-id', title: 'Tenant A' } },
      });
      expect(await service.get('todos', 'shared-id', contextB)).toMatchObject({
        ok: true,
        body: { row: { id: 'shared-id', title: 'Tenant B' } },
      });
      expect(await service.list('todos', { order: 'id', limit: 10 }, contextA))
        .toMatchObject({
          ok: true,
          body: {
            rows: [{ id: 'shared-id', title: 'Tenant A' }],
            page: { limit: 10, count: 1, hasMore: false },
          },
        });
      const isolatedList = await service.list('todos', {}, contextA);
      if (!isolatedList.ok) throw new Error('Expected tenant A list to succeed');
      expect((isolatedList.body as { rows: Array<Record<string, unknown>> }).rows[0])
        .not.toHaveProperty('tenant_id');
      await service.create('todos', {
        id: 'a-only', title: 'Pagination lookahead',
      }, requestContext(authA, 'create-pagination-a'));
      expect(await service.list('todos', {
        order: 'id', dir: 'asc', limit: 1, offset: 0,
      }, contextA)).toMatchObject({
        ok: true,
        body: {
          rows: [{ id: 'a-only', title: 'Pagination lookahead' }],
          page: {
            limit: 1,
            offset: 0,
            count: 1,
            hasMore: true,
            nextOffset: 1,
          },
        },
      });
      assertNoHeldActorWork(harness.coordinator);

      expect(await service.update('todos', 'shared-id', {
        title: 'Tenant A updated',
      }, requestContext(authA, 'update-shared-a'))).toMatchObject({
        ok: true,
        body: { row: { id: 'shared-id', title: 'Tenant A updated' } },
      });
      expect(await service.get('todos', 'shared-id', contextB)).toMatchObject({
        ok: true,
        body: { row: { title: 'Tenant B' } },
      });
      assertNoHeldActorWork(harness.coordinator);

      expect(await service.create('todos', {
        id: 'update-replay-id', title: 'Before update replay',
      }, requestContext(authA, 'create-update-replay'))).toMatchObject({ ok: true });
      const updateReplayContext = requestContext(authA, 'durable-update-replay');
      const updateReplayInput = { title: 'Exact committed update' };
      expect(await service.update(
        'todos',
        'update-replay-id',
        updateReplayInput,
        updateReplayContext,
      )).toMatchObject({
        ok: true,
        body: { row: { id: 'update-replay-id', ...updateReplayInput } },
      });
      await tenantClient(harness.manager, 'tenant-a').mutate({
        type: 'update',
        table: 'todos',
        id: 'update-replay-id',
        patch: { title: 'Later concurrent value' },
      }, { idempotencyKey: 'out-of-band-after-update-receipt' });
      // Receipt lookup happens before the current-row read and returns the
      // exact canonical commit row, never the later concurrent value.
      expect(await service.update(
        'todos',
        'update-replay-id',
        updateReplayInput,
        updateReplayContext,
      )).toMatchObject({
        ok: true,
        body: { row: { id: 'update-replay-id', ...updateReplayInput } },
      });
      expect(await service.update('todos', 'update-replay-id', {
        title: 'Changed payload under reused key',
      }, updateReplayContext)).toMatchObject({
        ok: false,
        status: 409,
        body: { code: 'resource-idempotency-key-reused' },
      });
      expect(await tenantClient(harness.manager, 'tenant-a').get(
        'todos',
        'update-replay-id',
        { consistency: { mode: 'strong' } },
      )).toMatchObject({ value: { title: 'Later concurrent value' } });
      assertNoHeldActorWork(harness.coordinator);

      const replayContext = requestContext(authA, 'durable-create-replay');
      const replayInput = { id: 'replay-id', title: 'Exactly once' };
      expect(await service.create('todos', replayInput, replayContext)).toMatchObject({
        ok: true,
        status: 201,
      });
      const firstReplayRead = await tenantClient(harness.manager, 'tenant-a')
        .get('todos', 'replay-id', { consistency: { mode: 'strong' } });
      expect(await service.create('todos', replayInput, replayContext)).toMatchObject({
        ok: true,
        status: 201,
        body: { row: replayInput },
      });
      const secondReplayRead = await tenantClient(harness.manager, 'tenant-a')
        .get('todos', 'replay-id', { consistency: { mode: 'strong' } });
      expect(secondReplayRead.sequence).toEqual(firstReplayRead.sequence);

      // Session/token rotation keeps the stable receipt principal while the
      // full transient authority snapshot still fences this individual call.
      const rotatedAuth: AuthContext = {
        ...authA,
        sessionId: 'session-tenant-a-rotated',
        sessionGeneration: 1,
        tenantAuthorizationGeneration: 1,
        membershipAuthorizationGeneration: 1,
      };
      expect(await service.create(
        'todos',
        replayInput,
        requestContext(rotatedAuth, 'durable-create-replay'),
      )).toMatchObject({
        ok: true,
        status: 201,
        body: { row: replayInput },
      });

      // The public key is only one receipt component. Another principal in
      // the same tenant must not receive the first caller's stored result.
      const otherPrincipal: AuthContext = {
        ...authA,
        userId: 'other-user-tenant-a',
        email: 'other-user-tenant-a@example.test',
        membershipId: 'other-membership-tenant-a',
        sessionId: 'other-session-tenant-a',
      };
      expect(await service.create(
        'todos',
        replayInput,
        requestContext(otherPrincipal, 'durable-create-replay'),
      )).toMatchObject({
        ok: false,
        status: 409,
        body: { code: 'resource-conflict' },
      });
      expect(await service.create('todos', {
        id: 'constraint-conflict-id',
      }, requestContext(authA, 'constraint-conflict'))).toMatchObject({
        ok: false,
        status: 409,
        body: { code: 'resource-conflict' },
      });

      // Reusing a logical key for changed request semantics keeps the same
      // namespaced receipt key, allowing the actor fingerprint to reject it.
      expect(await service.create('todos', {
        ...replayInput,
        title: 'Changed request under the same key',
      }, replayContext)).toMatchObject({
        ok: false,
        status: 409,
        body: { code: 'resource-idempotency-key-reused' },
      });

      // Resource/action/row identity belongs to the logical fingerprint, not
      // the private receipt key. The same caller-visible key therefore cannot
      // silently execute a different semantic request.
      const semanticContext = requestContext(authA, 'cross-semantic-reuse');
      expect(await service.create('todos', {
        id: 'semantic-source', title: 'Original semantic request',
      }, semanticContext)).toMatchObject({ ok: true, status: 201 });
      expect(await service.create('todos', {
        id: 'semantic-other-row', title: 'Different row',
      }, semanticContext)).toMatchObject({
        ok: false,
        status: 409,
        body: { code: 'resource-idempotency-key-reused' },
      });
      expect(await service.create('todos', {
        id: 'semantic-update-target', title: 'Before changed action',
      }, requestContext(authA, 'create-semantic-update-target'))).toMatchObject({ ok: true });
      expect(await service.update('todos', 'semantic-update-target', {
        title: 'Must not execute under the create key',
      }, semanticContext)).toMatchObject({
        ok: false,
        status: 409,
        body: { code: 'resource-idempotency-key-reused' },
      });
      expect(await tenantClient(harness.manager, 'tenant-a').get(
        'todos',
        'semantic-update-target',
        { consistency: { mode: 'strong' } },
      )).toMatchObject({ value: { title: 'Before changed action' } });

      // Policy-stamped primary keys may be intentionally nondeterministic.
      // Exact retry identity is the stable client request; a later policy
      // evaluation must replay the original commit instead of inserting the
      // newly stamped primary key.
      let policyStampedCreateId = 0;
      policyHook = (action) => action === 'create'
        ? {
            allowed: true,
            stampedInput: { id: `policy-stamped-${++policyStampedCreateId}` },
          }
        : undefined;
      const policyStampedContext = requestContext(authA, 'policy-stamped-retry');
      const policyStampedInput = { title: 'Policy-stamped exact retry' };
      const firstPolicyStamped = await service.create(
        'todos',
        policyStampedInput,
        policyStampedContext,
      );
      expect(firstPolicyStamped).toMatchObject({
        ok: true,
        status: 201,
        body: {
          row: {
            id: 'policy-stamped-1',
            title: policyStampedInput.title,
          },
        },
      });
      expect(await service.create(
        'todos',
        policyStampedInput,
        policyStampedContext,
      )).toEqual(firstPolicyStamped);
      policyHook = null;
      const policyStampedRows = await tenantClient(harness.manager, 'tenant-a').find(
        'todos',
        {
          filters: [{
            type: 'field',
            field: 'title',
            operator: 'eq',
            value: policyStampedInput.title,
          }],
          limit: 10,
        },
        { consistency: { mode: 'strong' } },
      );
      expect(policyStampedRows.value).toEqual([{
        id: 'policy-stamped-1',
        title: policyStampedInput.title,
      }]);
      assertNoHeldActorWork(harness.coordinator);

      expect(await service.create('todos', {
        id: 'revoked-id', title: 'Before revocation',
      }, requestContext(authA, 'create-revoked'))).toMatchObject({ ok: true });
      let durableAuthority: AuthContext | null = authA;
      policyHook = (action) => {
        if (action === 'update') durableAuthority = null;
      };
      const revoked = await service.update('todos', 'revoked-id', {
        title: 'Must not commit',
      }, {
        authContext: authA,
        idempotencyKey: 'update-revoked',
        revalidateAuthContext: async () => authA,
        resolveAuthContextAtCommit: () => durableAuthority,
      });
      expect(revoked).toMatchObject({
        ok: false,
        status: 403,
        body: { code: 'resource-authority-changed' },
      });
      policyHook = null;
      expect(await tenantClient(harness.manager, 'tenant-a').get(
        'todos',
        'revoked-id',
        { consistency: { mode: 'strong' } },
      )).toMatchObject({ value: { title: 'Before revocation' } });
      assertNoHeldActorWork(harness.coordinator);

      expect(await service.create('todos', {
        id: 'conflict-id', title: 'Before conflict',
      }, requestContext(authA, 'create-conflict'))).toMatchObject({ ok: true });
      let injectedConflict = false;
      policyHook = async (action) => {
        if (action !== 'update' || injectedConflict) return;
        injectedConflict = true;
        await tenantClient(harness.manager, 'tenant-a').mutate({
          type: 'update',
          table: 'todos',
          id: 'conflict-id',
          patch: { title: 'Concurrent winner' },
        }, { idempotencyKey: 'out-of-band-conflict' });
      };
      expect(await service.update('todos', 'conflict-id', {
        title: 'Must lose',
      }, requestContext(authA, 'update-conflict'))).toMatchObject({
        ok: false,
        status: 409,
        body: { code: 'resource-row-changed' },
      });
      policyHook = null;
      expect(await tenantClient(harness.manager, 'tenant-a').get(
        'todos',
        'conflict-id',
        { consistency: { mode: 'strong' } },
      )).toMatchObject({ value: { title: 'Concurrent winner' } });
      assertNoHeldActorWork(harness.coordinator);

      expect(await service.create('todos', {
        id: 'readback-policy-id', title: 'Before readback policy change',
      }, requestContext(authA, 'create-readback-policy'))).toMatchObject({ ok: true });
      let updatePolicyEvaluations = 0;
      policyHook = (action) => {
        if (action !== 'update') return;
        updatePolicyEvaluations += 1;
        return updatePolicyEvaluations === 1;
      };
      expect(await service.update('todos', 'readback-policy-id', {
        title: 'Committed but no longer returnable',
      }, requestContext(authA, 'update-readback-policy'))).toMatchObject({
        ok: false,
        status: 403,
      });
      policyHook = null;
      expect(await tenantClient(harness.manager, 'tenant-a').get(
        'todos',
        'readback-policy-id',
        { consistency: { mode: 'strong' } },
      )).toMatchObject({ value: { title: 'Committed but no longer returnable' } });
      assertNoHeldActorWork(harness.coordinator);

      expect(await service.create('todos', {
        id: 'readback-race-id', title: 'Before readback race',
      }, requestContext(authA, 'create-readback-race'))).toMatchObject({ ok: true });
      let readbackRacePolicyEvaluations = 0;
      policyHook = async (action) => {
        if (action !== 'update') return;
        readbackRacePolicyEvaluations += 1;
        if (readbackRacePolicyEvaluations !== 2) return;
        await tenantClient(harness.manager, 'tenant-a').mutate({
          type: 'update',
          table: 'todos',
          id: 'readback-race-id',
          patch: { title: 'Concurrent writer after commit' },
        }, { idempotencyKey: 'out-of-band-readback-race' });
      };
      expect(await service.update('todos', 'readback-race-id', {
        title: 'Our committed value',
      }, requestContext(authA, 'update-readback-race'))).toMatchObject({
        ok: true,
        status: 200,
        body: {
          row: { id: 'readback-race-id', title: 'Our committed value' },
        },
      });
      policyHook = null;
      expect(await tenantClient(harness.manager, 'tenant-a').get(
        'todos',
        'readback-race-id',
        { consistency: { mode: 'strong' } },
      )).toMatchObject({ value: { title: 'Concurrent writer after commit' } });
      assertNoHeldActorWork(harness.coordinator);

      await service.create('todos', {
        id: 'delete-id', title: 'Delete A',
      }, requestContext(authA, 'create-delete-a'));
      await service.create('todos', {
        id: 'delete-id', title: 'Keep B',
      }, requestContext(authB, 'create-delete-b'));
      const deleteReplayContext = requestContext(authA, 'delete-a');
      expect(await service.delete(
        'todos',
        'delete-id',
        deleteReplayContext,
      )).toMatchObject({ ok: true, body: { deleted: true, id: 'delete-id' } });
      expect(await service.delete(
        'todos',
        'delete-id',
        deleteReplayContext,
      )).toMatchObject({ ok: true, body: { deleted: true, id: 'delete-id' } });
      expect(await service.get('todos', 'delete-id', contextA)).toMatchObject({
        ok: false,
        status: 404,
      });
      expect(await service.get('todos', 'delete-id', contextB)).toMatchObject({
        ok: true,
        body: { row: { title: 'Keep B' } },
      });
      assertNoHeldActorWork(harness.coordinator);
    } finally {
      await harness.manager.close().catch(() => undefined);
      rmSync(harness.root, { recursive: true, force: true });
    }
  }, 30_000);

  test('keeps shared-row CRUD on ReactiveDB with discriminator stamping', async () => {
    const tables = {
      notes: {
        id: 'text primary key',
        tenant_id: 'text not null',
        title: 'text not null',
      },
    } satisfies Record<string, TableSchema>;
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'notes',
        exposure: 'http',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      tenantIsolation: 'shared-row',
      managedTables: ['notes'],
    });
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('notes', tables.notes);
    let actorProjectionCalls = 0;
    const service = new ResourceCrudService({
      db,
      registry,
      tables,
      authConfig: { userProperties: {} },
      getTenantDatabaseClient: () => {
        actorProjectionCalls += 1;
        throw new Error('shared-row CRUD must not acquire an actor');
      },
    });
    const authA = tenantAuth('tenant-a');
    const authB = tenantAuth('tenant-b');

    try {
      expect(await service.create('notes', {
        id: 'a', title: 'A',
      }, requestContext(authA, 'shared-a'))).toMatchObject({
        ok: true,
        body: { row: { id: 'a', tenant_id: 'tenant-a', title: 'A' } },
      });
      expect(await service.create('notes', {
        id: 'b', title: 'B',
      }, requestContext(authB, 'shared-b'))).toMatchObject({
        ok: true,
        body: { row: { id: 'b', tenant_id: 'tenant-b', title: 'B' } },
      });
      expect(await service.list('notes', {}, requestContext(authA, 'list-a')))
        .toMatchObject({ body: { rows: [{ id: 'a', tenant_id: 'tenant-a' }] } });
      expect(await service.list('notes', {}, requestContext(authB, 'list-b')))
        .toMatchObject({ body: { rows: [{ id: 'b', tenant_id: 'tenant-b' }] } });
      expect(actorProjectionCalls).toBe(0);
    } finally {
      db.dispose();
    }
  });

  test('returns actor-canonical identity-derived and numeric primary keys', async () => {
    const tables = {
      natural_documents: {
        id: 'text primary key',
        slug: 'text not null',
        title: 'text not null',
        _identity: ['slug'],
      },
      numbered_documents: {
        id: 'integer primary key',
        title: 'text not null',
      },
    } satisfies Record<string, TableSchema>;
    const registry = createResourceRegistry({
      resources: [
        defineResource({
          table: 'natural_documents',
          exposure: 'http',
          realm: tenantRealm(),
          policy: authenticatedOnly(),
        }),
        defineResource({
          table: 'numbered_documents',
          exposure: 'http',
          realm: tenantRealm(),
          policy: authenticatedOnly(),
        }),
      ],
      tables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      tenantIsolation: 'tenant-database',
      managedTables: Object.keys(tables),
    });
    const db = createReactiveDB({ mode: 'memory' });
    let releases = 0;
    const service = new ResourceCrudService({
      db,
      registry,
      tables,
      authConfig: { userProperties: {} },
      getTenantDatabaseClient: async () => fakeCanonicalCreateAccess(
        () => { releases += 1; },
      ),
    });
    const auth = tenantAuth('tenant-a');

    try {
      expect(await service.create('natural_documents', {
        slug: 'welcome',
        title: 'Identity derived',
      }, requestContext(auth, 'identity-derived'))).toMatchObject({
        ok: true,
        status: 201,
        body: {
          row: {
            id: 'identity:welcome',
            slug: 'welcome',
            title: 'Identity derived',
          },
        },
      });
      expect(await service.create('numbered_documents', {
        id: 7,
        title: 'Numeric key',
      }, requestContext(auth, 'numeric-key'))).toMatchObject({
        ok: true,
        status: 201,
        body: { row: { id: 7, title: 'Numeric key' } },
      });
      expect(releases).toBe(2);
    } finally {
      db.dispose();
    }
  });

  test('rechecks durable authority immediately before physical rows and commits are returned', async () => {
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'todos',
        exposure: 'http',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables: physicalTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      tenantIsolation: 'tenant-database',
      managedTables: ['todos'],
    });
    const db = createReactiveDB({ mode: 'memory' });
    const auth = tenantAuth('tenant-a');
    let durableAuth: AuthContext | null = auth;
    let releases = 0;
    let committedCreates = 0;
    const service = new ResourceCrudService({
      db,
      registry,
      tables: physicalTables,
      authConfig: { userProperties: {} },
      getTenantDatabaseClient: async ({ assertCurrentAuthoritySync }) => ({
        client: {
          ...unexpectedDatabaseClient(),
          async find() {
            assertCurrentAuthoritySync();
            assertCurrentAuthoritySync();
            // Interleave revocation after the actor-side post-read check and
            // before the engine resumes from its await.
            queueMicrotask(() => { durableAuth = null; });
            return {
              value: [{ id: 'private-row', title: 'Must not escape' }],
              sequence: { seq: 1 },
            };
          },
        },
        trustedWriter: {
          async findReceipt() {
            return { status: 'miss' as const };
          },
          async executeWrite(operation) {
            assertCurrentAuthoritySync();
            assertCurrentAuthoritySync();
            const request = operation as {
              idempotencyKey: string;
              mutation: {
                type: 'create';
                table: string;
                row: DatabaseOperationRow;
              };
            };
            committedCreates += 1;
            queueMicrotask(() => { durableAuth = null; });
            return {
              value: {
                kind: 'mutation' as const,
                mutation: {
                  type: 'create' as const,
                  table: request.mutation.table,
                  rowId: String(request.mutation.row.id),
                  changed: true,
                  op: 'INSERT' as const,
                  sequence: { seq: 2 },
                  row: request.mutation.row,
                  previousRow: null,
                },
              },
              sequence: { seq: 2 },
              idempotencyKey: request.idempotencyKey,
              replayed: false,
            };
          },
        },
        release() { releases += 1; },
      }),
    });
    const context = (key: string): ResourceCrudRequestContext => ({
      authContext: auth,
      idempotencyKey: key,
      // Keep the asynchronous bearer stable to isolate the final durable
      // delivery fence from the earlier request-time revalidation.
      revalidateAuthContext: async () => auth,
      resolveAuthContextAtCommit: () => durableAuth,
    });

    try {
      expect(await service.list('todos', {}, context('list-race'))).toEqual({
        ok: false,
        status: 403,
        body: {
          error: 'Resource authorization changed during the request',
          code: 'resource-authority-changed',
        },
      });

      durableAuth = auth;
      expect(await service.create(
        'todos',
        { id: 'committed-private', title: 'Committed but not returnable' },
        context('create-race'),
      )).toEqual({
        ok: false,
        status: 403,
        body: {
          error: 'Resource authorization changed during the request',
          code: 'resource-authority-changed',
        },
      });
      expect(committedCreates).toBe(1);
      expect(releases).toBe(2);
    } finally {
      db.dispose();
    }
  });

  test('returns a permanent safe conflict for an expired mutation receipt', async () => {
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'todos',
        exposure: 'http',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables: physicalTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      tenantIsolation: 'tenant-database',
      managedTables: ['todos'],
    });
    const db = createReactiveDB({ mode: 'memory' });
    let releases = 0;
    let executions = 0;
    const events = new MemoryEventStore();
    const service = new ResourceCrudService({
      db,
      registry,
      tables: physicalTables,
      authConfig: { userProperties: {} },
      observability: {
        sink: events,
        store: events,
        config: { console: false, store: events },
      },
      getTenantDatabaseClient: async () => ({
        client: unexpectedDatabaseClient(),
        trustedWriter: {
          async findReceipt() {
            throw new DatabaseError(
              'DATABASE_OUTCOME_UNKNOWN',
              'Private receipt values must not be returned.',
              {
                outcome: 'unknown',
                details: { receiptState: 'expired' },
              },
            );
          },
          async executeWrite(): Promise<never> {
            executions += 1;
            throw new Error('Expired receipt must never execute again');
          },
        },
        release() { releases += 1; },
      }),
    });
    try {
      expect(await service.update(
        'todos',
        'expired-row',
        { title: 'must not execute' },
        requestContext(tenantAuth('tenant-a'), 'expired-request-key'),
      )).toEqual({
        ok: false,
        status: 409,
        body: {
          error: 'Idempotency result expired; read the current resource state before submitting new work',
          code: 'resource-idempotency-result-expired',
          retryable: false,
        },
      });
      expect(executions).toBe(0);
      expect(releases).toBe(1);
      expect(events.query().events).toEqual([
        expect.objectContaining({
          code: OBS_CODES.DATABASE_RECEIPT_EXPIRED.code,
          error: undefined,
          metadata: {
            resource: 'todos',
            table: 'todos',
            action: 'update',
            databasePlane: 'tenant',
          },
        }),
      ]);
      expect(JSON.stringify(events.query().events)).not.toContain('Private receipt');
    } finally {
      db.dispose();
    }
  });

  test('emits unavailable actor failures only through the app-local runtime', async () => {
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'todos',
        exposure: 'http',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables: physicalTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      tenantIsolation: 'tenant-database',
      managedTables: ['todos'],
    });
    const db = createReactiveDB({ mode: 'memory' });
    const ambient = new MemoryEventStore();
    const local = new MemoryEventStore();
    configureObservability({ console: false, store: ambient });
    const service = new ResourceCrudService({
      db,
      registry,
      tables: physicalTables,
      authConfig: { userProperties: {} },
      observability: {
        sink: local,
        store: local,
        config: { console: false, store: local },
      },
      getTenantDatabaseClient: async () => {
        throw new DatabaseError(
          'DATABASE_BACKPRESSURE',
          'Private actor capacity detail.',
          { retryable: true, outcome: 'not-started' },
        );
      },
    });
    try {
      expect(await service.list(
        'todos',
        {},
        requestContext(tenantAuth('tenant-a'), 'unavailable-list'),
      )).toMatchObject({ ok: false, status: 503 });
      expect(local.query().events.map((event) => event.code)).toEqual([
        'resource.crud.failed',
      ]);
      expect(ambient.query().count).toBe(0);
      expect(JSON.stringify(local.query().events)).not.toContain(
        'Private actor capacity detail',
      );
    } finally {
      configureObservability(false);
      db.dispose();
    }
  });

  test('maps permanent actor capacities to non-retryable plane-specific contracts', async () => {
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'todos',
        exposure: 'http',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables: physicalTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      tenantIsolation: 'tenant-database',
      managedTables: ['todos'],
    });
    const db = createReactiveDB({ mode: 'memory' });
    const events = new MemoryEventStore();
    let capacityType: 'files' | 'receipts' = 'files';
    const service = new ResourceCrudService({
      db,
      registry,
      tables: physicalTables,
      authConfig: { userProperties: {} },
      observability: {
        sink: events,
        store: events,
        config: { console: false, store: events },
      },
      getTenantDatabaseClient: async () => {
        throw new DatabaseError(
          'DATABASE_CAPACITY_EXHAUSTED',
          'Private capacity detail.',
          {
            details: {
              capacityType,
              capacityLimit: capacityType === 'files' ? 10_000 : 1_000_000,
              tenant: 'private-tenant',
            },
          },
        );
      },
    });
    try {
      expect(await service.list(
        'todos',
        {},
        requestContext(tenantAuth('tenant-a'), 'file-capacity'),
      )).toEqual({
        ok: false,
        status: 503,
        body: {
          error: 'Tenant database capacity is exhausted',
          code: 'database-capacity-exhausted',
          retryable: false,
        },
      });
      capacityType = 'receipts';
      expect(await service.create(
        'todos',
        { id: 'must-not-commit', title: 'Must not commit' },
        requestContext(tenantAuth('tenant-a'), 'receipt-capacity'),
      )).toEqual({
        ok: false,
        status: 503,
        body: {
          error: 'Resource idempotency receipt capacity is exhausted',
          code: 'resource-idempotency-capacity-exhausted',
          retryable: false,
        },
      });
      const receiptEvent = events.query({
        code: 'resource.receipt.capacity_exhausted',
      }).events[0];
      expect(receiptEvent?.error).toBeUndefined();
      expect(receiptEvent?.metadata).toEqual({
        resource: 'todos',
        table: 'todos',
        action: 'create',
        databasePlane: 'tenant',
        permanentKeyLimit: 1_000_000,
      });
      expect(JSON.stringify(events.query().events)).not.toContain('private');
    } finally {
      db.dispose();
    }
  });
});

function requestContext(
  authContext: AuthContext,
  idempotencyKey: string,
): ResourceCrudRequestContext {
  return {
    authContext,
    idempotencyKey,
    revalidateAuthContext: async () => authContext,
    resolveAuthContextAtCommit: () => authContext,
  };
}

function tenantAuth(tenantId: string): AuthContext {
  return {
    userId: `user-${tenantId}`,
    email: `${tenantId}@example.test`,
    role: 'user',
    sessionKind: 'web',
    sessionId: `session-${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `membership-${tenantId}`,
    tenantRole: 'member',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}

function tenantClient(manager: DatabaseManager, tenantId: string): AsyncDatabaseClient {
  const client = createRequestDatabaseClient({
    manager,
    scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId }),
    assertCurrentAuthoritySync: () => undefined,
  });
  if (!client) throw new Error('Expected tenant database client');
  return client;
}

function fakeCanonicalCreateAccess(
  release: () => void,
): ResourceTenantDatabaseAccess {
  const trustedWriter: DatabaseTrustedWriteExecutor = {
    async findReceipt() {
      return { status: 'miss' };
    },
    async executeWrite(operation) {
      const request = operation as {
        idempotencyKey: string;
        mutation: {
          type: 'create';
          table: string;
          row: DatabaseOperationRow;
        };
      };
      const row = request.mutation.table === 'natural_documents'
        ? { id: 'identity:welcome', ...request.mutation.row }
        : request.mutation.row;
      const rowId = String(row.id);
      return {
        value: {
          kind: 'mutation',
          mutation: {
            type: 'create',
            table: request.mutation.table,
            rowId,
            changed: true,
            op: 'INSERT',
            sequence: { seq: 1 },
            row,
            previousRow: null,
          },
        },
        sequence: { seq: 1 },
        idempotencyKey: request.idempotencyKey,
        replayed: false,
      };
    },
  };
  const unavailable = async (): Promise<never> => {
    throw new Error('Unexpected fake database read');
  };
  return {
    client: {
      get: unavailable,
      list: unavailable,
      find: unavailable,
      query: unavailable,
      mutate: unavailable,
      batch: unavailable,
      command: unavailable,
    },
    trustedWriter,
    release,
  };
}

function unexpectedDatabaseClient(): AsyncDatabaseClient {
  const unavailable = async (): Promise<never> => {
    throw new Error('Expired receipt must resolve before a database read');
  };
  return {
    get: unavailable,
    list: unavailable,
    find: unavailable,
    query: unavailable,
    mutate: unavailable,
    batch: unavailable,
    command: unavailable,
  };
}

function assertNoHeldActorWork(coordinator: DatabaseCoordinator): void {
  const diagnostics = coordinator.diagnostics();
  expect(diagnostics.activeOperations).toBe(0);
  expect(diagnostics.heldAuthorityLeases).toBe(0);
  for (const database of diagnostics.databases) {
    expect(database.leases).toBe(0);
    expect(database.activeOperations).toBe(0);
    expect(database.queueDepth).toBe(0);
  }
}

function createActorHarness(): {
  root: string;
  systemRuntime: DatabaseRuntime;
  defaultRuntime: DatabaseRuntime;
  coordinator: DatabaseCoordinator;
  manager: DatabaseManager;
} {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'zero-resource-tenant-database-')),
  );
  const systemRuntime = DatabaseRuntime.open({
    id: 'system',
    role: 'system',
    sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }),
    ownsSQLite: true,
  });
  const defaultRuntime = DatabaseRuntime.open({
    id: 'default',
    role: 'default',
    sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }),
    ownsSQLite: true,
  });
  const authority = new AuthorityCommitCoordinator();
  const coordinator = new DatabaseCoordinator({
    rootDirectory: root,
    realm: databaseActorFixtureRealm,
    maxDatabases: 2,
    sweepIntervalMs: false,
    operationTimeoutMs: 5_000,
    authorityCommitCoordinator: authority,
    requireCommitAuthority: true,
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
  const manager = new DatabaseManager({
    systemRuntime,
    appRuntime: defaultRuntime,
    multiple: {
      coordinator,
      authorityCommitCoordinator: authority,
      tenantDatabases: true,
    },
  });
  return { root, systemRuntime, defaultRuntime, coordinator, manager };
}
