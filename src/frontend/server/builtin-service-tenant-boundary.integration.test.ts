import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import type { AuthorizationPropertyStore } from '../../auth/authorization-access';
import { createAuthMiddleware } from '../../auth/auth.middleware';
import { createAuthorizationKernel } from '../../auth/authorization-kernel';
import type { TokenService } from '../../auth/token-service';
import type { AuthContext, AuthContextAuthorityReference } from '../../auth/types';
import { createNotificationPlugin } from '../../notifications/notification.plugin';
import { createRoomPlugin } from '../../rooms/room.plugin';
import type { StorageAdapter } from '../../storage/types';
import { createStoragePlugin } from '../../storage/storage.plugin';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import { createWorkflowPlugin } from '../../workflows/workflow.plugin';
import type { WorkflowRegistry } from '../../workflows/workflow-registry';

const USER_ID = 'user-shared-across-tenants';
const TENANT_A = 'ten_alpha';
const TENANT_B = 'ten_beta';

interface Harness {
  app: ReturnType<typeof createHarnessApp>;
  db: ReactiveDB;
  baseUrl: string;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop(true);
    harness.db.dispose();
  }
});

describe('built-in service tenant data boundary', () => {
  test('the same identity cannot cross active tenants by guessing built-in record ids', async () => {
    const harness = await startHarness();

    const roomA = await json<{ room: { room_id: string; tenant_id: string } }>(
      harness,
      'POST',
      '/rooms',
      'tenant-a',
      { name: 'Alpha room' },
    );
    const roomB = await json<{ room: { room_id: string; tenant_id: string } }>(
      harness,
      'POST',
      '/rooms',
      'tenant-b',
      { name: 'Beta room' },
    );
    expect(roomA.status).toBe(200);
    expect(roomA.body.room.tenant_id).toBe(TENANT_A);
    expect(roomB.body.room.tenant_id).toBe(TENANT_B);

    const wrongRoom = await json(harness, 'GET', `/rooms/${roomA.body.room.room_id}`, 'tenant-b');
    expect(wrongRoom.status).toBe(404);
    const roomsB = await json<{ rooms: Array<{ room_id: string }> }>(
      harness,
      'GET',
      '/rooms',
      'tenant-b',
    );
    expect(roomsB.body.rooms.map((room) => room.room_id)).toEqual([
      roomB.body.room.room_id,
    ]);

    const driveA = await json<{ drive_id: string; tenant_id: string }>(
      harness,
      'POST',
      '/storage/drives',
      'tenant-a',
      { name: 'Alpha files' },
    );
    const driveB = await json<{ drive_id: string; tenant_id: string }>(
      harness,
      'POST',
      '/storage/drives',
      'tenant-b',
      { name: 'Beta files' },
    );
    expect(driveA).toMatchObject({ status: 200 });
    expect(driveB).toMatchObject({ status: 200 });
    expect(driveA.body.tenant_id).toBe(TENANT_A);
    expect(driveB.body.tenant_id).toBe(TENANT_B);
    const wrongDrive = await json(
      harness,
      'GET',
      `/storage/drives/${driveA.body.drive_id}`,
      'tenant-b',
    );
    expect(wrongDrive.status).toBe(404);
    const drivesB = await json<Array<{ drive_id: string }>>(
      harness,
      'GET',
      '/storage/drives',
      'tenant-b',
    );
    expect(drivesB.body.map((drive) => drive.drive_id)).toEqual([driveB.body.drive_id]);

    const workflowA = await json<{ instanceId: string }>(
      harness,
      'POST',
      '/workflows',
      'tenant-a',
      { name: 'tenant-proof' },
    );
    const workflowB = await json<{ instanceId: string }>(
      harness,
      'POST',
      '/workflows',
      'tenant-b',
      { name: 'tenant-proof' },
    );
    const wrongWorkflow = await json(
      harness,
      'GET',
      `/workflows/${workflowA.body.instanceId}`,
      'tenant-b',
    );
    expect(wrongWorkflow.status).toBe(404);
    const workflowsB = await json<Array<{ instance_id: string; tenant_id: string }>>(
      harness,
      'GET',
      '/workflows',
      'tenant-b',
    );
    expect(workflowsB.body).toEqual([
      expect.objectContaining({
        instance_id: workflowB.body.instanceId,
        tenant_id: TENANT_B,
      }),
    ]);

    const notificationA = await json<{ notification: { notification_id: string; tenant_id: string } }>(
      harness,
      'POST',
      '/notifications/broadcast',
      'tenant-a',
      { title: 'Alpha notice' },
    );
    const notificationB = await json<{ notification: { notification_id: string; tenant_id: string } }>(
      harness,
      'POST',
      '/notifications/broadcast',
      'tenant-b',
      { title: 'Beta notice' },
    );
    expect(notificationA.body.notification.tenant_id).toBe(TENANT_A);
    expect(notificationB.body.notification.tenant_id).toBe(TENANT_B);
    const wrongNotification = await json(
      harness,
      'GET',
      `/notifications/${notificationA.body.notification.notification_id}`,
      'tenant-b',
    );
    expect(wrongNotification.status).toBe(404);
    const notificationsB = await json<{
      notifications: Array<{ notification_id: string }>;
    }>(harness, 'GET', '/notifications', 'tenant-b');
    expect(notificationsB.body.notifications.map((item) => item.notification_id)).toEqual([
      notificationB.body.notification.notification_id,
    ]);

    // Child rows carry the discriminator too; policy does not rely on a
    // caller-controlled parent id join for ordinary Sync delivery.
    expect(harness.db.query('room_members').every((row) =>
      row.tenant_id === TENANT_A || row.tenant_id === TENANT_B)).toBe(true);
    expect(harness.db.query('workflow_steps').every((row) =>
      row.tenant_id === TENANT_A || row.tenant_id === TENANT_B)).toBe(true);
  }, 30_000);
});

async function startHarness(): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: {
      mode: 'simple',
      roles: {
        owner: { allPermissions: true },
      },
    },
  }));
  const contexts = new Map<string, AuthContext>([
    ['tenant-a', tenantContext(TENANT_A, 'tmem_alpha')],
    ['tenant-b', tenantContext(TENANT_B, 'tmem_beta')],
  ]);
  const tokenService = {
    assertCurrentProfile() {},
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
      const resolved = current ? authorityReference(current) : null;
      return resolved && JSON.stringify(resolved) === JSON.stringify(reference)
        ? current!
        : null;
    },
  } as unknown as TokenService;
  const authorization = {
    getAuthorizationKernel: () => kernel,
    getPropertyStore: () => ({ getProperties: () => ({}) }),
  };
  const workflowRegistryRef: { current: WorkflowRegistry | null } = { current: null };
  let workflowReady = false;

  const app = createHarnessApp(
    db,
    tokenService,
    authorization,
    (registry) => { workflowRegistryRef.current = registry; },
    () => { workflowReady = true; },
  );
  const workflowRegistry = workflowRegistryRef.current;
  if (!workflowRegistry) throw new Error('Workflow registry was not composed');
  workflowRegistry.registerHandler('wait', async () => null);
  workflowRegistry.create({
    name: 'tenant-proof',
    steps: [{ name: 'Wait', handler: 'wait', waitFor: 'continue' }],
  });
  app.listen(0);
  for (let attempt = 0; attempt < 20 && !workflowReady; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!workflowReady) throw new Error('Workflow service did not start');
  const harness = {
    app,
    db,
    baseUrl: `http://localhost:${app.server!.port}`,
  };
  active.push(harness);
  return harness;
}

function createHarnessApp(
  db: ReactiveDB,
  tokenService: TokenService,
  authorization: {
    getAuthorizationKernel: () => ReturnType<typeof createAuthorizationKernel>;
    getPropertyStore: () => AuthorizationPropertyStore;
  },
  onWorkflowRegistry: (registry: WorkflowRegistry) => void,
  onWorkflowService: () => void,
) {
  return new Elysia()
    .use(createAuthMiddleware(() => tokenService, authorization))
    .use(createNotificationPlugin({
      db,
      getTokenService: () => tokenService,
      getScheduler: () => null,
      authorization,
    }))
    .use(createRoomPlugin({ db, getTokenService: () => tokenService, authorization }))
    .use(createWorkflowPlugin({
      db,
      getTokenService: () => tokenService,
      authorization,
      onRegistryCreated: onWorkflowRegistry,
      onServiceCreated: onWorkflowService,
    }))
    .use(createStoragePlugin({
      db,
      adapter: emptyStorageAdapter(),
      getTokenService: () => tokenService,
      authorization,
    }));
}

function tenantContext(tenantId: string, membershipId: string): AuthContext {
  return {
    userId: USER_ID,
    email: 'shared@example.test',
    role: 'admin',
    sessionKind: 'web',
    sessionId: `ses_${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId,
    tenantRole: 'owner',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
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

async function json<T = Record<string, unknown>>(
  harness: Harness,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  }
  return {
    status: response.status,
    body: parsed as T,
  };
}

function emptyStorageAdapter(): StorageAdapter {
  return {
    async writeBlob() {
      return { checksum: 'unused', size: 0, headBytes: new Uint8Array() };
    },
    async readBlob() { return null; },
    async readBlobRange() { return null; },
    async removeBlob() {},
    async blobExists() { return false; },
    async blobSize() { return 0; },
  };
}
