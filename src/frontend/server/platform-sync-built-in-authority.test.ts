import { describe, expect, test } from 'bun:test';

import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import type { AuthorizationRoleAssignmentResolver } from '../../auth/authorization-access';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import type { AuthorizationRoleSet } from '../../auth/authorization-role-types';
import { defineNotificationTables } from '../../notifications/notification.plugin';
import { defineRoomTables } from '../../rooms/room.plugin';
import { createReactiveDB } from '../../sync/reactive-db';
import type {
  Row,
  SyncAuthContext,
  SyncResourcePolicyAdapter,
  SyncResourceTableAccess,
} from '../../sync/types';
import { defineWorkflowTables } from '../../workflows/workflow-schema';
import { PlatformSyncPolicyService } from './platform-sync-policy';

const TENANT_A = 'tenant_sync_alpha';
const TENANT_B = 'tenant_sync_beta';

describe('built-in Sync authority', () => {
  test('uses live additive tenant roles and never promotes a platform admin', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineNotificationTables(db);
    defineRoomTables(db);
    defineWorkflowTables(db);
    const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'advanced',
        roles: {
          notification_manager: { permissions: ['notifications:manage'] },
          workflow_manager: { permissions: ['workflows:manage'] },
          reader: { permissions: [] },
          reporter: { permissions: [] },
        },
      },
    }));
    const roles = new Map<string, readonly string[]>([
      ['platform-admin-user', ['member']],
      ['manager-user', ['notification_manager', 'workflow_manager', 'reader', 'reporter']],
      ['owner-user', ['owner']],
      ['other-owner-user', ['owner']],
    ]);
    const assignments = roleResolver(roles);
    const policy = new PlatformSyncPolicyService({
      delegate: allowRequestedTables(),
      getDB: () => db,
      getAuthorizationKernel: () => kernel,
      getRoleAssignments: () => assignments,
      tenancyMode: 'multi',
    });

    insertNotification(db, 'reader-a', TENANT_A, 'role', 'reader');
    insertNotification(db, 'reporter-a', TENANT_A, 'role', 'reporter');
    insertNotification(db, 'member-a', TENANT_A, 'role', 'member');
    insertNotification(db, 'all-b', TENANT_B, 'all', null);
    insertWorkflow(db, 'owner-workflow-a', TENANT_A, 'owner-user');
    insertWorkflow(db, 'admin-workflow-a', TENANT_A, 'platform-admin-user');
    insertWorkflow(db, 'other-workflow-b', TENANT_B, 'other-owner-user');
    insertWorkflowInteraction(
      db,
      'owner-interaction-a',
      'owner-workflow-a',
      TENANT_A,
    );
    insertWorkflowInteraction(
      db,
      'admin-interaction-a',
      'admin-workflow-a',
      TENANT_A,
    );
    insertWorkflowInteraction(
      db,
      'other-interaction-b',
      'other-workflow-b',
      TENANT_B,
    );
    insertWorkflowStep(db, 'owner-step-a', 'owner-workflow-a', TENANT_A);
    insertWorkflowStep(db, 'other-step-b', 'other-workflow-b', TENANT_B);
    insertWorkflowEvent(db, 'owner-event-a', 'owner-workflow-a', TENANT_A);
    insertWorkflowEvent(db, 'other-event-b', 'other-workflow-b', TENANT_B);
    insertRoom(db, 'owner-room-a', TENANT_A, 'owner-user');

    const manager = await accessFor(policy, tenantContext(
      'manager-user',
      'user',
      TENANT_A,
      'member',
    ));
    const managerNotifications = manager.rowFilters.get('notifications')!;
    expect(managerNotifications.matches(db.get('notifications', 'reader-a')!)).toBeTrue();
    expect(managerNotifications.matches(db.get('notifications', 'reporter-a')!)).toBeTrue();
    // Advanced mode uses assignment rows, not the membership.role_key fallback.
    expect(managerNotifications.matches(db.get('notifications', 'member-a')!)).toBeFalse();
    expect(managerNotifications.matches(db.get('notifications', 'all-b')!)).toBeFalse();

    const managerWorkflows = manager.rowFilters.get('workflow_instances')!;
    expect(managerWorkflows.matches(db.get('workflow_instances', 'owner-workflow-a')!))
      .toBeTrue();
    expect(managerWorkflows.matches(db.get('workflow_instances', 'admin-workflow-a')!))
      .toBeTrue();
    expect(managerWorkflows.matches(db.get('workflow_instances', 'other-workflow-b')!))
      .toBeFalse();
    const managerInteractions = manager.rowFilters.get('workflow_interactions')!;
    expect(managerInteractions.matches(
      db.get('workflow_interactions', 'owner-interaction-a')!,
    )).toBeTrue();
    expect(managerInteractions.matches(
      db.get('workflow_interactions', 'admin-interaction-a')!,
    )).toBeTrue();
    expect(managerInteractions.matches(
      db.get('workflow_interactions', 'other-interaction-b')!,
    )).toBeFalse();
    for (const [table, inScopeId, peerScopeId] of [
      ['workflow_steps', 'owner-step-a', 'other-step-b'],
      ['workflow_events', 'owner-event-a', 'other-event-b'],
    ] as const) {
      const filter = manager.rowFilters.get(table)!;
      expect(filter.matches(db.get(table, inScopeId)!)).toBeTrue();
      expect(filter.matches(db.get(table, peerScopeId)!)).toBeFalse();
    }
    for (const [table, rowId] of [
      ['workflow_steps', 'owner-step-a'],
      ['workflow_events', 'owner-event-a'],
      ['workflow_interactions', 'owner-interaction-a'],
    ] as const) {
      const filter = manager.rowFilters.get(table)!;
      const row = db.get(table, rowId)!;
      expect(filter.matches({ ...row, instance_id: 'missing-parent' })).toBeFalse();
      expect(filter.matches({
        ...row,
        tenant_id: TENANT_A,
        instance_id: 'other-workflow-b',
      })).toBeFalse();
    }

    const platformAdmin = await accessFor(policy, tenantContext(
      'platform-admin-user',
      'admin',
      TENANT_A,
      'member',
    ));
    const adminWorkflows = platformAdmin.rowFilters.get('workflow_instances')!;
    expect(adminWorkflows.matches(db.get('workflow_instances', 'owner-workflow-a')!))
      .toBeFalse();
    expect(adminWorkflows.matches(db.get('workflow_instances', 'admin-workflow-a')!))
      .toBeTrue();
    const adminInteractions = platformAdmin.rowFilters.get('workflow_interactions')!;
    expect(adminInteractions.matches(
      db.get('workflow_interactions', 'owner-interaction-a')!,
    )).toBeFalse();
    expect(adminInteractions.matches(
      db.get('workflow_interactions', 'admin-interaction-a')!,
    )).toBeTrue();
    expect(platformAdmin.rowFilters.get('rooms')!.matches(
      db.get('rooms', 'owner-room-a')!,
    )).toBeFalse();

    const owner = await accessFor(policy, tenantContext(
      'owner-user',
      'user',
      TENANT_A,
      'member',
    ));
    expect(owner.rowFilters.get('workflow_instances')!.matches(
      db.get('workflow_instances', 'admin-workflow-a')!,
    )).toBeTrue();

    const otherOwner = await accessFor(policy, tenantContext(
      'other-owner-user',
      'admin',
      TENANT_B,
      'member',
    ));
    expect(otherOwner.rowFilters.get('workflow_instances')!.matches(
      db.get('workflow_instances', 'owner-workflow-a')!,
    )).toBeFalse();
    expect(otherOwner.rowFilters.get('notifications')!.matches(
      db.get('notifications', 'reader-a')!,
    )).toBeFalse();

    db.dispose();
  });

  test('preserves legacy single-tenant platform-admin and role behavior', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineNotificationTables(db);
    defineWorkflowTables(db);
    insertNotification(db, 'admin-role', null, 'role', 'admin');
    insertWorkflow(db, 'peer-workflow', null, 'peer-user');
    insertWorkflowInteraction(db, 'peer-interaction', 'peer-workflow', null);
    const policy = new PlatformSyncPolicyService({
      delegate: allowRequestedTables(),
      getDB: () => db,
      tenancyMode: 'single',
    });
    const admin = await accessFor(policy, {
      userId: 'platform-admin',
      email: 'admin@example.test',
      role: 'admin',
    });
    expect(admin.rowFilters.get('notifications')!.matches(
      db.get('notifications', 'admin-role')!,
    )).toBeTrue();
    expect(admin.rowFilters.get('workflow_instances')!.matches(
      db.get('workflow_instances', 'peer-workflow')!,
    )).toBeTrue();
    expect(admin.rowFilters.get('workflow_interactions')!.matches(
      db.get('workflow_interactions', 'peer-interaction')!,
    )).toBeTrue();
    db.dispose();
  });

  test('redacts graph execution internals from platform Sync projections', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineWorkflowTables(db);
    insertWorkflow(db, 'graph-workflow', null, 'workflow-owner');
    db.update('workflow_instances', 'graph-workflow', {
      steps_json: JSON.stringify([{ name: 'Public label', handler: 'private.handler' }]),
      graph_json: JSON.stringify({ nodes: [{ id: 'node-a', activity: 'private.activity' }] }),
      definition_version_id: 'private-version-id',
      definition_version: 3,
      graph_fingerprint: 'public-fingerprint',
      input: JSON.stringify({ secret: 'instance-input' }),
      output: JSON.stringify({ secret: 'instance-output' }),
      error: 'private instance error',
    });
    insertWorkflowStep(db, 'graph-step', 'graph-workflow', null);
    insertWorkflowEvent(db, 'graph-event', 'graph-workflow', null);
    insertWorkflowInteraction(db, 'graph-interaction', 'graph-workflow', null);

    const policy = new PlatformSyncPolicyService({
      delegate: allowRequestedTables(),
      getDB: () => db,
      tenancyMode: 'single',
    });
    const access = await accessFor(policy, {
      userId: 'workflow-owner',
      email: 'owner@example.test',
      role: 'user',
    });

    const projectedInstance = access.rowProjectors!.get('workflow_instances')!.project(
      db.get('workflow_instances', 'graph-workflow')!,
    );
    expect(projectedInstance).not.toHaveProperty('steps_json');
    expect(projectedInstance).not.toHaveProperty('graph_json');
    expect(projectedInstance).not.toHaveProperty('definition_version_id');
    expect(projectedInstance).toMatchObject({ input: null, output: null, error: null });

    const projectedStep = access.rowProjectors!.get('workflow_steps')!.project(
      db.get('workflow_steps', 'graph-step')!,
    );
    expect(projectedStep).not.toHaveProperty('wait_event');
    expect(projectedStep).toMatchObject({
      step_name: 'Private graph label',
      input: null,
      output: null,
      error: null,
    });

    const projectedEvent = access.rowProjectors!.get('workflow_events')!.project(
      db.get('workflow_events', 'graph-event')!,
    );
    expect(projectedEvent.payload).toBeNull();

    const projectedInteraction = access.rowProjectors!.get('workflow_interactions')!.project({
      ...db.get('workflow_interactions', 'graph-interaction')!,
      request_json: '{"secret":true}',
      future_private_field: 'never publish',
    });
    expect(projectedInteraction).not.toHaveProperty('request_json');
    expect(projectedInteraction).not.toHaveProperty('future_private_field');
    expect(projectedInteraction).toMatchObject({
      interaction_id: 'graph-interaction',
      instance_id: 'graph-workflow',
    });
    db.dispose();
  });

  test('fails configured advanced Sync closed when live assignments are unavailable', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineNotificationTables(db);
    const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'advanced',
        roles: { reader: { permissions: [] } },
      },
    }));
    insertNotification(db, 'reader-a', TENANT_A, 'role', 'reader');
    const policy = new PlatformSyncPolicyService({
      delegate: allowRequestedTables(),
      getDB: () => db,
      getAuthorizationKernel: () => kernel,
      // Deliberately omit getRoleAssignments: token compatibility metadata is
      // not a live advanced-role projection.
      tenancyMode: 'multi',
    });

    const result = await accessFor(policy, tenantContext(
      'reader-user',
      'admin',
      TENANT_A,
      'reader',
    ));
    expect(result.readableTables.has('notifications')).toBeFalse();
    expect(result.readableTables.has('rooms')).toBeFalse();
    expect(result.readableTables.has('workflow_instances')).toBeFalse();
    db.dispose();
  });

  test('fails multi-tenant framework tables closed without an app-local kernel', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    defineNotificationTables(db);
    insertNotification(db, 'broadcast-a', TENANT_A, 'all', null);
    const policy = new PlatformSyncPolicyService({
      delegate: allowRequestedTables(),
      getDB: () => db,
      tenancyMode: 'multi',
    });

    const result = await accessFor(policy, tenantContext(
      'member-user',
      'user',
      TENANT_A,
      'member',
    ));
    expect(result.readableTables.size).toBe(0);
    db.dispose();
  });
});

function allowRequestedTables(): SyncResourcePolicyAdapter {
  return {
    async resolveTableAccess(context) {
      return {
        readableTables: new Set(context.tableNames),
        rowFilters: new Map(),
        policyFingerprint: 'allow-requested-test-tables',
      };
    },
    async authorizeMutation() {
      return { ok: false, code: 'READ_ONLY', reason: 'read-only test policy' };
    },
  };
}

function roleResolver(
  assignments: ReadonlyMap<string, readonly string[]>,
): AuthorizationRoleAssignmentResolver {
  return {
    resolveApplicationRoles() { return null; },
    resolveTenantRoles(input): AuthorizationRoleSet {
      return Object.freeze({
        scopeKind: 'tenant',
        scopeId: input.tenantId,
        tenantId: input.tenantId,
        membershipId: input.membershipId,
        userId: input.userId,
        roles: Object.freeze([...(assignments.get(input.userId) ?? [])]),
        revision: `roles:${input.userId}`,
      });
    },
  };
}

async function accessFor(
  policy: PlatformSyncPolicyService,
  authContext: SyncAuthContext,
): Promise<SyncResourceTableAccess> {
  return policy.resolveTableAccess({
    tableNames: [
      'notifications',
      'rooms',
      'workflow_instances',
      'workflow_steps',
      'workflow_events',
      'workflow_interactions',
    ],
    authContext,
  });
}

function tenantContext(
  userId: string,
  platformRole: string,
  tenantId: string,
  tenantRole: string,
): SyncAuthContext {
  return {
    userId,
    email: `${userId}@example.test`,
    role: platformRole,
    sessionKind: 'web',
    sessionId: `session-${userId}-${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `membership-${userId}-${tenantId}`,
    tenantRole,
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
    authorizationAssignmentRevision: `roles:${userId}`,
  };
}

function insertNotification(
  db: ReturnType<typeof createReactiveDB>,
  id: string,
  tenantId: string | null,
  targetType: 'all' | 'role',
  targetValue: string | null,
): void {
  db.insert('notifications', {
    notification_id: id,
    tenant_id: tenantId,
    type: 'info',
    priority: 'normal',
    title: id,
    body: null,
    target_type: targetType,
    target_value: targetValue,
    sender_id: null,
    action_url: null,
    metadata: null,
    created_at: Date.now(),
    expires_at: null,
  } as Row);
}

function insertWorkflow(
  db: ReturnType<typeof createReactiveDB>,
  id: string,
  tenantId: string | null,
  startedBy: string,
): void {
  db.insert('workflow_instances', {
    instance_id: id,
    tenant_id: tenantId,
    definition_id: 'definition-authority-test',
    name: 'authority-test',
    status: 'running',
    input: '{}',
    output: null,
    error: null,
    current_step: 0,
    started_by: startedBy,
    steps_json: '[]',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
  } as Row);
}

function insertWorkflowInteraction(
  db: ReturnType<typeof createReactiveDB>,
  id: string,
  instanceId: string,
  tenantId: string | null,
): void {
  const now = new Date().toISOString();
  db.insert('workflow_interactions', {
    interaction_id: id,
    tenant_id: tenantId,
    instance_id: instanceId,
    node_id: `node-${id}`,
    step_id: `step-${id}`,
    safe_label: 'Approval required',
    status: 'open',
    opened_at: now,
    expires_at: null,
    accepted_at: null,
    accepted_by: null,
    rejection_count: 0,
    max_rejections: 3,
    created_at: now,
    updated_at: now,
  } as Row);
}

function insertWorkflowStep(
  db: ReturnType<typeof createReactiveDB>,
  id: string,
  instanceId: string,
  tenantId: string | null,
): void {
  const now = new Date().toISOString();
  db.insert('workflow_steps', {
    step_id: id,
    tenant_id: tenantId,
    instance_id: instanceId,
    step_index: 0,
    step_name: 'Private graph label',
    status: 'running',
    input: JSON.stringify({ secret: 'step-input' }),
    output: JSON.stringify({ secret: 'step-output' }),
    error: 'private step error',
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: 'private-event-name',
    timeout_at: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    node_id: 'node-a',
    node_kind: 'task',
    node_path: '$.nodes[0]',
    parent_step_id: null,
    branch_key: null,
    item_key: null,
    item_index: null,
    activation_key: '',
    updated_at: now,
  } as Row);
}

function insertWorkflowEvent(
  db: ReturnType<typeof createReactiveDB>,
  id: string,
  instanceId: string,
  tenantId: string | null,
): void {
  db.insert('workflow_events', {
    event_id: id,
    tenant_id: tenantId,
    instance_id: instanceId,
    event_name: 'private-event-name',
    payload: JSON.stringify({ secret: 'event-payload' }),
    sent_by: 'workflow-owner',
    created_at: new Date().toISOString(),
  } as Row);
}

function insertRoom(
  db: ReturnType<typeof createReactiveDB>,
  id: string,
  tenantId: string,
  createdBy: string,
): void {
  db.insert('rooms', {
    room_id: id,
    tenant_id: tenantId,
    name: id,
    type: 'default',
    created_by: createdBy,
    metadata: null,
    max_members: 100,
    created_at: Date.now(),
  } as Row);
}
