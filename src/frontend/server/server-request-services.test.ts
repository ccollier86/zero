import { describe, expect, test } from 'bun:test';

import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import type { TokenService } from '../../auth/token-service';
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
import {
  createServerRequestServices,
} from './server-request-services';
import { createWorkflowExecutionServiceProvider } from './workflow-execution-services';
import type { ServerRouteServices } from './server-services';

describe('request-bound server services', () => {
  test('scopes storage to the live tenant and keeps raw access explicit', () => {
    const fixture = createFixture();
    try {
      const alpha = fixture.forToken('alpha');
      const beta = fixture.forToken('beta');
      const driveA = alpha.storage!.createDrive(USER_ID, { name: 'Alpha' });
      const driveB = beta.storage!.createDrive(USER_ID, { name: 'Beta' });

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

  test('keeps Storage ownership usable with an empty advanced-role set', () => {
    const fixture = createFixture();
    try {
      const context = tenantContext(TENANT_A, 'mem_roleless', 0, {
        userId: 'roleless-owner',
        platformRole: 'admin',
        tenantRole: 'member',
      });
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
      }, USER_ID);
      const notificationB = beta.notifications!.create({
        title: 'Beta notice',
      }, USER_ID);
      const roomA = alpha.rooms!.create(USER_ID, { name: 'Alpha room' });
      const roomB = beta.rooms!.create(USER_ID, { name: 'Beta room' });
      const workflowA = await alpha.workflows!.run('proof', {}, USER_ID);
      const workflowB = await beta.workflows!.run('proof', {}, USER_ID);

      expect(alpha.notifications!.get(notificationB.notification_id)).toBeNull();
      expect(beta.notifications!.get(notificationA.notification_id)).toBeNull();
      expect(alpha.rooms!.getRoom(roomB.room_id)).toBeNull();
      expect(beta.rooms!.getRoom(roomA.room_id)).toBeNull();
      expect(alpha.workflows!.get(workflowB)).toBeNull();
      expect(beta.workflows!.get(workflowA)).toBeNull();
      expect(() => alpha.notifications!.deleteExpired()).toThrow('not available');
      expect(() => alpha.workflows!.pollTimeouts()).toThrow('not available');
    } finally {
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

  test('keeps notification and room management identical to the HTTP tenant policy', () => {
    const fixture = createFixture();
    try {
      const owner = fixture.forToken('alpha');
      const platformAdmin = fixture.forToken('tenant-platform-admin');
      const notificationManager = fixture.forToken('tenant-notification-manager');
      const roomManager = fixture.forToken('tenant-room-manager');
      const notification = owner.notifications!.broadcast(
        { title: 'Owner notice' },
        USER_ID,
      );
      const room = owner.rooms!.create(USER_ID, { name: 'Owner room' });

      expect(() => platformAdmin.notifications!.broadcast(
        { title: 'Platform-only privilege' },
        'platform_admin',
      )).toThrow('Notification management is not permitted');
      expect(() => platformAdmin.notifications!.delete(notification.notification_id))
        .toThrow('Notification management is not permitted');
      expect(() => platformAdmin.rooms!.delete(room.room_id))
        .toThrow('Room not found');

      const managed = notificationManager.notifications!.broadcast(
        { title: 'Explicit manager' },
        'notification_manager',
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
      const drive = alpha.storage!.createDrive(USER_ID, { name: 'Alpha' });
      const upload = alpha.storage!.upload(
        drive.drive_id,
        '/report.txt',
        new Uint8Array([104, 105]),
        'report.txt',
        USER_ID,
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

  test('projects sealed workflow authority into tenant-safe services without a raw escape', () => {
    const fixture = createFixture();
    try {
      const alphaRequest = fixture.forToken('alpha');
      const betaRequest = fixture.forToken('beta');
      const driveA = alphaRequest.storage!.createDrive(USER_ID, { name: 'Alpha' });
      const driveB = betaRequest.storage!.createDrive(USER_ID, { name: 'Beta' });
      const authority = fixture.captureWorkflowAuthority('alpha');
      const provider = createWorkflowExecutionServiceProvider({
        services: fixture.services,
      });
      const zero = provider.createServices({
        authority: fixture.resolveWorkflowAuthority(authority),
        assertCurrentAuthority: () => fixture.assertWorkflowAuthority(authority),
      });

      expect(zero.scope).toEqual(trustedSystemServiceDataScope({
        scopeKind: 'tenant',
        tenantId: TENANT_A,
      }));
      expect(zero.storage!.getDrive(driveA.drive_id)).toEqual(driveA);
      expect(zero.storage!.getDrive(driveB.drive_id)).toBeNull();
      expect(() => zero.storage!.updateDrive(driveB.drive_id, { name: 'stolen' }))
        .toThrow('Drive not found');

      const notification = zero.notifications!.create({ title: 'Workflow' }, USER_ID);
      expect(notification.tenant_id).toBe(TENANT_A);
      expect(zero.rooms!.create(USER_ID, { name: 'Workflow room' }).tenant_id)
        .toBe(TENANT_A);

      expect(() => (zero as any).unsafe).toThrow('zero.unsafe');
      expect(() => (zero as any).db).toThrow('zero.db');
      expect(() => (zero as any).email).toThrow('zero.email');
      expect(() => (zero.auth as any).store).toThrow('zero.unsafe.auth.store');
      expect(Object.getOwnPropertyDescriptor(zero, 'db')).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(zero.auth, 'store')).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(zero.storage!, 'db')).toBeUndefined();
      expect('db' in zero).toBeFalse();
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

      expect(() => zero.storage!.createDrive(USER_ID, { name: 'stale' }))
        .toThrow('Workflow execution authority is no longer valid');
      expect(() => zero.notifications!.create({ title: 'stale' }, USER_ID))
        .toThrow('Workflow execution authority is no longer valid');
      expect(() => zero.rooms!.create(USER_ID, { name: 'stale' }))
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
});

const USER_ID = 'user_shared';
const TENANT_A = 'ten_alpha';
const TENANT_B = 'ten_beta';

function createFixture(
  adapter: StorageAdapter = memoryStorageAdapter(),
  tenancyMode: 'single' | 'multi' = 'multi',
) {
  const db = createReactiveDB({ mode: 'memory' });
  defineStorageTables(db);
  defineNotificationTables(db);
  defineRoomTables(db);
  defineWorkflowTables(db);
  const storage = new StorageService(db, adapter, { tenancyMode });
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
  workflowRegistry.registerWorkflow({
    name: 'proof',
    steps: [{ name: 'Proof', handler: 'proof' }],
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
    kernel,
    notifications,
    observabilityEvents,
    storage,
    store,
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
  return {
    async writeBlob(data) {
      const bytes = data instanceof Uint8Array
        ? data
        : data instanceof Blob
          ? new Uint8Array(await data.arrayBuffer())
          : new Uint8Array(await new Response(data).arrayBuffer());
      return { checksum: 'sha256:test', size: bytes.byteLength, headBytes: bytes };
    },
    async readBlob() { return null; },
    async readBlobRange() { return null; },
    async removeBlob() {},
    async blobExists() { return false; },
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
