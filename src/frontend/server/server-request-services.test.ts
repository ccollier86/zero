import { describe, expect, test } from 'bun:test';

import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import type { TokenService } from '../../auth/token-service';
import type { AuthRequestCredentialResolver } from '../../auth/auth-api-key-types';
import type { AuthContext, AuthContextAuthorityReference } from '../../auth/types';
import type { UserStore } from '../../auth/user-store';
import { NotificationService } from '../../notifications/notification-service';
import { defineNotificationTables } from '../../notifications/notification.plugin';
import { RoomService } from '../../rooms/room-service';
import { defineRoomTables } from '../../rooms/room.plugin';
import { createReactiveDB } from '../../sync/reactive-db';
import { trustedSystemServiceDataScope } from '../../auth/service-data-scope';
import {
  StorageService,
  defineStorageTables,
} from '../../storage/storage-service';
import type { StorageAdapter } from '../../storage/types';
import { WorkflowService } from '../../workflows/workflow-service';
import { WorkflowRegistry } from '../../workflows/workflow-registry';
import { AuthWorkflowExecutionAuthorityProvider } from '../../workflows/auth-workflow-execution-authority';
import { WorkflowExecutionAuthorityStore } from '../../workflows/workflow-execution-authority';
import { defineWorkflowTables } from '../../workflows/workflow.plugin';
import { OBS_CODES } from '../../observability/codes';
import {
  createAuthorityScopedServerServices,
  createServerRequestServices,
} from './server-request-services';
import {
  createWorkflowExecutionServiceProvider,
  type WorkflowExecutionServerServices,
} from './workflow-execution-services';
import type { ServerRouteServices } from './server-services';
import type { DatabaseManager } from '../../databases/database-manager';

describe('request-bound server services', () => {
  test('types graph activity input and managed services without privileged workflows', () => {
    const registry = new WorkflowRegistry();
    const activity = registry.registerActivity<
      { instanceId: string },
      WorkflowExecutionServerServices
    >({
      name: 'typed-managed-activity',
      handler: async ({ input, zero }) => zero?.workflows?.get(input.instanceId) ?? null,
    });

    expect(activity.name).toBe('typed-managed-activity');
  });

  test('scopes storage to the live tenant and keeps raw access explicit', () => {
    const fixture = createFixture();
    try {
      const alpha = fixture.forToken('alpha');
      const beta = fixture.forToken('beta');
      const driveA = alpha.storage!.createDrive({ name: 'Alpha' });
      const driveB = beta.storage!.createDrive({ name: 'Beta' });

      expect(driveA.tenant_id).toBe(TENANT_A);
      expect(driveB.tenant_id).toBe(TENANT_B);
      expect(alpha.storage!.getDrive(driveB.drive_id)).toBeNull();
      expect(beta.storage!.getDrive(driveA.drive_id)).toBeNull();
      expect(alpha.storage!.listDrives().map((drive) => drive.drive_id)).toEqual([
        driveA.drive_id,
      ]);
      expect(() => beta.storage!.updateDrive(driveA.drive_id, { name: 'stolen' }))
        .toThrow('Drive not found');

      expect(alpha.unsafe.storage).toBe(fixture.storage);
      expect(alpha.unsafe.storage!.getDrive(driveB.drive_id)).toEqual(driveB);
    } finally {
      fixture.db.dispose();
    }
  });

  test('snapshots verified machine properties when creating scoped services', () => {
    const fixture = createFixture();
    try {
      const context = fixture.contexts.get('alpha')!;
      const access = createRequestAuthorizationAccess({
        authContext: context,
        kernel: fixture.kernel,
        propertyStore: fixture.store,
      });
      const scope = trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: TENANT_A,
      });
      const drive = fixture.storage.createDrive(
        'peer-owner',
        { name: 'Property-bound drive' },
        scope,
      );
      fixture.storage.grantPermission(drive.drive_id, {
        grantType: 'property',
        grantKey: 'department',
        grantValue: 'finance',
        permission: 'read',
      });
      const properties: Record<string, string> = { department: 'finance' };
      const zero = createAuthorityScopedServerServices({
        access,
        scope,
        services: fixture.services,
        userProperties: properties,
        assertCurrentAuthority: async () => {},
        assertCurrentAuthoritySync: () => {},
      });

      properties.department = 'engineering';

      expect(zero.storage!.getDrive(drive.drive_id)).toEqual(drive);
    } finally {
      fixture.db.dispose();
    }
  });

  test('requires destination write authority before scoped storage copy or move', async () => {
    const fixture = createFixture();
    try {
      const scope = trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: TENANT_A,
      });
      const drive = fixture.storage.createDrive(
        'peer-owner',
        { name: 'Peer files' },
        scope,
      );
      await fixture.storage.upload(
        drive.drive_id,
        '/source.txt',
        new Uint8Array([1, 2, 3]),
        'source.txt',
        'peer-owner',
        undefined,
        scope,
      );
      fixture.storage.grantPermission(drive.drive_id, {
        objectPath: '/source.txt',
        grantType: 'user',
        grantValue: USER_ID,
        permission: 'write',
      });

      const alpha = fixture.forToken('alpha');
      await expect(alpha.storage!.copyObject(
        drive.drive_id,
        '/source.txt',
        '/unauthorized-copy.txt',
      )).rejects.toThrow('Forbidden');
      await expect(alpha.storage!.moveObject(
        drive.drive_id,
        '/source.txt',
        '/unauthorized-move.txt',
      )).rejects.toThrow('Forbidden');
      expect(fixture.storage.getFileInfo(
        drive.drive_id,
        '/unauthorized-copy.txt',
      )).toBeNull();
      expect(fixture.storage.getFileInfo(
        drive.drive_id,
        '/unauthorized-move.txt',
      )).toBeNull();
      expect(fixture.storage.getFileInfo(drive.drive_id, '/source.txt')).not.toBeNull();

      fixture.storage.grantPermission(drive.drive_id, {
        grantType: 'user',
        grantValue: USER_ID,
        permission: 'write',
      });
      await expect(alpha.storage!.copyObject(
        drive.drive_id,
        '/source.txt',
        '/authorized-copy.txt',
      )).resolves.toMatchObject({ path: '/authorized-copy.txt' });
      await expect(alpha.storage!.moveObject(
        drive.drive_id,
        '/source.txt',
        '/authorized-move.txt',
      )).resolves.toMatchObject({ path: '/authorized-move.txt' });
    } finally {
      fixture.db.dispose();
    }
  });

  test('keeps Storage ownership usable with an empty advanced-role set', () => {
    const fixture = createFixture();
    try {
      const context = tenantContext(TENANT_A, 'mem_roleless', 0, {
        userId: 'roleless-owner',
        platformRole: 'admin',
        tenantRole: 'member',
      });
      fixture.contexts.set('roleless', context);
      const advancedKernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
        tenancy: 'multi',
        authorization: { mode: 'advanced' },
      }));
      const access = createRequestAuthorizationAccess({
        authContext: context,
        kernel: advancedKernel,
        propertyStore: fixture.store,
        roleAssignments: {
          resolveApplicationRoles() { return null; },
          resolveTenantRoles(input) {
            return {
              scopeKind: 'tenant' as const,
              scopeId: input.tenantId,
              tenantId: input.tenantId,
              membershipId: input.membershipId,
              userId: input.userId,
              roles: [],
              revision: 'roleless-owner:0',
            };
          },
        },
      });
      const scope = trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: TENANT_A,
      });
      const owned = fixture.storage.createDrive(
        context.userId,
        { name: 'Owned without an assigned role' },
        scope,
      );
      const peer = fixture.storage.createDrive(
        'peer-user',
        { name: 'Peer private drive' },
        scope,
      );
      const zero = createServerRequestServices({
        request: new Request('http://zero.test/api', {
          headers: { Authorization: 'Bearer roleless' },
        }),
        access,
        services: fixture.services,
      });

      expect(zero.storage!.getDrive(owned.drive_id)).toEqual(owned);
      expect(zero.storage!.listDrives().map((drive) => drive.drive_id)).toEqual([
        owned.drive_id,
      ]);
      // Even global platform-admin metadata is not tenant Storage authority.
      expect(zero.storage!.getDrive(peer.drive_id)).toBeNull();
    } finally {
      fixture.db.dispose();
    }
  });

  test('does not project tenant-owned services for an identity-only selection session', () => {
    const fixture = createFixture();
    try {
      fixture.contexts.set('selection', selectionContext());
      const selection = fixture.forToken('selection');

      expect(selection.scope).toBeNull();
      expect(selection.storage).toBeNull();
      expect(selection.unsafe.storage).toBe(fixture.storage);
    } finally {
      fixture.db.dispose();
    }
  });

  test('makes unscoped multi-tenant capabilities explicitly unsafe', () => {
    const fixture = createFixture();
    try {
      const alpha = fixture.forToken('alpha');

      expect(() => alpha.db).toThrow('zero.unsafe.db');
      expect(() => alpha.databases).toThrow('zero.unsafe.databases');
      expect(() => alpha.sql).toThrow('zero.unsafe.sql');
      expect(() => alpha.kv).toThrow('zero.unsafe.kv');
      expect(() => alpha.vector).toThrow('zero.unsafe.vector');
      expect(() => alpha.scheduler).toThrow('zero.unsafe.scheduler');
      expect(() => alpha.auth.store).toThrow('zero.unsafe.auth.store');
      expect(() => alpha.auth.tokens).toThrow('zero.unsafe.auth.tokens');
      expect(() => alpha.observability.store)
        .toThrow('zero.unsafe.observability.store');

      expect(alpha.auth.authorizationKernel).toBe(fixture.kernel);
      expect(alpha.unsafe.db).toBe(fixture.db);
      expect(alpha.unsafe.databases).toBe(fixture.databases);
      expect(alpha.unsafe.auth.store).toBe(fixture.store);

      alpha.observability.emitEvent({
        level: 'info',
        category: 'test',
        code: 'test.request_scope',
        message: 'scoped',
        userId: 'spoofed',
        metadata: { custom: true, zeroTenantId: 'spoofed' },
      });
      expect(fixture.observabilityEvents.at(-1)).toMatchObject({
        userId: USER_ID,
        metadata: {
          custom: true,
          zeroScopeKind: 'tenant',
          zeroTenantId: TENANT_A,
          zeroMembershipId: 'mem_a',
        },
      });
    } finally {
      fixture.db.dispose();
    }
  });

  test('retains the historical raw request surface in single-tenant mode', () => {
    const fixture = createFixture(memoryStorageAdapter(), 'single');
    try {
      const requestServices = fixture.forToken('alpha');
      expect(requestServices.db).toBe(fixture.db);
      expect(requestServices.syncDB).toBe(fixture.db);
      expect(requestServices.databases).toBe(fixture.databases);
      expect(requestServices.auth.store).toBe(fixture.store);
      expect(requestServices.auth.tokens).toBeTruthy();
      expect(requestServices.scope).toMatchObject({ scopeKind: 'application' });
    } finally {
      fixture.db.dispose();
    }
  });

  test('binds notifications, rooms, and workflows to the same tenant boundary', async () => {
    const fixture = createFixture();
    try {
      const alpha = fixture.forToken('alpha');
      const beta = fixture.forToken('beta');
      const notificationA = alpha.notifications!.create({
        title: 'Alpha notice',
      });
      const notificationB = beta.notifications!.create({
        title: 'Beta notice',
      });
      const roomA = alpha.rooms!.create({ name: 'Alpha room' });
      const roomB = beta.rooms!.create({ name: 'Beta room' });
      const workflowA = await alpha.workflows!.run('proof', {}, USER_ID);
      const workflowB = await beta.workflows!.run('proof', {}, USER_ID);

      expect(alpha.notifications!.get(notificationB.notification_id)).toBeNull();
      expect(beta.notifications!.get(notificationA.notification_id)).toBeNull();
      expect(alpha.rooms!.getRoom(roomB.room_id)).toBeNull();
      expect(beta.rooms!.getRoom(roomA.room_id)).toBeNull();
      expect(alpha.workflows!.get(workflowB)).toBeNull();
      expect(beta.workflows!.get(workflowA)).toBeNull();
      // Deliberately bypass the compile-time facade to verify its runtime traps.
      const rawSignatureWorkflow = alpha.workflows as unknown as WorkflowService;
      await expect(rawSignatureWorkflow.run(
        'proof',
        {},
        USER_ID,
        trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: TENANT_B }),
      )).rejects.toMatchObject({ code: 'WORKFLOW_REQUEST_INVALID' });
      const deniedNotifications = alpha.notifications as unknown as {
        deleteExpired(): number;
      };
      expect(() => deniedNotifications.deleteExpired()).toThrow('not available');
      const deniedWorkflow = alpha.workflows as unknown as {
        getGraphRuntime(): unknown;
        dispose(): Promise<void>;
        pollTimeouts(): number;
      };
      expect(() => deniedWorkflow.getGraphRuntime()).toThrow('not available');
      expect(() => deniedWorkflow.dispose()).toThrow('not available');
      expect(() => deniedWorkflow.pollTimeouts()).toThrow('not available');
      expect(() => (alpha.workflows as unknown as WorkflowService).startAsSystemOnce(
        'proof', {}, {
          principal: 'attempted-request-bypass', reason: 'Synthetic forbidden system start',
          scope: alpha.scope!, idempotencyKey: 'forbidden',
        },
      )).toThrow('not available');
    } finally {
      fixture.db.dispose();
    }
  });

  test('seals scoped workflow events with the exact request actor authority', async () => {
    const fixture = createFixture();
    try {
      const alpha = fixture.forToken('alpha');
      const instanceId = await alpha.workflows!.run('waiting-proof', {}, USER_ID);
      await expect(alpha.workflows!.sendEvent(
        instanceId,
        'proof.ready',
        { accepted: true },
        USER_ID,
      )).resolves.toBe(true);

      expect(fixture.workflows.getInstance(instanceId, alpha.scope!)).toMatchObject({
        status: 'completed',
      });
      const sealed = fixture.db.prepare(`SELECT authority.authority_json, delivery.actor_json
        FROM _workflow_event_authorities AS authority
        INNER JOIN _workflow_event_delivery AS delivery
          ON delivery.event_id = authority.event_id
        WHERE delivery.instance_id = ? LIMIT 1`).get(instanceId) as {
          authority_json: string;
          actor_json: string;
        };
      expect(sealed.authority_json).toContain(`"userId":"${USER_ID}"`);
      expect(sealed.actor_json).toContain(`"actorId":"${USER_ID}"`);
      expect(JSON.parse(sealed.authority_json)).not.toHaveProperty('accessToken');
      expect(JSON.parse(sealed.authority_json)).not.toHaveProperty('refreshToken');
    } finally {
      await fixture.workflows.dispose();
      fixture.db.dispose();
    }
  });

  test('does not treat a global admin as a tenant workflow administrator', async () => {
    const fixture = createFixture();
    try {
      const owner = fixture.forToken('alpha');
      const platformAdmin = fixture.forToken('tenant-platform-admin');
      const workflowManager = fixture.forToken('tenant-workflow-manager');
      const instanceId = await owner.workflows!.run('proof', {}, USER_ID);

      expect(platformAdmin.workflows!.get(instanceId)).toBeNull();
      expect(platformAdmin.workflows!.list()).toEqual([]);
      expect(workflowManager.workflows!.get(instanceId)).toMatchObject({
        instance_id: instanceId,
        tenant_id: TENANT_A,
      });
      expect(workflowManager.workflows!.list().map((row) => row.instance_id))
        .toContain(instanceId);
    } finally {
      fixture.db.dispose();
    }
  });

  test('does not hide workflow storage failures as missing instances', async () => {
    const fixture = createFixture();
    try {
      const alpha = fixture.forToken('alpha');
      const storageFailure = new Error('workflow storage unavailable');
      const getInstance = fixture.workflows.getInstance;
      fixture.workflows.getInstance = () => {
        throw storageFailure;
      };

      expect(() => alpha.workflows!.getInstance('wf_failure')).toThrow(storageFailure);
      expect(() => alpha.workflows!.get('wf_failure')).toThrow(storageFailure);

      fixture.workflows.getInstance = getInstance;
    } finally {
      fixture.db.dispose();
    }
  });

  test('does not hide room storage failures as missing rooms', () => {
    const fixture = createFixture();
    try {
      const alpha = fixture.forToken('alpha');
      const storageFailure = new Error('room storage unavailable');
      const getRoom = fixture.rooms.getRoom;
      fixture.rooms.getRoom = () => {
        throw storageFailure;
      };

      expect(() => alpha.rooms!.getRoom('room_failure')).toThrow(storageFailure);

      fixture.rooms.getRoom = getRoom;
    } finally {
      fixture.db.dispose();
    }
  });

  test('keeps notification and room management identical to the HTTP tenant policy', () => {
    const fixture = createFixture();
    try {
      const owner = fixture.forToken('alpha');
      const platformAdmin = fixture.forToken('tenant-platform-admin');
      const notificationManager = fixture.forToken('tenant-notification-manager');
      const roomManager = fixture.forToken('tenant-room-manager');
      const notification = owner.notifications!.broadcast(
        { title: 'Owner notice' },
      );
      const room = owner.rooms!.create({ name: 'Owner room' });

      expect(() => platformAdmin.notifications!.broadcast(
        { title: 'Platform-only privilege' },
      )).toThrow('Notification management is not permitted');
      expect(() => platformAdmin.notifications!.delete(notification.notification_id))
        .toThrow('Notification management is not permitted');
      expect(() => platformAdmin.rooms!.delete(room.room_id))
        .toThrow('Room not found');

      const managed = notificationManager.notifications!.broadcast(
        { title: 'Explicit manager' },
      );
      expect(managed.tenant_id).toBe(TENANT_A);
      expect(notificationManager.notifications!.delete(notification.notification_id))
        .toBeTrue();
      expect(roomManager.rooms!.delete(room.room_id)).toBeTrue();
    } finally {
      fixture.db.dispose();
    }
  });

  test('revalidates authority after a streamed upload and commits no metadata when it changed', async () => {
    const gate = deferred<void>();
    const fixture = createFixture(gatedStorageAdapter(gate.promise));
    try {
      const alpha = fixture.forToken('alpha');
      const drive = alpha.storage!.createDrive({ name: 'Alpha' });
      const upload = alpha.storage!.upload(
        drive.drive_id,
        '/report.txt',
        new Uint8Array([104, 105]),
        'report.txt',
      );

      await waitFor(() => fixture.adapterStarted.value);
      fixture.contexts.set('alpha', tenantContext(TENANT_A, 'mem_a', 1));
      gate.resolve();

      await expect(upload).rejects.toMatchObject({ code: 'AUTH_STATE_CHANGED' });
      expect(fixture.storage.getFileInfo(drive.drive_id, '/report.txt')).toBeNull();
    } finally {
      fixture.db.dispose();
    }
  });

  test('revalidates API-key authority at a scoped service commit boundary', () => {
    const fixture = createFixture();
    try {
      let active = true;
      const context: AuthContext = {
        ...tenantContext(TENANT_A, 'mem_api_key'),
        sessionKind: undefined,
        sessionId: undefined,
        sessionGeneration: undefined,
        credentialKind: 'api-key',
        credentialId: 'key-commit-fence',
        authGeneration: 0,
      };
      const credentials: AuthRequestCredentialResolver = {
        async resolve() { return active ? context : null; },
        captureAuthority(current) {
          return current.credentialKind === 'api-key'
            ? {
                kind: 'api-key',
                version: 1,
                keyId: current.credentialId!,
                keyGeneration: 0,
                userId: current.userId,
                scopeKind: 'tenant',
                scopeId: TENANT_A,
              }
            : null;
        },
        resolveAuthority(reference) {
          return active && reference.kind === 'api-key'
            && reference.keyId === context.credentialId
            ? context
            : null;
        },
      };
      Object.assign(fixture.services.auth, {
        requestCredentialResolver: credentials,
        getRequestCredentialResolver: () => credentials,
      });
      const access = createRequestAuthorizationAccess({
        authContext: context,
        kernel: fixture.kernel,
        propertyStore: fixture.store,
      });
      access.authorize({
        user: 'required',
        tenant: 'required',
        credentials: ['api-key'],
      });
      const zero = createServerRequestServices({
        request: new Request('http://zero.test/api', {
          headers: { Authorization: 'Bearer zero_ak_v1.key-commit-fence.secret' },
        }),
        access,
        services: fixture.services,
      });

      active = false;

      expect(() => zero.storage!.createDrive({ name: 'stale' }))
        .toThrow(expect.objectContaining({
          code: 'AUTH_STATE_CHANGED',
          status: 409,
        }));
      expect(fixture.storage.listDrives()).toHaveLength(0);
    } finally {
      fixture.db.dispose();
    }
  });

  test('projects sealed workflow authority into tenant-safe services without a raw escape', () => {
    const fixture = createFixture();
    try {
      const alphaRequest = fixture.forToken('alpha');
      const betaRequest = fixture.forToken('beta');
      const driveA = alphaRequest.storage!.createDrive({ name: 'Alpha' });
      const driveB = betaRequest.storage!.createDrive({ name: 'Beta' });
      const grantPermission = fixture.storage.grantPermission.bind(fixture.storage);
      let aclAuditAuthority:
        Parameters<StorageService['grantPermission']>[2] = undefined;
      fixture.storage.grantPermission = (
        ...args: Parameters<StorageService['grantPermission']>
      ) => {
        aclAuditAuthority = args[2];
        return grantPermission(...args);
      };
      const authority = fixture.captureWorkflowAuthority('alpha');
      const provider = createWorkflowExecutionServiceProvider({
        services: fixture.services,
      });
      const zero = provider.createServices({
        authority: fixture.resolveWorkflowAuthority(authority),
        assertCurrentAuthority: () => fixture.assertWorkflowAuthority(authority),
      });
      const resolved = fixture.resolveWorkflowAuthority(authority);
      expect(() => provider.createServices({
        authority: { ...resolved, authContext: null },
        assertCurrentAuthority: () => fixture.assertWorkflowAuthority(authority),
      })).toThrow(expect.objectContaining({
        code: 'WORKFLOW_AUTHORITY_REQUIRED', status: 500,
      }));

      expect(zero.scope).toEqual(trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: TENANT_A,
      }));
      expect(zero.storage!.getDrive(driveA.drive_id)).toEqual(driveA);
      expect(zero.storage!.getDrive(driveB.drive_id)).toBeNull();
      expect(() => zero.storage!.updateDrive(driveB.drive_id, { name: 'stolen' }))
        .toThrow('Drive not found');
      zero.storage!.permissions.grant(driveA.drive_id, {
        grantType: 'role',
        grantValue: 'auditor',
        permission: 'read',
      });
      expect(aclAuditAuthority).toMatchObject({
        provenance: 'system',
        context: { userId: USER_ID, membershipId: 'mem_a' },
        scope: { scopeKind: 'tenant', tenantId: TENANT_A },
      });

      const notification = zero.notifications!.create({ title: 'Workflow' });
      expect(notification.tenant_id).toBe(TENANT_A);
      expect(zero.rooms!.create({ name: 'Workflow room' }).tenant_id)
        .toBe(TENANT_A);

      expect(() => (zero as any).unsafe).toThrow('zero.unsafe');
      expect(() => (zero as any).db).toThrow('zero.db');
      expect(() => (zero as any).databases).toThrow('zero.databases');
      expect(() => (zero as any).email).toThrow('zero.email');
      expect(() => (zero.auth as any).store).toThrow('zero.unsafe.auth.store');
      expect(Object.getOwnPropertyDescriptor(zero, 'db')).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(zero, 'databases')).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(zero.auth, 'store')).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(zero.storage!, 'db')).toBeUndefined();
      expect('db' in zero).toBeFalse();
      expect('databases' in zero).toBeFalse();
      expect('store' in zero.auth).toBeFalse();
    } finally {
      fixture.db.dispose();
    }
  });

  test('fences synchronous workflow mutations after authority is revoked', async () => {
    const fixture = createFixture();
    try {
      const authority = fixture.captureWorkflowAuthority('alpha');
      const zero = createWorkflowExecutionServiceProvider({
        services: fixture.services,
      }).createServices({
        authority: fixture.resolveWorkflowAuthority(authority),
        assertCurrentAuthority: () => fixture.assertWorkflowAuthority(authority),
      });
      const driveCount = fixture.storage.listDrives().length;
      const notificationCount = fixture.notifications.getForUser(
        USER_ID,
        ['owner'],
        trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: TENANT_A }),
      ).length;

      // A handler may await arbitrary app work before reaching a synchronous
      // mutation. The facade must fence at the call, not only at dispatch.
      await Promise.resolve();
      fixture.contexts.set('alpha', tenantContext(TENANT_A, 'mem_a', 1));

      expect(() => zero.storage!.createDrive({ name: 'stale' }))
        .toThrow('Workflow execution authority is no longer valid');
      expect(() => zero.notifications!.create({ title: 'stale' }))
        .toThrow('Workflow execution authority is no longer valid');
      expect(() => zero.rooms!.create({ name: 'stale' }))
        .toThrow('Workflow execution authority is no longer valid');
      expect(fixture.storage.listDrives()).toHaveLength(driveCount);
      expect(fixture.notifications.getForUser(
        USER_ID,
        ['owner'],
        trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: TENANT_A }),
      )).toHaveLength(notificationCount);
    } finally {
      fixture.db.dispose();
    }
  });

  test('fences every workflow observability emitter after authority is revoked', async () => {
    const fixture = createFixture();
    try {
      const authority = fixture.captureWorkflowAuthority('alpha');
      const zero = createWorkflowExecutionServiceProvider({
        services: fixture.services,
      }).createServices({
        authority: fixture.resolveWorkflowAuthority(authority),
        assertCurrentAuthority: () => fixture.assertWorkflowAuthority(authority),
      });
      const initialEventCount = fixture.observabilityEvents.length;
      const definition = OBS_CODES.WORKFLOW_NODE_COMPLETED;
      const emitters = [
        () => zero.observability.emitCode(definition),
        () => zero.observability.emitEvent({
          level: 'info',
          category: 'workflows',
          code: 'workflows.test',
          message: 'must not be emitted after revocation',
        }),
        () => zero.observability.error(definition),
        () => zero.observability.info(definition),
        () => zero.observability.warn(definition),
      ];

      // A handler may retain the facade across arbitrary awaits. Every sink
      // entry point must revalidate at the call rather than only at dispatch.
      await Promise.resolve();
      fixture.contexts.set('alpha', tenantContext(TENANT_A, 'mem_a', 1));

      for (const emit of emitters) {
        expect(emit).toThrow('Workflow execution authority is no longer valid');
      }
      expect(fixture.observabilityEvents).toHaveLength(initialEventCount);
    } finally {
      fixture.db.dispose();
    }
  });

  test('fences synchronous workflow service reads after authority is revoked', async () => {
    const fixture = createFixture();
    try {
      const authority = fixture.captureWorkflowAuthority('alpha');
      const zero = createWorkflowExecutionServiceProvider({
        services: fixture.services,
      }).createServices({
        authority: fixture.resolveWorkflowAuthority(authority),
        assertCurrentAuthority: () => fixture.assertWorkflowAuthority(authority),
      });
      const drive = zero.storage!.createDrive({ name: 'Private drive' });
      const notification = zero.notifications!.create({ title: 'Private notice' });
      const room = zero.rooms!.create({ name: 'Private room' });
      const workflow = await zero.workflows!.run('proof', {}, USER_ID);

      // Simulate an arbitrary await followed by session/membership revocation.
      await Promise.resolve();
      fixture.contexts.set('alpha', tenantContext(TENANT_A, 'mem_a', 1));

      const revoked = 'Workflow execution authority is no longer valid';
      expect(() => zero.storage!.getDrive(drive.drive_id)).toThrow(revoked);
      expect(() => zero.storage!.listDrives()).toThrow(revoked);
      expect(() => zero.storage!.getDriveUsage(drive.drive_id)).toThrow(revoked);
      expect(() => zero.notifications!.getById(notification.notification_id)).toThrow(revoked);
      expect(() => zero.notifications!.list()).toThrow(revoked);
      expect(() => zero.notifications!.getReceipts(notification.notification_id)).toThrow(revoked);
      expect(() => zero.rooms!.getRoom(room.room_id)).toThrow(revoked);
      expect(() => zero.rooms!.getMembers(room.room_id)).toThrow(revoked);
      expect(() => zero.rooms!.getRoomsForUser()).toThrow(revoked);
      expect(() => zero.workflows!.getInstance(workflow)).toThrow(revoked);
      expect(() => zero.workflows!.get(workflow)).toThrow(revoked);
      expect(() => zero.workflows!.getSteps(workflow)).toThrow(revoked);
      expect(() => zero.workflows!.getEvents(workflow)).toThrow(revoked);
      expect(() => zero.workflows!.getPublicTopology(workflow)).toThrow(revoked);
      expect(() => zero.workflows!.listInstances()).toThrow(revoked);
      expect(() => zero.workflows!.list()).toThrow(revoked);
    } finally {
      fixture.db.dispose();
    }
  });
});

const USER_ID = 'user_shared';
const TENANT_A = 'ten_alpha';
const TENANT_B = 'ten_beta';

function createFixture(
  adapter: StorageAdapter = memoryStorageAdapter(),
  tenancyMode: 'single' | 'multi' = 'multi',
) {
  const db = createReactiveDB({ mode: 'memory' });
  const databases = {
    fixture: true,
    diagnostics: () => ({ tenantDatabasesEnabled: false }),
  } as unknown as DatabaseManager;
  defineStorageTables(db);
  defineNotificationTables(db);
  defineRoomTables(db);
  defineWorkflowTables(db);
  const storage = new StorageService(db, adapter, {
    tenancyMode,
    isPolicyTrustedProperty: (key) => key === 'department',
  });
  const notifications = new NotificationService(db, tenancyMode);
  const rooms = new RoomService(db, tenancyMode);
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig(
    tenancyMode === 'multi'
      ? {
          tenancy: 'multi',
          authorization: {
            mode: 'simple',
            roles: {
              owner: { allPermissions: true },
              member: { permissions: [] },
              workflow_manager: { permissions: ['workflows:manage'] },
              notification_manager: { permissions: ['notifications:manage'] },
              room_manager: { permissions: ['rooms:manage'] },
            },
          },
        }
      : { tenancy: 'single' },
  ));
  const contexts = new Map<string, AuthContext>([
    ['alpha', tenancyMode === 'multi'
      ? tenantContext(TENANT_A, 'mem_a')
      : applicationContext()],
    ['beta', tenancyMode === 'multi'
      ? tenantContext(TENANT_B, 'mem_b')
      : applicationContext()],
    ['tenant-platform-admin', tenancyMode === 'multi'
      ? tenantContext(TENANT_A, 'mem_admin', 0, {
          userId: 'platform_admin',
          platformRole: 'admin',
          tenantRole: 'member',
        })
      : applicationContext()],
    ['tenant-workflow-manager', tenancyMode === 'multi'
      ? tenantContext(TENANT_A, 'mem_manager', 0, {
          userId: 'workflow_manager',
          tenantRole: 'workflow_manager',
        })
      : applicationContext()],
    ['tenant-notification-manager', tenancyMode === 'multi'
      ? tenantContext(TENANT_A, 'mem_notification_manager', 0, {
          userId: 'notification_manager',
          tenantRole: 'notification_manager',
        })
      : applicationContext()],
    ['tenant-room-manager', tenancyMode === 'multi'
      ? tenantContext(TENANT_A, 'mem_room_manager', 0, {
          userId: 'room_manager',
          tenantRole: 'room_manager',
        })
      : applicationContext()],
  ]);
  const tokenService = {
    async resolveAuthContext(token: string) {
      return contexts.get(token) ?? null;
    },
    captureAuthContextAuthority(context: AuthContext) {
      return authorityReference(context);
    },
    resolveAuthContextAuthority(reference: AuthContextAuthorityReference) {
      const current = [...contexts.values()].find(
        (context) => context.sessionId === reference.sessionId,
      );
      return current && authorityReferenceMatches(current, reference)
        ? current
        : null;
    },
  } as TokenService;
  const store = {
    getProperties: () => ({}),
  } as unknown as UserStore;
  const workflowRegistry = new WorkflowRegistry();
  workflowRegistry.registerHandler('proof', async () => ({ ok: true }));
  workflowRegistry.registerHandler('waiting-proof', async ({ waitEvent }) => waitEvent?.payload);
  workflowRegistry.registerWorkflow({
    name: 'proof',
    steps: [{ name: 'Proof', handler: 'proof' }],
  });
  workflowRegistry.registerWorkflow({
    name: 'waiting-proof',
    steps: [{ name: 'Wait for proof', handler: 'waiting-proof', waitFor: 'proof.ready' }],
  });
  const workflowAuthorityStore = new WorkflowExecutionAuthorityStore(db);
  const workflowAuthorityProvider = new AuthWorkflowExecutionAuthorityProvider({
    tokens: tokenService,
    kernel,
    properties: store,
    authorityStore: workflowAuthorityStore,
  });
  const workflows = new WorkflowService(db, workflowRegistry, tenancyMode, {
    authorityStore: workflowAuthorityStore,
    authorityProvider: workflowAuthorityProvider,
  });
  const observabilityEvents: Array<Record<string, unknown>> = [];
  const emit = (input: Record<string, unknown>) => {
    observabilityEvents.push(input);
    return input;
  };
  const observability = {
    runtime: {},
    sink: {},
    store: {},
    getRuntime: () => ({}),
    getSink: () => ({}),
    getStore: () => ({}),
    emitCode: (_definition: unknown, options: Record<string, unknown> = {}) => emit(options),
    emitEvent: (input: Record<string, unknown>) => emit(input),
    error: (_definition: unknown, options: Record<string, unknown> = {}) => emit(options),
    info: (_definition: unknown, options: Record<string, unknown> = {}) => emit(options),
    warn: (_definition: unknown, options: Record<string, unknown> = {}) => emit(options),
  };
  const services = {
    db,
    syncDB: db,
    databases,
    auth: {
      authorization: kernel,
      authorizationKernel: kernel,
      roles: null,
      roleService: null,
      store,
      userStore: store,
      tokens: tokenService,
      tokenService,
    },
    storage,
    notifications,
    rooms,
    workflows,
    pdf: null,
    observability,
  } as unknown as ServerRouteServices;
  const adapterStarted = (adapter as StorageAdapter & {
    started?: { value: boolean };
  }).started ?? { value: false };

  return {
    adapterStarted,
    contexts,
    db,
    databases,
    kernel,
    notifications,
    observabilityEvents,
    rooms,
    storage,
    store,
    workflows,
    services,
    captureWorkflowAuthority(token: string) {
      const context = contexts.get(token);
      if (!context) throw new Error(`Unknown test token: ${token}`);
      const authority = workflowAuthorityProvider.captureActor(context);
      if (!authority) throw new Error('Could not capture workflow authority');
      return authority;
    },
    resolveWorkflowAuthority(
      authority: NonNullable<ReturnType<typeof workflowAuthorityProvider.captureActor>>,
    ) {
      const resolved = workflowAuthorityProvider.revalidateActor(authority);
      if (!resolved) throw new Error('Could not resolve workflow authority');
      return resolved;
    },
    assertWorkflowAuthority(
      authority: NonNullable<ReturnType<typeof workflowAuthorityProvider.captureActor>>,
    ) {
      if (!workflowAuthorityProvider.revalidateActor(authority)) {
        throw new Error('Workflow execution authority is no longer valid');
      }
    },
    forToken(token: string) {
      const context = contexts.get(token) ?? null;
      const access = createRequestAuthorizationAccess({
        authContext: context,
        kernel,
        propertyStore: store,
      });
      return createServerRequestServices({
        request: new Request('http://zero.test/api', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        access,
        services,
      });
    },
  };
}

function tenantContext(
  tenantId: string,
  membershipId: string,
  membershipGeneration = 0,
  options: {
    userId?: string;
    platformRole?: string;
    tenantRole?: string;
  } = {},
): AuthContext {
  return {
    userId: options.userId ?? USER_ID,
    email: 'shared@example.test',
    role: options.platformRole ?? 'user',
    sessionKind: 'web',
    sessionId: `ses_${tenantId}_${options.userId ?? USER_ID}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId,
    tenantRole: options.tenantRole ?? 'owner',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: membershipGeneration,
  };
}

function selectionContext(): AuthContext {
  return {
    userId: USER_ID,
    email: 'shared@example.test',
    role: 'user',
    sessionKind: 'web',
    sessionId: 'ses_selection',
    sessionGeneration: 0,
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
  };
}

function applicationContext(): AuthContext {
  return {
    userId: USER_ID,
    email: 'shared@example.test',
    role: 'user',
    sessionKind: 'web',
    sessionId: 'ses_application',
    sessionGeneration: 0,
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
  };
}

function authorityReference(context: AuthContext): AuthContextAuthorityReference | null {
  if (!context.sessionKind
    || !context.sessionId
    || !context.sessionScopeKind
    || !context.sessionScopeId) return null;
  return Object.freeze({
    version: 1,
    userId: context.userId,
    platformRole: context.role,
    authGeneration: 0,
    sessionKind: context.sessionKind,
    sessionId: context.sessionId,
    mfaVerifiedAt: context.mfaVerifiedAt ?? null,
    sessionGeneration: context.sessionGeneration ?? null,
    clientId: context.clientId ?? null,
    identityScopes: Object.freeze([...(context.scope ?? [])]),
    sessionScopeKind: context.sessionScopeKind,
    sessionScopeId: context.sessionScopeId,
    tenantId: context.tenantId ?? null,
    tenantKind: context.tenantKind ?? null,
    membershipId: context.membershipId ?? null,
    tenantRole: context.tenantRole ?? null,
    tenantAuthorizationGeneration: context.tenantAuthorizationGeneration ?? null,
    membershipAuthorizationGeneration:
      context.membershipAuthorizationGeneration ?? null,
    authorizationAssignmentRevision:
      context.authorizationAssignmentRevision ?? null,
  });
}

function authorityReferenceMatches(
  context: AuthContext,
  reference: AuthContextAuthorityReference,
): boolean {
  const current = authorityReference(context);
  return current !== null
    && JSON.stringify(current) === JSON.stringify(reference);
}

function memoryStorageAdapter(): StorageAdapter {
  let exists = false;
  return {
    writeShutdownSafety: 'cooperative',
    async writeBlob(data) {
      const bytes = data instanceof Uint8Array
        ? data
        : data instanceof Blob
          ? new Uint8Array(await data.arrayBuffer())
          : new Uint8Array(await new Response(data).arrayBuffer());
      exists = true;
      return { checksum: 'sha256:test', size: bytes.byteLength, headBytes: bytes };
    },
    async readBlob() { return null; },
    async readBlobRange() { return null; },
    async removeBlob() { exists = false; },
    removeBlobSync() { exists = false; },
    async blobExists() { return exists; },
    async blobSize() { return 0; },
  };
}

function gatedStorageAdapter(gate: Promise<void>): StorageAdapter & {
  started: { value: boolean };
} {
  const base = memoryStorageAdapter();
  const started = { value: false };
  return {
    ...base,
    started,
    async writeBlob(data, maxSize) {
      started.value = true;
      await gate;
      return base.writeBlob(data, maxSize);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for asynchronous test state');
}
