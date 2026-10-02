import { describe, expect, test } from 'bun:test';

import {
  applicationServiceDataScope,
  trustedSystemServiceDataScope,
} from '../auth/service-data-scope';
import type { AuthContext, AuthContextAuthorityReference } from '../auth/types';
import { createReactiveDB } from '../sync/reactive-db';
import { getPlatformSink, setPlatformSink } from '../observability/sink';
import type { PlatformEvent } from '../observability/types';
import { WorkflowDefinitionManager } from './workflow-definition-manager';
import {
  WorkflowExecutionAuthorityStore,
  type WorkflowActorExecutionAuthority,
  type WorkflowExecutionAuthorityProvider,
  type WorkflowResolvedExecutionAuthority,
} from './workflow-execution-authority';
import type { WorkflowGraphIR } from './workflow-ir';
import { flow, requestAndWait, step } from './workflow-dsl';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { getWorkflowGraphRuntime, WorkflowService } from './workflow-service';
import { validateWorkflowGraphEventState } from './workflow-event-persisted-state';

describe('workflow start authority commit boundary', () => {
  test('authorizes the exact immutable version against freshly captured roles', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'database.noop',
      databaseCallable: true,
      handler: async () => ({ ok: true }),
    });
    const authorityStore = new WorkflowExecutionAuthorityStore(db);
    let manager!: WorkflowDefinitionManager;
    let activateRestricted = false;
    let roles: readonly string[] = ['clinician'];
    const context = actorContext();
    const provider: WorkflowExecutionAuthorityProvider = {
      captureActor() {
        if (activateRestricted) {
          activateRestricted = false;
          manager.activate(definitionId, restrictedVersionId, 'security-test');
        }
        return actorAuthority(authorityStore, context, roles);
      },
      revalidateActor(authority) {
        return resolvedAuthority(authority, context);
      },
    };
    const service = new WorkflowService(db, registry, {
      authorityProvider: provider,
      authorityStore,
    });
    manager = new WorkflowDefinitionManager(
      registry,
      getWorkflowGraphRuntime(service).versions,
    );
    const allowed = manager.publish({
      name: 'authorization-race',
      graph: singleNodeGraph(),
      access: { start: ['clinician'] },
    }, 'security-test');
    const restricted = manager.publish({
      name: 'authorization-race',
      graph: singleNodeGraph(),
      access: { start: 'admin' },
      version: 2,
      activate: false,
    }, 'security-test');
    const definitionId = allowed.catalog.definition_id;
    const restrictedVersionId = restricted.version.version_id;

    try {
      // Simulate an earlier HTTP/catalog decision for active v1. Capturing the
      // live actor then activates v2, so only a trusted exact-version check can
      // prevent the restricted head from executing under stale authorization.
      manager.assertCanStart(
        'authorization-race',
        undefined,
        { role: 'user', roles: ['clinician'], administrator: false },
      );
      activateRestricted = true;
      await expect(service.runAsActor(
        'authorization-race', {}, context,
      )).rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND', status: 404 });
      expect(service.list()).toEqual([]);

      // The same trusted boundary must use roles captured after a stale
      // request snapshot. Revoking the clinician role cannot start v1.
      manager.activate(definitionId, allowed.version.version_id, 'security-test');
      manager.assertCanStart(
        'authorization-race',
        undefined,
        { role: 'user', roles: ['clinician'], administrator: false },
      );
      roles = ['member'];
      await expect(service.runAsActor(
        'authorization-race', {}, context,
      )).rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND', status: 404 });
      expect(service.list()).toEqual([]);
    } finally {
      await service.dispose();
      db.dispose();
    }
  });

  test('revalidates graph and legacy actors inside the instance-create transaction', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    registry.registerActivity({ name: 'graph.noop', handler: async () => null });
    registry.registerHandler('legacy.noop', async () => null);
    registry.create({
      name: 'commit-race-graph',
      flow: flow(step('complete', 'graph.noop')),
    });
    registry.create({
      name: 'commit-race-legacy',
      steps: [{ name: 'Complete', handler: 'legacy.noop' }],
    });
    const authorityStore = new WorkflowExecutionAuthorityStore(db);
    const context = actorContext();
    let revokeAtCommit = false;
    let commitRevalidations = 0;
    const provider: WorkflowExecutionAuthorityProvider = {
      captureActor() {
        return actorAuthority(authorityStore, context, ['member']);
      },
      revalidateActor(authority) {
        commitRevalidations += 1;
        if (revokeAtCommit) return null;
        return resolvedAuthority(authority, context);
      },
    };
    const events: PlatformEvent[] = [];
    const previousSink = getPlatformSink();
    setPlatformSink({ emit(event) { events.push(event); } });
    const service = new WorkflowService(db, registry, {
      authorityProvider: provider,
      authorityStore,
    });

    try {
      for (const name of ['commit-race-graph', 'commit-race-legacy']) {
        revokeAtCommit = true;
        await expect(service.runAsActor(name, {}, context)).rejects.toMatchObject({
          code: 'AUTH_STATE_CHANGED',
          status: 409,
        });
        revokeAtCommit = false;
      }

      expect(commitRevalidations).toBe(2);
      expect(db.query('workflow_instances')).toEqual([]);
      expect(db.query('workflow_steps')).toEqual([]);
      expect(db.prepare('SELECT instance_id FROM _workflow_execution_authorities').all())
        .toEqual([]);
      expect(events.filter((event) => event.code === 'workflows.instance.started'
        && ['commit-race-graph', 'commit-race-legacy'].includes(
          String(event.metadata?.name),
        ))).toEqual([]);
    } finally {
      setPlatformSink(previousSink);
      await service.dispose();
      db.dispose();
    }
  });

  test('rechecks the exact graph head and tenant namespace in the create transaction', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'database.noop',
      databaseCallable: true,
      handler: async () => null,
    });
    const authorityStore = new WorkflowExecutionAuthorityStore(db);
    const context = actorContext();
    let finalFence: (() => void) | null = null;
    const provider: WorkflowExecutionAuthorityProvider = {
      captureActor() {
        return actorAuthority(authorityStore, context, ['member']);
      },
      revalidateActor(authority) {
        finalFence?.();
        finalFence = null;
        return resolvedAuthority(authority, context);
      },
    };
    const service = new WorkflowService(db, registry, {
      authorityProvider: provider,
      authorityStore,
    });
    const manager = new WorkflowDefinitionManager(
      registry,
      getWorkflowGraphRuntime(service).versions,
    );
    const first = manager.publish({
      name: 'head-commit-race',
      graph: singleNodeGraph(),
      access: { start: ['member'] },
    }, 'security-test');
    const second = manager.publish({
      name: 'head-commit-race',
      graph: singleNodeGraph(),
      access: { start: ['administrator'] },
      version: 2,
      activate: false,
    }, 'security-test');
    try {
      finalFence = () => manager.activate(
        first.catalog.definition_id,
        second.version.version_id,
        'security-test',
      );
      await expect(service.runAsActor(
        'head-commit-race', {}, context,
      )).rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND', status: 404 });
      expect(service.list()).toEqual([]);

      finalFence = () => manager.retire(
        first.catalog.definition_id,
        first.version.version_id,
        'security-test',
      );
      await expect(service.runAsActor(
        'head-commit-race', {}, context, { version: 1 },
      )).rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND', status: 404 });
      expect(service.list()).toEqual([]);
      expect(db.prepare('SELECT COUNT(*) AS count FROM _workflow_execution_authorities').get())
        .toEqual({ count: 0 });
    } finally {
      await service.dispose();
      db.dispose();
    }

    const tenantDb = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(tenantDb);
    const tenantRegistry = new WorkflowRegistry();
    tenantRegistry.registerActivity({
      name: 'database.noop',
      databaseCallable: true,
      handler: async () => null,
    });
    tenantRegistry.create({
      name: 'tenant-shadow-commit-race',
      flow: flow(step('complete', 'database.noop')),
    });
    const tenantId = 'tenant-commit-race';
    const tenantContext = tenantActorContext(tenantId);
    const tenantAuthorityStore = new WorkflowExecutionAuthorityStore(tenantDb);
    let publishShadow: (() => void) | null = null;
    let tenantManager!: WorkflowDefinitionManager;
    const tenantProvider: WorkflowExecutionAuthorityProvider = {
      captureActor() {
        return actorAuthority(tenantAuthorityStore, tenantContext, ['member'], tenantId);
      },
      revalidateActor(authority) {
        publishShadow?.();
        publishShadow = null;
        return resolvedAuthority(authority, tenantContext, tenantId);
      },
    };
    const tenantService = new WorkflowService(tenantDb, tenantRegistry, {
      tenancyMode: 'multi',
      authorityProvider: tenantProvider,
      authorityStore: tenantAuthorityStore,
    });
    tenantManager = new WorkflowDefinitionManager(
      tenantRegistry,
      getWorkflowGraphRuntime(tenantService).versions,
      { type: 'tenant', id: tenantId },
    );
    try {
      publishShadow = () => {
        tenantManager.publish({
          name: 'tenant-shadow-commit-race',
          graph: singleNodeGraph(),
        }, 'security-test');
      };
      await expect(tenantService.runAsActor(
        'tenant-shadow-commit-race', {}, tenantContext,
      )).rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND', status: 404 });
      expect(tenantDb.query('workflow_instances')).toEqual([]);
      expect(getWorkflowGraphRuntime(tenantService).versions.findCatalog(
        'tenant-shadow-commit-race',
        { type: 'tenant', id: tenantId },
      )).toBeNull();
    } finally {
      await tenantService.dispose();
      tenantDb.dispose();
    }
  });

  test('validates sealed event authority, accounting, and orphan state during recovery', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    registry.create({
      name: 'sealed-event-state',
      flow: flow(requestAndWait('approval', 'approval.response')),
    });
    const authorityStore = new WorkflowExecutionAuthorityStore(db);
    const context = actorContext();
    const provider: WorkflowExecutionAuthorityProvider = {
      captureActor() {
        return actorAuthority(authorityStore, context, ['member']);
      },
      revalidateActor(authority) {
        return resolvedAuthority(authority, context);
      },
    };
    const service = new WorkflowService(db, registry, {
      authorityProvider: provider,
      authorityStore,
    });
    try {
      const instanceId = await service.runAsActor('sealed-event-state', {}, context);
      service.pause(instanceId);
      const fence = service.captureActorAuthorityFence(context);
      await service.sendEvent(
        instanceId,
        'approval.response',
        { approved: true },
        context.userId,
        { actorId: context.userId, tenantId: null, roles: ['member'] },
        undefined,
        {
          actorAuthority: fence.authority,
          assertCurrentAuthority: fence.assertCurrentAuthority,
        },
      );
      expect(() => validateWorkflowGraphEventState(db, instanceId)).not.toThrow();

      const row = db.prepare(`SELECT delivery.event_id, delivery.actor_bytes,
        delivery.actor_json, event.event_name, event.payload, event.sent_by,
        event.created_at, authority.authority_mac
        FROM _workflow_event_delivery AS delivery
        INNER JOIN workflow_events AS event ON event.event_id = delivery.event_id
        INNER JOIN _workflow_event_authorities AS authority
          ON authority.event_id = delivery.event_id
        WHERE delivery.instance_id = ? LIMIT 1`).get(instanceId) as {
          event_id: string;
          actor_bytes: number;
          actor_json: string;
          event_name: string;
          payload: string;
          sent_by: string;
          created_at: string;
          authority_mac: string;
      };
      expect(() => db.prepare(`UPDATE _workflow_event_delivery
        SET authority_kind = 'system' WHERE event_id = ?`).run(row.event_id))
        .toThrow(/workflow event delivery envelope is immutable/);
      db.exec('DROP TRIGGER trg_workflow_event_delivery_envelope_immutable');
      db.prepare(`UPDATE _workflow_event_delivery SET actor_bytes = actor_bytes + 1
        WHERE event_id = ?`).run(row.event_id);
      expect(() => validateWorkflowGraphEventState(db, instanceId)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_STATE_INVALID',
      }));
      db.prepare(`UPDATE _workflow_event_delivery SET actor_bytes = ? WHERE event_id = ?`)
        .run(row.actor_bytes, row.event_id);

      db.exec('DROP TRIGGER trg_workflow_event_command_immutable');
      const sameBytePayload = row.payload.replace('true', 'null');
      expect(Buffer.byteLength(sameBytePayload)).toBe(Buffer.byteLength(row.payload));
      db.prepare('UPDATE workflow_events SET payload = ? WHERE event_id = ?')
        .run(sameBytePayload, row.event_id);
      expect(() => validateWorkflowGraphEventState(db, instanceId)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_STATE_INVALID',
      }));
      db.prepare('UPDATE workflow_events SET payload = ? WHERE event_id = ?')
        .run(row.payload, row.event_id);

      const changedName = `${row.event_name.slice(0, -1)}x`;
      db.prepare('UPDATE workflow_events SET event_name = ? WHERE event_id = ?')
        .run(changedName, row.event_id);
      db.prepare('UPDATE _workflow_event_delivery SET event_name = ? WHERE event_id = ?')
        .run(changedName, row.event_id);
      expect(() => validateWorkflowGraphEventState(db, instanceId)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_STATE_INVALID',
      }));
      db.prepare('UPDATE workflow_events SET event_name = ? WHERE event_id = ?')
        .run(row.event_name, row.event_id);
      db.prepare('UPDATE _workflow_event_delivery SET event_name = ? WHERE event_id = ?')
        .run(row.event_name, row.event_id);

      const changedCreatedAt = new Date(Date.parse(row.created_at) + 1).toISOString();
      db.prepare('UPDATE workflow_events SET created_at = ? WHERE event_id = ?')
        .run(changedCreatedAt, row.event_id);
      db.prepare('UPDATE _workflow_event_delivery SET created_at = ? WHERE event_id = ?')
        .run(changedCreatedAt, row.event_id);
      expect(() => validateWorkflowGraphEventState(db, instanceId)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_STATE_INVALID',
      }));
      db.prepare('UPDATE workflow_events SET created_at = ? WHERE event_id = ?')
        .run(row.created_at, row.event_id);
      db.prepare('UPDATE _workflow_event_delivery SET created_at = ? WHERE event_id = ?')
        .run(row.created_at, row.event_id);

      const changedSender = `${row.sent_by.slice(0, -1)}2`;
      const changedActor = JSON.stringify({
        ...JSON.parse(row.actor_json) as Record<string, unknown>,
        actorId: changedSender,
      });
      expect(Buffer.byteLength(changedActor)).toBe(Buffer.byteLength(row.actor_json));
      db.prepare('UPDATE workflow_events SET sent_by = ? WHERE event_id = ?')
        .run(changedSender, row.event_id);
      db.prepare('UPDATE _workflow_event_delivery SET actor_json = ? WHERE event_id = ?')
        .run(changedActor, row.event_id);
      expect(() => validateWorkflowGraphEventState(db, instanceId)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_STATE_INVALID',
      }));
      db.prepare('UPDATE workflow_events SET sent_by = ? WHERE event_id = ?')
        .run(row.sent_by, row.event_id);
      db.prepare('UPDATE _workflow_event_delivery SET actor_json = ? WHERE event_id = ?')
        .run(row.actor_json, row.event_id);

      db.exec('DROP TRIGGER trg_workflow_event_authority_immutable');
      db.prepare(`UPDATE _workflow_event_authorities SET authority_mac = ? WHERE event_id = ?`)
        .run('0'.repeat(64), row.event_id);
      expect(() => validateWorkflowGraphEventState(db, instanceId)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_STATE_INVALID',
      }));
      db.prepare(`UPDATE _workflow_event_authorities SET authority_mac = ? WHERE event_id = ?`)
        .run(row.authority_mac, row.event_id);

      db.prepare('DELETE FROM _workflow_event_delivery WHERE event_id = ?').run(row.event_id);
      expect(() => validateWorkflowGraphEventState(db, instanceId)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_STATE_INVALID',
        message: expect.stringContaining('authority row'),
      }));
    } finally {
      await service.dispose();
      db.dispose();
    }
  });

  test('fails missing and corrupt run authority before recovery publication', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    const registry = new WorkflowRegistry();
    let handlerCalls = 0;
    registry.registerHandler('authority-recovery-wait', async () => {
      handlerCalls += 1;
      return null;
    });
    registry.create({
      name: 'authority-recovery-preflight',
      steps: [{
        name: 'Wait',
        handler: 'authority-recovery-wait',
        waitFor: 'continue',
      }],
    });
    registry.create({
      name: 'authority-recovery-graph-preflight',
      flow: flow(requestAndWait('approval', 'approval.responded')),
    });
    const context = actorContext();
    const recoveryNow = new Date('2040-01-01T00:00:00.000Z');
    const clock = { now: () => new Date(recoveryNow) };
    const authorityStore = new WorkflowExecutionAuthorityStore(db);
    const provider: WorkflowExecutionAuthorityProvider = {
      captureActor() {
        return actorAuthority(authorityStore, context, ['member']);
      },
      revalidateActor(authority) {
        return resolvedAuthority(authority, context);
      },
    };
    const first = new WorkflowService(db, registry, {
      authorityProvider: provider,
      authorityStore,
      clock,
    });
    const missingId = await first.runAsActor(
      'authority-recovery-preflight', {}, context,
    );
    const corruptId = await first.runAsActor(
      'authority-recovery-preflight', {}, context,
    );
    const missingGraphId = await first.runAsActor(
      'authority-recovery-graph-preflight', {}, context,
    );
    const corruptGraphId = await first.runAsActor(
      'authority-recovery-graph-preflight', {}, context,
    );
    first.pause(corruptId);
    first.pause(corruptGraphId);
    for (const [instanceId, queued] of [
      [missingId, 1],
      [corruptId, 2],
      [missingGraphId, 3],
      [corruptGraphId, 4],
    ] as const) {
      await first.sendEvent(instanceId, 'unmatched', { queued });
    }
    await first.dispose();

    db.prepare('DELETE FROM _workflow_execution_authorities WHERE instance_id = ?')
      .run(missingId);
    db.prepare('DELETE FROM _workflow_execution_authorities WHERE instance_id = ?')
      .run(missingGraphId);
    db.prepare(`UPDATE _workflow_execution_authorities
      SET authority_mac = ? WHERE instance_id = ?`).run('0'.repeat(64), corruptId);
    db.prepare(`UPDATE _workflow_execution_authorities
      SET authority_mac = ? WHERE instance_id = ?`).run('0'.repeat(64), corruptGraphId);
    const second = new WorkflowService(db, registry, {
      authorityProvider: provider,
      authorityStore: new WorkflowExecutionAuthorityStore(db),
      clock,
    });
    let published: Array<{ instance_id: string; status: string }> = [];
    try {
      await second.recoverInFlight(() => {
        published = db.query('workflow_instances') as Array<{
          instance_id: string;
          status: string;
        }>;
      });
      for (const instanceId of [
        missingId,
        corruptId,
        missingGraphId,
        corruptGraphId,
      ]) {
        expect(published.find((row) => row.instance_id === instanceId)?.status).toBe('failed');
        expect(second.get(instanceId)).toMatchObject({
          status: 'failed',
          error: 'Workflow execution authority is no longer valid',
          updated_at: recoveryNow.toISOString(),
          completed_at: recoveryNow.toISOString(),
        });
        expect(db.prepare(`SELECT queued_count, queued_bytes
          FROM _workflow_event_usage WHERE instance_id = ?`).get(instanceId)).toEqual({
          queued_count: 0,
          queued_bytes: 0,
        });
      }
      expect(handlerCalls).toBe(0);
    } finally {
      await second.dispose();
      db.dispose();
    }
  });
});

function singleNodeGraph(): WorkflowGraphIR {
  return {
    schemaVersion: 1,
    entry: 'complete',
    nodes: [{
      id: 'complete',
      kind: 'activity',
      activity: { name: 'database.noop' },
    }],
    edges: [],
  };
}

function actorContext(): AuthContext {
  return {
    userId: 'actor-1',
    email: 'actor@example.test',
    role: 'user',
    authGeneration: 0,
    sessionKind: 'web',
    sessionId: 'session-1',
    sessionGeneration: 0,
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
  };
}

function tenantActorContext(tenantId: string): AuthContext {
  return {
    ...actorContext(),
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `membership:${tenantId}`,
  };
}

function actorAuthority(
  store: WorkflowExecutionAuthorityStore,
  context: AuthContext,
  roles: readonly string[],
  tenantId: string | null = null,
): WorkflowActorExecutionAuthority {
  const reference: AuthContextAuthorityReference = {
    version: 1,
    userId: context.userId,
    platformRole: context.role,
    authGeneration: 0,
    sessionKind: 'web',
    sessionId: 'session-1',
    mfaVerifiedAt: null,
    sessionGeneration: 0,
    clientId: null,
    identityScopes: [],
    sessionScopeKind: tenantId === null ? 'application' : 'tenant',
    sessionScopeId: tenantId ?? 'application',
    tenantId,
    membershipId: tenantId === null ? null : `membership:${tenantId}`,
    tenantKind: tenantId === null ? null : 'organization',
    tenantRole: tenantId === null ? null : 'member',
    tenantAuthorizationGeneration: tenantId === null ? null : 0,
    membershipAuthorizationGeneration: tenantId === null ? null : 0,
    authorizationAssignmentRevision: null,
  };
  return Object.freeze({
    version: 1,
    kind: 'actor',
    reference,
    identity: Object.freeze({
      kind: 'actor',
      userId: context.userId,
      platformRole: context.role,
      scopeKind: tenantId === null ? 'application' : 'tenant',
      scopeId: tenantId ?? 'application',
      tenantId,
      membershipId: tenantId === null ? null : `membership:${tenantId}`,
      roles: Object.freeze([...roles]),
      permissions: Object.freeze([]),
      allPermissions: false,
      authorizationRevision: `roles:${roles.join(',')}`,
      sessionKind: 'web',
      clientId: null,
    }),
    propertiesMac: store.propertyMac({}),
  });
}

function resolvedAuthority(
  authority: WorkflowActorExecutionAuthority,
  context: AuthContext,
  tenantId: string | null = null,
): WorkflowResolvedExecutionAuthority {
  return Object.freeze({
    persisted: authority,
    identity: authority.identity,
    scope: tenantId === null
      ? applicationServiceDataScope()
      : trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId }),
    authContext: context,
    userProperties: Object.freeze({}),
  });
}
