import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGuardianFabricProofConfig } from '../../../examples/guardian-fabric-proof/server/proof-config';
import { IdentityProjectionOutboxStore } from '../../auth/identity-projection-outbox-store';
import type { TokenService } from '../../auth/token-service';
import { databaseActorFixtureRealm } from '../../databases/test-fixtures/database-actor-realm';
import { MemoryEventStore, OBS_CODES } from '../../observability';
import {
  clearPlatformSQLiteService,
  createPlatformSQLiteService,
  getPlatformSQLiteService,
} from '../../persistence';
import type { PlatformSQLiteService } from '../../persistence';
import {
  allOf,
  authorizationPolicy,
  customPolicy,
  defineResource,
  tenantKindPolicy,
  tenantRealm,
} from '../../resources';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { ServerMessage, SyncSnapshotMessage } from '../../sync/types';
import { createApp } from './app-factory';
import { tenantProjectionTargetId } from './identity-projection-runtime';

const DATABASE_ACTOR_ENTRYPOINT = fileURLToPath(new URL(
  '../../databases/test-fixtures/database-actor-same-entry.ts',
  import.meta.url,
));
const GUARDIAN_PROOF_ACTOR_ENTRYPOINT = fileURLToPath(new URL(
  '../../databases/test-fixtures/guardian-fabric-proof-actor.ts',
  import.meta.url,
));

const TODOS_READ_PERMISSION = 'todos:read';
const TODOS_WRITE_PERMISSION = 'todos:write';
const TEST_PASSWORD = 'password123';
const PROOF_BOOTSTRAP_SECRET = 'guardian-fabric-proof-test-bootstrap-secret';

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

interface Registration {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: {
    readonly userId: string;
    readonly email: string;
  };
  readonly tenant: {
    readonly tenantId: string;
    readonly membershipId: string;
  };
}

interface IssuedApiKey {
  readonly secret: string;
  readonly apiKey: {
    readonly keyId: string;
    readonly userId: string;
    readonly tenantId: string;
    readonly membershipId: string;
    readonly scopeKind: 'tenant';
    readonly status: 'active';
  };
}

interface JsonResponse {
  readonly status: number;
  readonly body: Record<string, any>;
}

interface ProofAppHarness {
  readonly app: ManagedApp;
  readonly applicationSqlite: PlatformSQLiteService;
  readonly systemSqlite: PlatformSQLiteService;
  readonly tenantDatabaseRoot: string;
}

interface SyncConnection {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[];
  waitFor(
    predicate: (message: ServerMessage) => boolean,
    description: string,
  ): Promise<ServerMessage>;
  close(): Promise<void>;
}

let activeApp: ManagedApp | null = null;
let activeRoot: string | null = null;
let activeSqliteServices: PlatformSQLiteService[] = [];
const activeConnections = new Set<SyncConnection>();

afterEach(async () => {
  await Promise.all([...activeConnections].map((connection) => connection.close()));
  await activeApp?.stop(true);
  activeApp = null;

  const sqlite = getPlatformSQLiteService();
  sqlite?.close();
  clearPlatformSQLiteService(sqlite);

  for (const service of activeSqliteServices.splice(0)) service.close();

  if (activeRoot) await rm(activeRoot, { recursive: true, force: true });
  activeRoot = null;
}, 30_000);

describe('Guardian and Fabric integration', () => {
  test('never materializes a tenant database for a rolled-back registration', async () => {
    const proof = await setupProofApp('guardian-fabric-provisional-');
    activeApp = proof.app;

    const tokenProbe = installTokenServiceProbe(activeApp);
    activeApp.listen(0);
    const baseUrl = `http://localhost:${activeApp.server!.port}`;
    const tokenService = await tokenProbe.resolve(baseUrl);
    const issueTokenPair = tokenService.issueTokenPair.bind(tokenService);
    (tokenService as any).issueTokenPair = async () => {
      throw new Error('Simulated provisional registration failure');
    };
    try {
      const suffix = crypto.randomUUID();
      const failed = await jsonRequest(baseUrl, 'POST', '/auth/register', undefined, {
        username: `provisional-${suffix}`,
        email: `provisional-${suffix}@example.test`,
        password: TEST_PASSWORD,
        organizationName: `Provisional ${suffix}`,
        bootstrapSecret: PROOF_BOOTSTRAP_SECRET,
      });
      expect(failed).toMatchObject({
        status: 500,
        body: { code: 'AUTH_INTERNAL_ERROR' },
      });
    } finally {
      (tokenService as any).issueTokenPair = issueTokenPair;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(proof.systemSqlite.raw.query(`
      SELECT COUNT(*) AS count FROM _auth_registration_provisioning
    `).get()).toEqual({ count: 0 });
    expect(proof.systemSqlite.raw.query('SELECT COUNT(*) AS count FROM users').get())
      .toEqual({ count: 0 });
    expect(proof.systemSqlite.raw.query(`
      SELECT COUNT(*) AS count FROM _auth_identity_projection_targets
      WHERE scope = 'tenant'
    `).get()).toEqual({ count: 0 });
    expect(proof.systemSqlite.raw.query(`
      SELECT COUNT(*) AS count
      FROM _auth_identity_projection_outbox outbox
      INNER JOIN _auth_identity_projection_targets target
        ON target.target_id = outbox.target_id
      WHERE target.scope = 'tenant'
    `).get()).toEqual({ count: 0 });
    expect(await tenantDatabaseFiles(proof.tenantDatabaseRoot)).toEqual([]);
  }, 60_000);

  test('creates an authenticated workspace and approves a join request into its Fabric realm', async () => {
    const proof = await setupProofApp('guardian-fabric-onboarding-');
    activeApp = proof.app;
    activeApp.listen(0);
    const baseUrl = `http://localhost:${activeApp.server!.port}`;

    await register(
      baseUrl,
      'onboarding-platform',
      'Platform Administration',
      PROOF_BOOTSTRAP_SECRET,
    );
    const creator = await register(
      baseUrl,
      'workspace-creator',
      'Workspace Creator Home',
    );
    const applicant = await register(
      baseUrl,
      'join-applicant',
      'Join Applicant Home',
    );
    expect(await waitForDataRealmReady(baseUrl, creator.accessToken)).toMatchObject({
      status: 200,
      body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
    });
    expect(await waitForDataRealmReady(baseUrl, applicant.accessToken)).toMatchObject({
      status: 200,
      body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
    });

    const createdWorkspace = await jsonRequest(
      baseUrl,
      'POST',
      '/auth/tenants/create',
      undefined,
      {
        name: 'Created Through Guardian',
        slug: 'created-through-guardian',
        refreshToken: creator.refreshToken,
      },
    );
    expect(createdWorkspace).toMatchObject({
      status: 200,
      body: {
        user: { userId: creator.user.userId },
        activeTenant: {
          kind: 'organization',
          name: 'Created Through Guardian',
          slug: 'created-through-guardian',
          role: 'owner',
        },
      },
    });
    expect(createdWorkspace.body.accessToken).toBeString();
    expect(createdWorkspace.body.refreshToken).toBeString();
    const workspaceId = createdWorkspace.body.activeTenant.tenantId as string;
    const workspaceAccessToken = createdWorkspace.body.accessToken as string;
    expect(workspaceId).toBeString();
    expect(workspaceId).not.toBe(creator.tenant.tenantId);
    expect(await waitForDataRealmReady(baseUrl, workspaceAccessToken)).toMatchObject({
      status: 200,
      body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
    });

    const workspaceConfig = await jsonRequest(
      baseUrl,
      'GET',
      '/auth/tenant/config',
      workspaceAccessToken,
    );
    expect(workspaceConfig).toMatchObject({
      status: 200,
      body: {
        tenant: {
          tenantId: workspaceId,
          kind: 'organization',
          slug: 'created-through-guardian',
        },
        actor: { roles: ['owner'] },
        capabilities: { canReviewJoinRequests: true },
      },
    });
    const ownerMembershipId = workspaceConfig.body.actor.membershipId as string;
    expect(ownerMembershipId).toBeString();

    const ownerTaskInput = {
      task_id: 'created-workspace-owner-task',
      title: 'Owner task in the created workspace',
      status: 'open',
    };
    const ownerTaskRequestStartedAt = Date.now();
    const createdOwnerTask = await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      workspaceAccessToken,
      ownerTaskInput,
      { 'Idempotency-Key': 'proof-created-workspace-owner-task' },
    );
    const ownerTaskRequestFinishedAt = Date.now();
    const ownerTask = {
      ...ownerTaskInput,
      created_at: expectServerTimestampWithinRequest(
        createdOwnerTask.body.row?.created_at,
        ownerTaskRequestStartedAt,
        ownerTaskRequestFinishedAt,
      ),
      created_by_user_id: creator.user.userId,
      assigned_membership_id: ownerMembershipId,
    };
    expect(createdOwnerTask).toEqual({ status: 201, body: { row: ownerTask } });

    expect(await jsonRequest(
      baseUrl,
      'POST',
      '/auth/tenant-join-requests',
      applicant.accessToken,
      { tenantSlug: 'created-through-guardian' },
    )).toEqual({ status: 202, body: { submitted: true } });

    const pendingPage = await jsonRequest(
      baseUrl,
      'GET',
      '/auth/tenant/join-requests?status=pending',
      workspaceAccessToken,
    );
    expect(pendingPage).toMatchObject({
      status: 200,
      body: {
        requests: [{
          applicant: {
            userId: applicant.user.userId,
            email: applicant.user.email,
          },
          status: 'pending',
          membership: null,
          approvalPolicy: {
            canApprove: true,
            roleSelection: {
              mode: 'selectable',
              roles: expect.arrayContaining([
                { key: 'viewer', label: 'Task viewer' },
                { key: 'editor', label: 'Task contributor' },
                { key: 'manager', label: 'Task manager' },
              ]),
            },
          },
        }],
        page: { count: 1, hasMore: false },
      },
    });
    const pending = pendingPage.body.requests[0];
    const approved = await jsonRequest(
      baseUrl,
      'POST',
      `/auth/tenant/join-requests/${pending.joinRequestId}/approve`,
      workspaceAccessToken,
      {
        expectedRequestRevision: pending.requestRevision,
        roles: ['editor'],
      },
    );
    expect(approved).toMatchObject({
      status: 200,
      body: {
        request: {
          joinRequestId: pending.joinRequestId,
          status: 'approved',
          membership: {
            status: 'active',
            roles: ['editor'],
          },
        },
      },
    });
    const approvedMembershipId = approved.body.request.membership.membershipId as string;
    expect(approvedMembershipId).toBeString();

    const joinedSession = await switchTenant(
      baseUrl,
      applicant.refreshToken,
      workspaceId,
    );
    expect(await waitForDataRealmReady(baseUrl, joinedSession.accessToken)).toMatchObject({
      status: 200,
      body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
    });
    expect(await jsonRequest(
      baseUrl,
      'GET',
      '/auth/tenant/config',
      joinedSession.accessToken,
    )).toMatchObject({
      status: 200,
      body: {
        tenant: { tenantId: workspaceId },
        actor: {
          membershipId: approvedMembershipId,
          roles: ['editor'],
        },
      },
    });
    const initialEditorTasks = await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks',
      joinedSession.accessToken,
    );
    expect(initialEditorTasks.status).toBe(200);
    expect(initialEditorTasks.body.rows).toEqual([]);

    const editorTaskInput = {
      task_id: 'approved-editor-task',
      title: 'Task from the approved editor',
      status: 'open',
    };
    const editorTaskRequestStartedAt = Date.now();
    const createdEditorTask = await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      joinedSession.accessToken,
      editorTaskInput,
      { 'Idempotency-Key': 'proof-approved-editor-task' },
    );
    const editorTaskRequestFinishedAt = Date.now();
    const editorTask = {
      ...editorTaskInput,
      created_at: expectServerTimestampWithinRequest(
        createdEditorTask.body.row?.created_at,
        editorTaskRequestStartedAt,
        editorTaskRequestFinishedAt,
      ),
      created_by_user_id: applicant.user.userId,
      assigned_membership_id: approvedMembershipId,
    };
    expect(createdEditorTask).toEqual({ status: 201, body: { row: editorTask } });
    const editorTasks = await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks',
      joinedSession.accessToken,
    );
    expect(editorTasks.status).toBe(200);
    expect(editorTasks.body.rows).toEqual([editorTask]);
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks',
      workspaceAccessToken,
    )).toMatchObject({
      status: 200,
      body: { rows: expect.arrayContaining([ownerTask, editorTask]) },
    });
  }, 60_000);

  test('projects live Guardian ownership into isolated proof-app task databases', async () => {
    const events = new MemoryEventStore();
    const proof = await setupProofApp('guardian-fabric-owned-tasks-', events);
    activeApp = proof.app;

    expect(proof.applicationSqlite).not.toBe(proof.systemSqlite);
    expect(proof.applicationSqlite.raw).not.toBe(proof.systemSqlite.raw);
    expect(hasSqliteTable(proof.applicationSqlite, 'users')).toBe(false);
    expect(hasSqliteTable(proof.applicationSqlite, 'tasks')).toBe(false);
    expect(hasSqliteTable(proof.systemSqlite, 'users')).toBe(true);
    expect(hasSqliteTable(proof.systemSqlite, 'tasks')).toBe(false);

    activeApp.listen(0);
    const baseUrl = `http://localhost:${activeApp.server!.port}`;
    const syncUrl = `ws://localhost:${activeApp.server!.port}/sync`;
    const platform = await register(
      baseUrl,
      'proof-platform',
      'Platform Administration',
      PROOF_BOOTSTRAP_SECRET,
    );
    const tenantA = await register(baseUrl, 'proof-a', 'Proof Tenant A');
    const tenantB = await register(baseUrl, 'proof-b', 'Proof Tenant B');
    expect(await jsonRequest(
      baseUrl,
      'GET',
      '/auth/data-realm/readiness',
      platform.accessToken,
    )).toMatchObject({
      status: 200,
      body: { status: 'not-required', scope: null },
    });
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks',
      platform.accessToken,
    )).toEqual({
      status: 403,
      body: { error: 'Forbidden', code: 'authorization-denied' },
    });
    const [tenantAReadiness, tenantBReadiness] = await Promise.all([
      waitForDataRealmReady(baseUrl, tenantA.accessToken),
      waitForDataRealmReady(baseUrl, tenantB.accessToken),
    ]);
    expect(tenantAReadiness).toMatchObject({
      status: 200,
      body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
    });
    expect(tenantBReadiness).toMatchObject({
      status: 200,
      body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
    });
    expect(proof.systemSqlite.raw.query(`
      SELECT COUNT(*) AS count FROM _auth_identity_projection_targets
      WHERE target_id = ?
    `).get(tenantProjectionTargetId(platform.tenant.tenantId))).toEqual({ count: 0 });
    expect(proof.systemSqlite.raw.query(`
      SELECT COUNT(*) AS count FROM _auth_identity_projection_targets
      WHERE scope = 'tenant'
    `).get()).toEqual({ count: 2 });

    const liveClientA = await connectSync(syncUrl, tenantA.accessToken);
    const liveClientB = await connectSync(syncUrl, tenantA.accessToken);
    subscribeTasks(liveClientA);
    subscribeTasks(liveClientB);
    expect((await waitForTaskSnapshot(liveClientA)).tables.tasks).toEqual({});
    expect((await waitForTaskSnapshot(liveClientB)).tables.tasks).toEqual({});

    // Client input can neither claim Guardian ownership nor smuggle a logical
    // tenant selector into the physically tenant-bound task Resource. Each
    // field is rejected before trusted actor stamping and before any row can
    // reach the tenant database.
    for (const [field, value] of [
      ['created_by_user_id', tenantB.user.userId],
      ['assigned_membership_id', tenantB.tenant.membershipId],
      ['tenant_id', tenantB.tenant.tenantId],
    ] as const) {
      const taskId = `spoof-${field}`;
      expect(await resourceRequest(
        baseUrl,
        'POST',
        '/api/resources/tasks',
        tenantA.accessToken,
        {
          task_id: taskId,
          title: `Must reject ${field}`,
          status: 'open',
          [field]: value,
        },
        { 'Idempotency-Key': `proof-reject-${field}` },
      )).toEqual({
        status: 400,
        body: {
          code: 'resource-field-not-writable',
          error: `Field '${field}' is not client-writable for create on resource table 'tasks'`,
        },
      });
    }
    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      tenantA.accessToken,
      {
        task_id: 'spoof-created-at',
        title: 'Must reject client creation time',
        status: 'open',
        created_at: 1_893_455_000_000,
      },
      { 'Idempotency-Key': 'proof-reject-created-at' },
    )).toEqual({
      status: 400,
      body: {
        code: 'resource-field-not-writable',
        error: "Field 'created_at' is not client-writable for create on resource table 'tasks'",
      },
    });
    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      tenantA.accessToken,
      {
        task_id: 'blank-title-must-not-commit',
        title: '   ',
        status: 'open',
      },
      { 'Idempotency-Key': 'proof-reject-blank-title' },
    )).toEqual({
      status: 400,
      body: {
        code: 'task-title-invalid',
        error: 'Task title must contain 1 to 200 characters after trimming surrounding whitespace',
      },
    });
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks',
      tenantA.accessToken,
    )).toMatchObject({ status: 200, body: { rows: [] } });

    // Hold one valid system-plane delivery to prove a concurrent request can
    // never race past projection admission and surface a raw FK conflict.
    const projectionOutbox = new IdentityProjectionOutboxStore(
      reactiveStoreAdapter(proof.systemSqlite),
    );
    const tenantATarget = tenantProjectionTargetId(tenantA.tenant.tenantId);
    projectionOutbox.enqueue(tenantATarget, {
      kind: 'user',
      userId: platform.user.userId,
    });
    const heldProjection = projectionOutbox.claimNext(
      tenantATarget,
      'proof-held-projection',
      30_000,
    );
    expect(heldProjection).not.toBeNull();
    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      tenantA.accessToken,
      {
        task_id: 'must-wait-for-projection',
        title: 'Must not race projection',
        status: 'open',
      },
      { 'Idempotency-Key': 'proof-pre-ready-must-not-write' },
    )).toEqual({
      status: 503,
      body: {
        error: 'Application data realm is still provisioning',
        code: 'data-realm-not-ready',
        retryable: true,
      },
    });
    projectionOutbox.release(
      heldProjection!,
      Date.now(),
      'IDENTITY_PROJECTION_NOT_READY',
    );
    expect(await waitForDataRealmReady(baseUrl, tenantA.accessToken)).toMatchObject({
      status: 200,
      body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
    });

    const taskAInput = {
      task_id: 'same-task',
      title: '  Tenant A owned task  ',
      status: 'open',
    };
    const taskBInput = {
      ...taskAInput,
      title: 'Tenant B owned task',
    };
    const taskARequestStartedAt = Date.now();
    const createdA = await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      tenantA.accessToken,
      taskAInput,
      { 'Idempotency-Key': 'proof-tenant-a-same-task' },
    );
    const taskARequestFinishedAt = Date.now();
    const taskBRequestStartedAt = Date.now();
    const createdB = await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      tenantB.accessToken,
      taskBInput,
      { 'Idempotency-Key': 'proof-tenant-b-same-task' },
    );
    const taskBRequestFinishedAt = Date.now();

    const taskA = {
      ...taskAInput,
      title: taskAInput.title.trim(),
      created_at: expectServerTimestampWithinRequest(
        createdA.body.row?.created_at,
        taskARequestStartedAt,
        taskARequestFinishedAt,
      ),
    };
    const taskB = {
      ...taskBInput,
      created_at: expectServerTimestampWithinRequest(
        createdB.body.row?.created_at,
        taskBRequestStartedAt,
        taskBRequestFinishedAt,
      ),
    };

    expect(createdA).toEqual({
      status: 201,
      body: {
        row: {
          ...taskA,
          created_by_user_id: tenantA.user.userId,
          assigned_membership_id: tenantA.tenant.membershipId,
        },
      },
    });
    expect(createdB).toEqual({
      status: 201,
      body: {
        row: {
          ...taskB,
          created_by_user_id: tenantB.user.userId,
          assigned_membership_id: tenantB.tenant.membershipId,
        },
      },
    });
    expect(events.query({ code: OBS_CODES.DATABASE_CHANGE_WAKEUP.code }).events)
      .not.toHaveLength(0);
    await Promise.all([
      waitForTaskChange(liveClientA, taskA.task_id, taskA.title),
      waitForTaskChange(liveClientB, taskA.task_id, taskA.title),
    ]);

    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/same-task',
      tenantA.accessToken,
    )).body.row).toEqual(createdA.body.row);
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/same-task',
      tenantB.accessToken,
    )).body.row).toEqual(createdB.body.row);
    const tenantBList = await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks',
      tenantB.accessToken,
    );
    expect(tenantBList.status).toBe(200);
    expect(tenantBList.body.rows).toEqual([createdB.body.row]);
    expect(JSON.stringify(tenantBList.body)).not.toContain(taskA.title);

    // Switching the second realtime client to another Guardian tenant yields
    // a fresh tenant-plane snapshot, never a merged cross-tenant collection.
    await liveClientB.close();
    const switchedLiveClient = await connectSync(syncUrl, tenantB.accessToken);
    subscribeTasks(switchedLiveClient);
    const switchedSnapshot = await waitForTaskSnapshot(switchedLiveClient);
    expect(switchedSnapshot.tables.tasks).toEqual({
      [taskB.task_id]: createdB.body.row,
    });
    expect(JSON.stringify(switchedSnapshot.tables.tasks)).not.toContain(taskA.title);
    const tenantAObserver = await connectSync(syncUrl, tenantA.accessToken);
    subscribeTasks(tenantAObserver);
    expect((await waitForTaskSnapshot(tenantAObserver)).tables.tasks).toEqual({
      [taskA.task_id]: createdA.body.row,
    });
    const ownerDeleteTargetInput = {
      task_id: 'owner-delete-target',
      title: 'Owner task for manager deletion',
      status: 'open',
    };
    const ownerDeleteRequestStartedAt = Date.now();
    const createdOwnerDeleteTarget = await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      tenantA.accessToken,
      ownerDeleteTargetInput,
      { 'Idempotency-Key': 'proof-owner-delete-target' },
    );
    const ownerDeleteRequestFinishedAt = Date.now();
    const ownerDeleteTarget = {
      ...ownerDeleteTargetInput,
      created_at: expectServerTimestampWithinRequest(
        createdOwnerDeleteTarget.body.row?.created_at,
        ownerDeleteRequestStartedAt,
        ownerDeleteRequestFinishedAt,
      ),
    };
    expect(createdOwnerDeleteTarget).toEqual({
      status: 201,
      body: {
        row: {
          ...ownerDeleteTarget,
          created_by_user_id: tenantA.user.userId,
          assigned_membership_id: tenantA.tenant.membershipId,
        },
      },
    });
    await Promise.all([
      waitForTaskMutation(
        liveClientA,
        'INSERT',
        ownerDeleteTarget.task_id,
        ownerDeleteTarget.title,
      ),
      waitForTaskMutation(
        tenantAObserver,
        'INSERT',
        ownerDeleteTarget.task_id,
        ownerDeleteTarget.title,
      ),
    ]);

    // One Guardian identity can participate in two organizations. Its live
    // tenant membership, role revisions, and actor stamps remain authoritative
    // while both organizations keep physically isolated task rows.
    const sharedMembership = await jsonRequest(
      baseUrl,
      'POST',
      '/auth/tenant/members',
      tenantA.accessToken,
      { email: tenantB.user.email, roles: ['viewer'] },
    );
    expect(sharedMembership).toMatchObject({
      status: 200,
      body: {
        member: {
          identity: { userId: tenantB.user.userId },
          roles: ['viewer'],
        },
      },
    });
    const viewerSession = await switchTenant(
      baseUrl,
      tenantB.refreshToken,
      tenantA.tenant.tenantId,
    );
    expect(await waitForDataRealmReady(baseUrl, viewerSession.accessToken))
      .toMatchObject({ status: 200, body: { status: 'ready', scope: 'tenant' } });
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/same-task',
      viewerSession.accessToken,
    )).body.row).toEqual(createdA.body.row);
    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      viewerSession.accessToken,
      {
        task_id: 'viewer-must-not-create',
        title: 'Viewer must not create',
        status: 'open',
      },
      { 'Idempotency-Key': 'proof-viewer-create-denied' },
    )).toMatchObject({
      status: 403,
      body: { code: 'authorization-denied' },
    });
    expect(await resourceRequest(
      baseUrl,
      'PATCH',
      '/api/resources/tasks/same-task',
      viewerSession.accessToken,
      { status: 'complete' },
      { 'Idempotency-Key': 'proof-viewer-update-denied' },
    )).toMatchObject({
      status: 403,
      body: { code: 'authorization-denied' },
    });
    expect(await resourceRequest(
      baseUrl,
      'DELETE',
      '/api/resources/tasks/same-task',
      viewerSession.accessToken,
      undefined,
      { 'Idempotency-Key': 'proof-viewer-delete-denied' },
    )).toMatchObject({
      status: 403,
      body: { code: 'authorization-denied' },
    });
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/same-task',
      viewerSession.accessToken,
    )).body.row).toEqual(createdA.body.row);
    const roleBoundKey = await issueApiKeyWithToken(
      baseUrl,
      viewerSession.accessToken,
      'Role-bound task automation',
    );
    expect((await resourceRequest(
      baseUrl,
      'GET',
      `/api/resources/tasks/same-task?tenantId=${tenantB.tenant.tenantId}`,
      roleBoundKey.secret,
      undefined,
      {
        'X-Tenant-Id': tenantB.tenant.tenantId,
        'X-Zero-Tenant-Id': tenantB.tenant.tenantId,
      },
    )).body.row).toEqual(createdA.body.row);
    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      roleBoundKey.secret,
      {
        task_id: 'viewer-key-must-not-create',
        title: 'Viewer key must not create',
        status: 'open',
      },
      { 'Idempotency-Key': 'proof-viewer-key-create-denied' },
    )).toMatchObject({
      status: 403,
      body: { code: 'authorization-denied' },
    });

    const promotedEditor = await jsonRequest(
      baseUrl,
      'PATCH',
      `/auth/tenant/members/${sharedMembership.body.member.membershipId}`,
      tenantA.accessToken,
      {
        roles: ['editor'],
        expectedRoleRevision: sharedMembership.body.member.roleRevision,
      },
    );
    expect(promotedEditor).toMatchObject({
      status: 200,
      body: { member: { roles: ['editor'] } },
    });
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/same-task',
      viewerSession.accessToken,
    )).status).toBe(401);

    const editorSession = await loginToTenant(
      baseUrl,
      tenantB.user.email,
      tenantA.tenant.tenantId,
    );
    const editorTaskInput = {
      task_id: 'editor-owned-task',
      title: 'Editor owned task',
      status: 'open',
    };
    const editorTaskRequestStartedAt = Date.now();
    const createdByEditorKey = await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/tasks',
      roleBoundKey.secret,
      editorTaskInput,
      { 'Idempotency-Key': 'proof-editor-key-create' },
    );
    const editorTaskRequestFinishedAt = Date.now();
    const editorTask = {
      ...editorTaskInput,
      created_at: expectServerTimestampWithinRequest(
        createdByEditorKey.body.row?.created_at,
        editorTaskRequestStartedAt,
        editorTaskRequestFinishedAt,
      ),
    };
    expect(createdByEditorKey).toEqual({
      status: 201,
      body: {
        row: {
          ...editorTask,
          created_by_user_id: tenantB.user.userId,
          assigned_membership_id: sharedMembership.body.member.membershipId,
        },
      },
    });
    await Promise.all([
      waitForTaskMutation(liveClientA, 'INSERT', editorTask.task_id, editorTask.title),
      waitForTaskMutation(tenantAObserver, 'INSERT', editorTask.task_id, editorTask.title),
    ]);

    const editorList = await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks',
      editorSession.accessToken,
    );
    expect(editorList).toMatchObject({
      status: 200,
      body: { rows: [createdByEditorKey.body.row] },
    });
    expect(JSON.stringify(editorList.body)).not.toContain(taskA.title);
    expect(JSON.stringify(editorList.body)).not.toContain(ownerDeleteTarget.title);
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/editor-owned-task',
      editorSession.accessToken,
    )).body.row).toEqual(createdByEditorKey.body.row);
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/same-task',
      editorSession.accessToken,
    )).status).toBe(403);

    expect(await resourceRequest(
      baseUrl,
      'PATCH',
      '/api/resources/tasks/editor-owned-task',
      editorSession.accessToken,
      { title: 'Client title edits must be rejected' },
      { 'Idempotency-Key': 'proof-editor-title-update-denied' },
    )).toEqual({
      status: 400,
      body: {
        code: 'resource-field-not-writable',
        error: "Field 'title' is not client-writable for update on resource table 'tasks'",
      },
    });
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/editor-owned-task',
      editorSession.accessToken,
    )).body.row).toEqual(createdByEditorKey.body.row);

    const editorUpdatedTask = { ...editorTask, status: 'complete' };
    expect(await resourceRequest(
      baseUrl,
      'PATCH',
      '/api/resources/tasks/editor-owned-task',
      editorSession.accessToken,
      { status: editorUpdatedTask.status },
      { 'Idempotency-Key': 'proof-editor-update-own' },
    )).toMatchObject({
      status: 200,
      body: { row: editorUpdatedTask },
    });
    await Promise.all([
      waitForTaskMutation(
        liveClientA,
        'UPDATE',
        editorUpdatedTask.task_id,
        editorUpdatedTask.title,
        editorUpdatedTask.status,
      ),
      waitForTaskMutation(
        tenantAObserver,
        'UPDATE',
        editorUpdatedTask.task_id,
        editorUpdatedTask.title,
        editorUpdatedTask.status,
      ),
    ]);
    expect((await resourceRequest(
      baseUrl,
      'PATCH',
      '/api/resources/tasks/same-task',
      editorSession.accessToken,
      { status: 'complete' },
      { 'Idempotency-Key': 'proof-editor-update-other-denied' },
    )).status).toBe(403);
    expect(await resourceRequest(
      baseUrl,
      'DELETE',
      '/api/resources/tasks/editor-owned-task',
      editorSession.accessToken,
      undefined,
      { 'Idempotency-Key': 'proof-editor-delete-own-denied' },
    )).toMatchObject({
      status: 403,
      body: { code: 'authorization-denied' },
    });
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/editor-owned-task',
      editorSession.accessToken,
    )).body.row).toEqual({
      ...createdByEditorKey.body.row,
      status: editorUpdatedTask.status,
    });

    const rotatedRoleKeyResponse = await jsonRequest(
      baseUrl,
      'POST',
      `/auth/api-keys/${roleBoundKey.apiKey.keyId}/rotate`,
      editorSession.accessToken,
      { label: 'Rotated role-bound task automation' },
    );
    expect(rotatedRoleKeyResponse.body.secret).toBeString();
    expect(rotatedRoleKeyResponse).toMatchObject({
      status: 200,
      body: {
        apiKey: {
          userId: tenantB.user.userId,
          tenantId: tenantA.tenant.tenantId,
          membershipId: sharedMembership.body.member.membershipId,
          status: 'active',
        },
      },
    });
    const rotatedRoleKey = rotatedRoleKeyResponse.body as unknown as IssuedApiKey;
    expect(rotatedRoleKey.apiKey.keyId).not.toBe(roleBoundKey.apiKey.keyId);
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/editor-owned-task',
      roleBoundKey.secret,
    )).status).toBe(401);
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/editor-owned-task',
      rotatedRoleKey.secret,
    )).toMatchObject({
      status: 200,
      body: { row: { title: editorUpdatedTask.title } },
    });

    const promotedManager = await jsonRequest(
      baseUrl,
      'PATCH',
      `/auth/tenant/members/${sharedMembership.body.member.membershipId}`,
      tenantA.accessToken,
      {
        roles: ['manager'],
        expectedRoleRevision: promotedEditor.body.member.roleRevision,
      },
    );
    expect(promotedManager).toMatchObject({
      status: 200,
      body: { member: { roles: ['manager'] } },
    });
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/editor-owned-task',
      editorSession.accessToken,
    )).status).toBe(401);
    const managerSession = await loginToTenant(
      baseUrl,
      tenantB.user.email,
      tenantA.tenant.tenantId,
    );
    const managerList = await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks',
      managerSession.accessToken,
    );
    expect(managerList.status).toBe(200);
    expect(managerList.body.rows).toEqual(expect.arrayContaining([
      createdA.body.row,
      expect.objectContaining({
        task_id: ownerDeleteTarget.task_id,
        title: ownerDeleteTarget.title,
      }),
      expect.objectContaining({
        task_id: editorUpdatedTask.task_id,
        title: editorUpdatedTask.title,
      }),
    ]));

    // The same key resolves the member's current role on every request. Once
    // promoted, it can manage rows owned by either Guardian actor.
    const managerUpdatedTaskA = { ...taskA, status: 'complete' };
    expect(await resourceRequest(
      baseUrl,
      'PATCH',
      '/api/resources/tasks/same-task',
      rotatedRoleKey.secret,
      { status: managerUpdatedTaskA.status },
      { 'Idempotency-Key': 'proof-manager-key-update-any' },
    )).toMatchObject({
      status: 200,
      body: {
        row: {
          ...managerUpdatedTaskA,
          created_by_user_id: tenantA.user.userId,
          assigned_membership_id: tenantA.tenant.membershipId,
        },
      },
    });
    await Promise.all([
      waitForTaskMutation(
        liveClientA,
        'UPDATE',
        managerUpdatedTaskA.task_id,
        managerUpdatedTaskA.title,
        managerUpdatedTaskA.status,
      ),
      waitForTaskMutation(
        tenantAObserver,
        'UPDATE',
        managerUpdatedTaskA.task_id,
        managerUpdatedTaskA.title,
        managerUpdatedTaskA.status,
      ),
    ]);
    expect((await resourceRequest(
      baseUrl,
      'DELETE',
      '/api/resources/tasks/owner-delete-target',
      rotatedRoleKey.secret,
      undefined,
      { 'Idempotency-Key': 'proof-manager-key-delete-other' },
    )).status).toBe(200);
    await Promise.all([
      waitForTaskMutation(liveClientA, 'DELETE', ownerDeleteTarget.task_id),
      waitForTaskMutation(tenantAObserver, 'DELETE', ownerDeleteTarget.task_id),
    ]);
    expect((await resourceRequest(
      baseUrl,
      'DELETE',
      '/api/resources/tasks/editor-owned-task',
      rotatedRoleKey.secret,
      undefined,
      { 'Idempotency-Key': 'proof-manager-key-delete-any' },
    )).status).toBe(200);
    await Promise.all([
      waitForTaskMutation(liveClientA, 'DELETE', editorTask.task_id),
      waitForTaskMutation(tenantAObserver, 'DELETE', editorTask.task_id),
    ]);

    expect(await jsonRequest(
      baseUrl,
      'DELETE',
      `/auth/tenant/api-keys/${rotatedRoleKey.apiKey.keyId}`,
      tenantA.accessToken,
    )).toMatchObject({ status: 200, body: { status: 'revoked' } });
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/same-task',
      rotatedRoleKey.secret,
    )).status).toBe(401);

    expect(await jsonRequest(
      baseUrl,
      'DELETE',
      `/auth/tenant/members/${sharedMembership.body.member.membershipId}`,
      tenantA.accessToken,
    )).toMatchObject({ status: 200, body: { member: { status: 'removed' } } });
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/tasks/same-task',
      managerSession.accessToken,
    )).status).toBe(401);

    await Promise.all([
      liveClientA.close(),
      tenantAObserver.close(),
      switchedLiveClient.close(),
    ]);

    // Release every actor lease before opening the managed files directly.
    await activeApp.stop(true);
    activeApp = null;

    const tenantSnapshots = await inspectOwnedTaskDatabases(proof.tenantDatabaseRoot);
    expect(tenantSnapshots).toHaveLength(2);
    const tenantASnapshot = tenantSnapshots.find(
      (snapshot) => snapshot.task.title === managerUpdatedTaskA.title,
    );
    assertOwnedTaskDatabase(
      tenantASnapshot,
      tenantA,
      managerUpdatedTaskA,
    );
    expect(tenantASnapshot!.userIds).toContain(tenantB.user.userId);
    expect(tenantASnapshot!.memberships).toContainEqual({
      membership_id: sharedMembership.body.member.membershipId,
      tenant_id: tenantA.tenant.tenantId,
      user_id: tenantB.user.userId,
    });
    assertOwnedTaskDatabase(
      tenantSnapshots.find((snapshot) => snapshot.task.title === taskB.title),
      tenantB,
      taskB,
    );
  }, 60_000);

  test('binds live tenant API-key authority to isolated actor databases', async () => {
    const updateBarrier = createUpdateBarrier();
    const zeroDir = join(process.cwd(), '.zero');
    await mkdir(zeroDir, { recursive: true });
    activeRoot = await mkdtemp(join(zeroDir, 'guardian-fabric-'));
    const appDir = join(activeRoot, 'app');
    await mkdir(appDir, { recursive: true });

    const customerOrganization = tenantKindPolicy('organization');
    const apiKeyReadAccess = allOf(authorizationPolicy({
      user: 'required',
      tenant: 'required',
      credentials: ['session', 'api-key'],
      permission: TODOS_READ_PERMISSION,
    }), customerOrganization);
    const apiKeyWriteAccess = allOf(authorizationPolicy({
      user: 'required',
      tenant: 'required',
      credentials: ['session', 'api-key'],
      permission: TODOS_WRITE_PERMISSION,
    }), customerOrganization);
    const sessionOnlyWriteAccess = allOf(authorizationPolicy({
      user: 'required',
      tenant: 'required',
      credentials: ['session'],
      permission: TODOS_WRITE_PERMISSION,
    }), customerOrganization);
    activeApp = await createApp({
      db: {
        sqlite: createPlatformSQLiteService({ mode: 'memory' }),
        ringBufferDepth: 500,
      },
      tables: {
        todos: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      resources: [defineResource({
        table: 'todos',
        exposure: 'http',
        realm: tenantRealm(),
        policy: {
          list: apiKeyReadAccess,
          get: apiKeyReadAccess,
          create: apiKeyWriteAccess,
          update: allOf(apiKeyWriteAccess, updateBarrier.policy),
          delete: sessionOnlyWriteAccess,
        },
      })],
      auth: {
        tenancy: 'multi',
        bootstrap: 'public',
        registration: { mode: 'public' },
        authorization: {
          mode: 'advanced',
          permissions: {
            [TODOS_READ_PERMISSION]: { label: 'Read todos' },
            [TODOS_WRITE_PERMISSION]: { label: 'Write todos' },
          },
          roles: {
            viewer: {
              label: 'Todo viewer',
              permissions: [TODOS_READ_PERMISSION],
            },
            editor: {
              label: 'Todo editor',
              permissions: [TODOS_READ_PERMISSION, TODOS_WRITE_PERMISSION],
            },
          },
        },
        apiKeys: {
          enabled: true,
          selfService: true,
          administratorIssuance: true,
          eligibleScopeRoles: ['owner'],
        },
      },
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: join(activeRoot, 'tenant-databases'),
        realm: databaseActorFixtureRealm,
        actors: {
          launch: {
            kind: 'source',
            entrypoint: DATABASE_ACTOR_ENTRYPOINT,
          },
        },
        tenantIsolation: 'tenant-database',
      },
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      appDir,
      outDir: join(activeRoot, 'out'),
      generatedDir: join(activeRoot, '.zero', 'generated'),
      observability: { console: false, endpoint: false },
      email: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
    });

    const defaultDatabase = installDefaultDatabaseProbe(activeApp);
    activeApp.listen(0);
    const baseUrl = `http://localhost:${activeApp.server!.port}`;
    const applicationDB = await defaultDatabase.resolve(baseUrl);

    // Public bootstrap creates the platform-administration tenant. The next
    // two registrations are ordinary customer organizations and therefore
    // valid tenant API-key subjects.
    const platform = await register(baseUrl, 'platform', 'Platform Administration');
    const tenantA = await register(baseUrl, 'tenant-a', 'Tenant A');
    const tenantB = await register(baseUrl, 'tenant-b', 'Tenant B');
    expect(tenantA.tenant.tenantId).not.toBe(tenantB.tenant.tenantId);

    // Application-level authority in the protected Administration
    // Organization does not widen a customer-only resource policy.
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos',
      platform.accessToken,
    )).toEqual({
      status: 403,
      body: { error: 'Forbidden', code: 'authorization-denied' },
    });

    const keyA = await issueApiKey(baseUrl, tenantA, 'Tenant A automation');
    const keyB = await issueApiKey(baseUrl, tenantB, 'Tenant B automation');
    expect(keyA.apiKey).toMatchObject({
      userId: tenantA.user.userId,
      tenantId: tenantA.tenant.tenantId,
      membershipId: tenantA.tenant.membershipId,
      scopeKind: 'tenant',
      status: 'active',
    });
    expect(keyB.apiKey.tenantId).toBe(tenantB.tenant.tenantId);

    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/todos',
      keyA.secret,
      { id: 'same-id', title: 'Tenant A value' },
      { 'Idempotency-Key': 'tenant-a-same-id' },
    )).toEqual({
      status: 201,
      body: { row: { id: 'same-id', title: 'Tenant A value' } },
    });
    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/todos',
      keyB.secret,
      { id: 'same-id', title: 'Tenant B value' },
      { 'Idempotency-Key': 'tenant-b-same-id' },
    )).toEqual({
      status: 201,
      body: { row: { id: 'same-id', title: 'Tenant B value' } },
    });

    // The caller cannot select another tenant through headers or query input;
    // physical routing comes only from the live credential binding.
    expect(await resourceRequest(
      baseUrl,
      'GET',
      `/api/resources/todos/same-id?tenantId=${tenantB.tenant.tenantId}`,
      keyA.secret,
      undefined,
      {
        'X-Tenant-Id': tenantB.tenant.tenantId,
        'X-Zero-Tenant-Id': tenantB.tenant.tenantId,
      },
    )).toEqual({
      status: 200,
      body: { row: { id: 'same-id', title: 'Tenant A value' } },
    });
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos/same-id',
      keyB.secret,
    )).toEqual({
      status: 200,
      body: { row: { id: 'same-id', title: 'Tenant B value' } },
    });

    // Fabric never materializes physical Resource rows or Guardian authority
    // in the pinned application database.
    expect(applicationDB.hasTable('todos')).toBe(false);
    expect(applicationDB.hasTable('users')).toBe(false);

    // A real non-owner identity is admitted through Guardian's public tenant
    // administration API. Its viewer role can read this tenant's physical
    // database but cannot mutate it.
    const viewerIdentity = await register(baseUrl, 'viewer', 'Viewer Home');
    const viewerMembership = await jsonRequest(
      baseUrl,
      'POST',
      '/auth/tenant/members',
      tenantA.accessToken,
      { email: viewerIdentity.user.email, roles: ['viewer'] },
    );
    expect(viewerMembership).toMatchObject({
      status: 200,
      body: {
        member: {
          identity: { userId: viewerIdentity.user.userId },
          roles: ['viewer'],
        },
      },
    });
    const viewerSession = await switchTenant(
      baseUrl,
      viewerIdentity.refreshToken,
      tenantA.tenant.tenantId,
    );
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos/same-id',
      viewerSession.accessToken,
    )).toEqual({
      status: 200,
      body: { row: { id: 'same-id', title: 'Tenant A value' } },
    });
    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/todos',
      viewerSession.accessToken,
      { id: 'viewer-must-not-write', title: 'Forbidden viewer write' },
      { 'Idempotency-Key': 'viewer-write-denied' },
    )).toEqual({
      status: 403,
      body: { error: 'Forbidden', code: 'authorization-denied' },
    });

    // Role replacement advances live membership authority. The captured
    // viewer credential fails closed, while a fresh tenant switch projects
    // the editor permissions and can write through the same Resource path.
    const promoted = await jsonRequest(
      baseUrl,
      'PATCH',
      `/auth/tenant/members/${viewerMembership.body.member.membershipId}`,
      tenantA.accessToken,
      {
        roles: ['editor'],
        expectedRoleRevision: viewerMembership.body.member.roleRevision,
      },
    );
    expect(promoted).toMatchObject({
      status: 200,
      body: { member: { roles: ['editor'] } },
    });
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos/same-id',
      viewerSession.accessToken,
    )).toEqual({
      status: 401,
      body: { error: 'Unauthorized', code: 'UNAUTHORIZED' },
    });
    const editorSession = await loginToTenant(
      baseUrl,
      viewerIdentity.user.email,
      tenantA.tenant.tenantId,
    );
    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/todos',
      editorSession.accessToken,
      { id: 'editor-created', title: 'Created by editor' },
      { 'Idempotency-Key': 'editor-write-allowed' },
    )).toEqual({
      status: 201,
      body: { row: { id: 'editor-created', title: 'Created by editor' } },
    });

    const sessionOnlyDenial = await resourceRequest(
      baseUrl,
      'DELETE',
      '/api/resources/todos/same-id',
      keyA.secret,
      undefined,
      { 'Idempotency-Key': 'api-key-delete-denied' },
    );
    expect(sessionOnlyDenial).toEqual({
      status: 403,
      body: { error: 'Forbidden', code: 'FORBIDDEN' },
    });
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos/same-id',
      keyA.secret,
    )).body.row.title).toBe('Tenant A value');

    const pendingUpdate = resourceRequest(
      baseUrl,
      'PATCH',
      '/api/resources/todos/same-id',
      keyA.secret,
      { title: 'Must not commit' },
      { 'Idempotency-Key': 'revoked-in-flight-update' },
    );
    await updateBarrier.waitUntilEntered(pendingUpdate);

    let revoked: JsonResponse;
    try {
      revoked = await jsonRequest(
        baseUrl,
        'DELETE',
        `/auth/api-keys/${keyA.apiKey.keyId}`,
        tenantA.accessToken,
      );
    } finally {
      // A failed management request must not leave the actor test process
      // waiting on the policy barrier during test cleanup.
      updateBarrier.release();
    }
    expect(revoked).toMatchObject({
      status: 200,
      body: { status: 'revoked' },
    });

    expect(await pendingUpdate).toEqual({
      status: 403,
      body: {
        error: 'Resource authorization changed during the request',
        code: 'resource-authority-changed',
      },
    });
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos/same-id',
      tenantA.accessToken,
    )).toEqual({
      status: 200,
      body: { row: { id: 'same-id', title: 'Tenant A value' } },
    });
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos/same-id',
      keyA.secret,
    )).toEqual({
      status: 401,
      body: { error: 'Unauthorized', code: 'UNAUTHORIZED' },
    });
  }, 60_000);
});

interface OwnedTaskDatabaseSnapshot {
  readonly task: {
    readonly task_id: string;
    readonly title: string;
    readonly status: string;
    readonly created_at: number;
    readonly created_by_user_id: string;
    readonly assigned_membership_id: string;
  };
  readonly tables: readonly string[];
  readonly tableColumns: Readonly<Record<string, readonly string[]>>;
  readonly userIds: readonly string[];
  readonly memberships: readonly {
    readonly membership_id: string;
    readonly tenant_id: string;
    readonly user_id: string;
  }[];
  readonly taskForeignKeys: readonly {
    readonly table: string;
    readonly from: string;
    readonly to: string;
    readonly on_delete: string;
  }[];
}

const PROOF_TENANT_DATABASE_COLUMNS = Object.freeze({
  _change_sequence: ['singleton', 'seq'],
  _changes: [
    'seq',
    'tbl',
    'op',
    'row_id',
    'data',
    'previous_data',
    'ts',
    'origin',
    'format_version',
  ],
  _migrations: ['version', 'description', 'applied_at', 'checksum', 'duration_ms'],
  _zero_database_binding_v1: [
    'singleton',
    'format_version',
    'database_ref',
    'instance_id',
    'realm_name',
  ],
  _zero_database_operation_receipts: [
    'receipt_key',
    'realm_fingerprint',
    'operation_fingerprint',
    'receipt_state',
    'result_json',
    'final_seq',
    'result_version',
    'schema_version',
    'created_at',
    'insertion_ordinal',
  ],
  _zero_database_receipt_stats_v1: [
    'singleton',
    'schema_version',
    'total_keys',
    'retained_results',
    'retained_result_bytes',
  ],
  _zero_identity_projection_receipts: [
    'event_id',
    'target_id',
    'sequence',
    'anchor_fingerprint',
    'applied_at',
  ],
  _zero_identity_projection_state: [
    'singleton',
    'installation_id',
    'target_id',
    'status',
    'watermark',
    'quarantine_code',
    'updated_at',
  ],
  _zero_migration_artifacts: [
    'id',
    'migration_version',
    'kind',
    'path',
    'hash',
    'created_at',
  ],
  _zero_migrations: [
    'id',
    'version',
    'description',
    'checksum',
    'safety',
    'direction',
    'batch',
    'status',
    'applied_at',
    'duration_ms',
    'error',
    'schema_hash',
  ],
  _zero_schema_history: [
    'id',
    'migration_version',
    'direction',
    'schema_hash',
    'schema_json',
    'created_at',
  ],
  _zero_sync_log_state: [
    'singleton',
    'schema_version',
    'write_format',
    'min_reader_format',
    'seq',
    'prune_through',
  ],
  sqlite_sequence: ['name', 'seq'],
  sqlite_stat1: ['tbl', 'idx', 'stat'],
  tasks: [
    'task_id',
    'title',
    'status',
    'created_at',
    'created_by_user_id',
    'assigned_membership_id',
  ],
  tenant_memberships: ['membership_id', 'tenant_id', 'user_id'],
  users: ['user_id'],
} as const);

async function inspectOwnedTaskDatabases(
  rootDirectory: string,
): Promise<OwnedTaskDatabaseSnapshot[]> {
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  const snapshots: OwnedTaskDatabaseSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sqlite')) continue;
    // SQLite may need to recover/remove its WAL sidecars after the actor exits;
    // open normally while issuing read-only statements in this test process.
    const database = new Database(join(rootDirectory, entry.name), { strict: true });
    try {
      const tables = database.query(
        "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
      ).all().map((row) => (row as { name: string }).name);
      if (!tables.includes('tasks')) continue;
      const tasks = database.query(`
        SELECT task_id, title, status, created_at,
          created_by_user_id, assigned_membership_id
        FROM tasks
        ORDER BY task_id
      `).all() as OwnedTaskDatabaseSnapshot['task'][];
      if (tasks.length === 0) continue;
      expect(tasks).toHaveLength(1);
      const tableColumns = Object.fromEntries(
        tables.map((table) => [table, readColumnNames(database, table)]),
      );

      snapshots.push({
        task: tasks[0]!,
        tables,
        tableColumns,
        userIds: (database.query(
          'SELECT user_id FROM users ORDER BY user_id',
        ).all() as { user_id: string }[]).map((row) => row.user_id),
        memberships: database.query(`
          SELECT membership_id, tenant_id, user_id
          FROM tenant_memberships
          ORDER BY membership_id
        `).all() as OwnedTaskDatabaseSnapshot['memberships'],
        taskForeignKeys: database.query(
          'PRAGMA foreign_key_list("tasks")',
        ).all() as OwnedTaskDatabaseSnapshot['taskForeignKeys'],
      });
    } finally {
      database.close();
    }
  }
  return snapshots;
}

function assertOwnedTaskDatabase(
  snapshot: OwnedTaskDatabaseSnapshot | undefined,
  registration: Registration,
  task: {
    readonly task_id: string;
    readonly title: string;
    readonly status: string;
    readonly created_at: number;
  },
): void {
  expect(snapshot).toBeDefined();
  expect(snapshot!.task).toEqual({
    ...task,
    created_by_user_id: registration.user.userId,
    assigned_membership_id: registration.tenant.membershipId,
  });
  expect(snapshot!.tables).toEqual(
    Object.keys(PROOF_TENANT_DATABASE_COLUMNS).sort(),
  );
  expect(snapshot!.tableColumns).toEqual(PROOF_TENANT_DATABASE_COLUMNS);
  expect(snapshot!.userIds).toContain(registration.user.userId);
  expect(snapshot!.memberships).toContainEqual({
    membership_id: registration.tenant.membershipId,
    tenant_id: registration.tenant.tenantId,
    user_id: registration.user.userId,
  });
  expect(snapshot!.taskForeignKeys).toEqual(expect.arrayContaining([
    expect.objectContaining({
      table: 'users',
      from: 'created_by_user_id',
      to: 'user_id',
      on_delete: 'RESTRICT',
    }),
    expect.objectContaining({
      table: 'tenant_memberships',
      from: 'assigned_membership_id',
      to: 'membership_id',
      on_delete: 'RESTRICT',
    }),
  ]));
}

function readColumnNames(database: Database, table: string): string[] {
  return (database.query(`PRAGMA table_info("${table}")`).all() as { name: string }[])
    .map((column) => column.name);
}

function hasSqliteTable(sqlite: PlatformSQLiteService, table: string): boolean {
  return Boolean(sqlite.raw.query(
    "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(table));
}

function expectServerTimestampWithinRequest(
  value: unknown,
  requestStartedAt: number,
  requestFinishedAt: number,
): number {
  const isSafeTimestamp = typeof value === 'number' && Number.isSafeInteger(value);
  expect(isSafeTimestamp).toBe(true);
  if (!isSafeTimestamp) {
    throw new TypeError(`Expected a safe integer server timestamp; received ${String(value)}`);
  }
  expect(value).toBeGreaterThanOrEqual(requestStartedAt);
  expect(value).toBeLessThanOrEqual(requestFinishedAt);
  return value;
}

async function setupProofApp(
  prefix: string,
  events?: MemoryEventStore,
): Promise<ProofAppHarness> {
  const zeroDir = join(process.cwd(), '.zero');
  await mkdir(zeroDir, { recursive: true });
  activeRoot = await mkdtemp(join(zeroDir, prefix));

  const paths = {
    applicationDatabase: join(activeRoot, 'application.db'),
    systemDatabase: join(activeRoot, 'system.db'),
    tenantDatabases: join(activeRoot, 'tenant-databases'),
    app: join(activeRoot, 'app'),
    storage: join(activeRoot, 'storage'),
    generated: join(activeRoot, '.zero', 'generated'),
    output: join(activeRoot, 'out'),
  } as const;
  await mkdir(paths.app, { recursive: true });

  const applicationSqlite = createPlatformSQLiteService({
    mode: 'file',
    path: paths.applicationDatabase,
  });
  const systemSqlite = createPlatformSQLiteService({
    mode: 'file',
    path: paths.systemDatabase,
  });
  activeSqliteServices.push(applicationSqlite, systemSqlite);

  const app = await createApp(createGuardianFabricProofConfig({
    port: 3100,
    publicUrl: 'http://localhost:3100',
    bootstrap: { mode: 'secret', secret: PROOF_BOOTSTRAP_SECRET },
    actorEntrypoint: GUARDIAN_PROOF_ACTOR_ENTRYPOINT,
    paths,
    sqlite: {
      application: applicationSqlite,
      system: systemSqlite,
    },
    observability: {
      console: false,
      endpoint: false,
      ...(events ? { store: events } : {}),
    },
  }));

  return {
    app,
    applicationSqlite,
    systemSqlite,
    tenantDatabaseRoot: paths.tenantDatabases,
  };
}

/** Minimal same-handle adapter for deterministic outbox lease control. */
function reactiveStoreAdapter(sqlite: PlatformSQLiteService): ReactiveDB {
  return {
    exec: (sql: string) => sqlite.raw.exec(sql),
    prepare: (sql: string) => sqlite.raw.prepare(sql),
    transaction: <T>(operation: () => T) => sqlite.raw.transaction(operation)(),
  } as unknown as ReactiveDB;
}

function installDefaultDatabaseProbe(app: ManagedApp): {
  resolve(baseUrl: string): Promise<ReactiveDB>;
} {
  const path = `/__zero_test/default-database-${crypto.randomUUID()}`;
  let captured: ReactiveDB | null = null;
  app.get(path, (context) => {
    captured = (context as unknown as { syncDB?: ReactiveDB }).syncDB ?? null;
    return { ready: captured !== null };
  });
  return {
    async resolve(baseUrl) {
      for (let attempt = 0; attempt < 100; attempt++) {
        await fetch(`${baseUrl}${path}`);
        if (captured) return captured;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error('Timed out waiting for the default database');
    },
  };
}

function installTokenServiceProbe(app: ManagedApp): {
  resolve(baseUrl: string): Promise<TokenService>;
} {
  const path = `/__zero_test/token-service-${crypto.randomUUID()}`;
  let captured: TokenService | null = null;
  app.get(path, (context) => {
    captured = (context as unknown as { tokenService?: TokenService }).tokenService ?? null;
    return { ready: captured !== null };
  });
  return {
    async resolve(baseUrl) {
      for (let attempt = 0; attempt < 100; attempt++) {
        await fetch(`${baseUrl}${path}`);
        if (captured) return captured;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error('Timed out waiting for the auth token service');
    },
  };
}

async function tenantDatabaseFiles(rootDirectory: string): Promise<string[]> {
  try {
    return (await readdir(rootDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function createUpdateBarrier(): {
  readonly policy: ReturnType<typeof customPolicy>;
  waitUntilEntered(pending: Promise<JsonResponse>): Promise<void>;
  release(): void;
} {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const policy = customPolicy(async () => {
    markEntered();
    await released;
    return true;
  }, { name: 'guardian-api-key-revocation-race' });

  return {
    policy,
    async waitUntilEntered(pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          entered,
          pending.then((response) => {
            throw new Error(
              `Resource request completed before the policy barrier: ${JSON.stringify(response)}`,
            );
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Timed out waiting for the Resource policy barrier')),
              10_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    release,
  };
}

async function register(
  baseUrl: string,
  label: string,
  organizationName: string,
  bootstrapSecret?: string,
): Promise<Registration> {
  const suffix = crypto.randomUUID();
  const response = await jsonRequest(baseUrl, 'POST', '/auth/register', undefined, {
    username: `${label}-${suffix}`,
    email: `${label}-${suffix}@example.test`,
    password: TEST_PASSWORD,
    organizationName: `${organizationName} ${suffix}`,
    ...(bootstrapSecret ? { bootstrapSecret } : {}),
  });
  expect(response.status).toBe(200);
  expect(response.body.accessToken).toBeString();
  expect(response.body.tenant?.tenantId).toBeString();
  return response.body as Registration;
}

async function issueApiKey(
  baseUrl: string,
  registration: Registration,
  label: string,
): Promise<IssuedApiKey> {
  return issueApiKeyWithToken(baseUrl, registration.accessToken, label);
}

async function issueApiKeyWithToken(
  baseUrl: string,
  accessToken: string,
  label: string,
): Promise<IssuedApiKey> {
  const response = await jsonRequest(
    baseUrl,
    'POST',
    '/auth/api-keys',
    accessToken,
    { label },
  );
  expect(response.status).toBe(200);
  expect(response.body.secret).toBeString();
  return response.body as IssuedApiKey;
}

async function loginToTenant(
  baseUrl: string,
  username: string,
  tenantId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const login = await jsonRequest(baseUrl, 'POST', '/auth/login', undefined, {
    username,
    password: TEST_PASSWORD,
  });
  expect(login).toMatchObject({
    status: 200,
    body: { tenantSelectionRequired: true },
  });
  expect(login.body.tenantSelection?.continuation).toBeString();
  const selected = await jsonRequest(baseUrl, 'POST', '/auth/tenants/select', undefined, {
    continuation: login.body.tenantSelection.continuation,
    tenantId,
  });
  expect(selected.status).toBe(200);
  expect(selected.body.accessToken).toBeString();
  expect(selected.body.refreshToken).toBeString();
  return selected.body as { accessToken: string; refreshToken: string };
}

async function switchTenant(
  baseUrl: string,
  refreshToken: string,
  tenantId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await jsonRequest(baseUrl, 'POST', '/auth/tenants/switch', undefined, {
    refreshToken,
    tenantId,
  });
  expect(response.status).toBe(200);
  expect(response.body.accessToken).toBeString();
  expect(response.body.refreshToken).toBeString();
  return response.body as { accessToken: string; refreshToken: string };
}

function subscribeTasks(connection: SyncConnection): void {
  connection.ws.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: ['tasks'],
    snapshot: ['tasks'],
    lastSeq: 0,
  }));
}

async function waitForTaskSnapshot(
  connection: SyncConnection,
): Promise<SyncSnapshotMessage> {
  const first = await connection.waitFor(
    (candidate) => (
      candidate.type === 'sync.snapshot'
      || candidate.type === 'sync.snapshot.begin'
    ) && candidate.plane === 'tenant',
    'tenant task snapshot',
  );
  if (first.type === 'sync.snapshot') return first;
  if (first.type !== 'sync.snapshot.begin') {
    throw new Error('Expected a tenant task snapshot');
  }
  const begin = first;
  const end = await connection.waitFor(
    (candidate) => candidate.type === 'sync.snapshot.end'
      && candidate.plane === 'tenant'
      && candidate.snapshotId === begin.snapshotId,
    'tenant task snapshot completion',
  );
  if (end.type !== 'sync.snapshot.end') {
    throw new Error('Expected a tenant task snapshot completion');
  }
  const tables: SyncSnapshotMessage['tables'] = Object.create(null);
  for (const table of begin.tables) tables[table] = Object.create(null);
  for (const candidate of connection.messages) {
    if (candidate.type !== 'sync.snapshot.chunk'
      || candidate.snapshotId !== begin.snapshotId) continue;
    Object.assign(tables[candidate.table] ??= Object.create(null), candidate.rows);
  }
  return {
    type: 'sync.snapshot',
    plane: 'tenant',
    tables,
    seq: begin.seq,
    ...(begin.epoch === undefined ? {} : { epoch: begin.epoch }),
    ...(begin.scope === undefined ? {} : { scope: begin.scope }),
    reset: begin.reset,
  };
}

async function waitForTaskChange(
  connection: SyncConnection,
  taskId: string,
  title: string,
): Promise<void> {
  const change = await connection.waitFor(
    (message) => message.type === 'sync.change'
      && message.plane === 'tenant'
      && message.table === 'tasks'
      && message.rowId === taskId
      && message.row?.title === title,
    `realtime task change ${taskId}`,
  );
  expect(change).toMatchObject({
    type: 'sync.change',
    plane: 'tenant',
    op: 'INSERT',
    rowId: taskId,
    row: { title },
  });
}

async function waitForTaskMutation(
  connection: SyncConnection,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  taskId: string,
  title?: string,
  status?: string,
): Promise<void> {
  const change = await connection.waitFor(
    (message) => message.type === 'sync.change'
      && message.plane === 'tenant'
      && message.table === 'tasks'
      && message.op === operation
      && message.rowId === taskId
      && (title === undefined || message.row?.title === title)
      && (status === undefined || message.row?.status === status),
    `realtime task ${operation.toLowerCase()} ${taskId}`,
  );
  expect(change).toMatchObject({
    type: 'sync.change',
    plane: 'tenant',
    op: operation,
    rowId: taskId,
    ...(operation === 'DELETE'
      ? { row: null }
      : {
          row: {
            ...(title === undefined ? {} : { title }),
            ...(status === undefined ? {} : { status }),
          },
        }),
  });
}

async function connectSync(url: string, token: string): Promise<SyncConnection> {
  const messages: ServerMessage[] = [];
  const waiters = new Set<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(message);
    }
  };
  ws.addEventListener('close', (event) => {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(
        `WebSocket closed (${event.code}: ${event.reason || 'no reason'})`,
      ));
    }
    waiters.clear();
  });

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  let closeTask: Promise<void> | null = null;
  const connection: SyncConnection = {
    ws,
    messages,
    waitFor(predicate, description) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(
              `Timed out waiting for ${description}; received ${JSON.stringify(messages)}`,
            ));
          }, 8_000),
        };
        waiters.add(waiter);
      });
    },
    close() {
      if (closeTask) return closeTask;
      activeConnections.delete(connection);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('WebSocket closed'));
      }
      waiters.clear();
      if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
      closeTask = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        ws.addEventListener('close', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        ws.close();
      });
      return closeTask;
    },
  };

  activeConnections.add(connection);
  ws.send(JSON.stringify({ type: 'sync.auth', token }));
  await connection.waitFor(
    (message) => message.type === 'sync.auth.ready' && message.authenticated,
    'authenticated Sync handshake',
  );
  return connection;
}

async function resourceRequest(
  baseUrl: string,
  method: string,
  path: string,
  bearer: string,
  body?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<JsonResponse> {
  return jsonRequest(baseUrl, method, path, bearer, body, extraHeaders);
}

async function waitForDataRealmReady(
  baseUrl: string,
  accessToken: string,
): Promise<JsonResponse> {
  const deadline = Date.now() + 15_000;
  let response = await jsonRequest(
    baseUrl,
    'GET',
    '/auth/data-realm/readiness',
    accessToken,
  );
  do {
    if (response.status === 200
      && (response.body.status === 'ready'
        || response.body.status === 'failed')) return response;
    if (response.status !== 200
      && response.body.code !== 'DATA_REALM_NOT_READY') return response;
    const pollAfterMs = typeof response.body.pollAfterMs === 'number'
      ? response.body.pollAfterMs
      : 250;
    await new Promise((resolve) => setTimeout(resolve, pollAfterMs));
    response = await jsonRequest(
      baseUrl,
      'POST',
      '/auth/data-realm/readiness/retry',
      accessToken,
    );
  } while (Date.now() < deadline);
  return response;
}

async function jsonRequest(
  baseUrl: string,
  method: string,
  path: string,
  bearer?: string,
  body?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<JsonResponse> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, any> : {},
  };
}
