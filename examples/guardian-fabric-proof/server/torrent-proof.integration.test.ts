import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createApp,
  createPlatformSQLiteService,
  type PlatformSQLiteService,
} from '@zero/framework/server';

import { TORRENT_PROOF_WORKFLOW } from '../shared/torrent-proof';
import { createGuardianFabricProofConfig } from './proof-config';

const BOOTSTRAP_SECRET = 'torrent-proof-integration-bootstrap-secret';
const TEST_PASSWORD = 'password123';
const ACTOR_ENTRYPOINT = fileURLToPath(new URL(
  '../../../src/databases/test-fixtures/guardian-fabric-proof-actor.ts',
  import.meta.url,
));

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

interface Registration {
  readonly accessToken: string;
  readonly tenant: {
    readonly tenantId: string;
    readonly membershipId: string;
  };
  readonly user: { readonly userId: string };
}

interface InteractionProjection {
  readonly interactionId: string;
  readonly status: string;
}

let app: ManagedApp | null = null;
let scratchRoot: string | null = null;
let sqliteServices: PlatformSQLiteService[] = [];

afterEach(async () => {
  await app?.stop(true);
  app = null;
  for (const sqlite of sqliteServices.splice(0)) sqlite.close();
  if (scratchRoot) await rm(scratchRoot, { recursive: true, force: true });
  scratchRoot = null;
}, 30_000);

describe('Guardian + Fabric + Torrent executable proof', () => {
  test('approves a durable interaction and creates an attributed task in the tenant realm', async () => {
    const harness = await startProofApp();
    app = harness.app;
    const baseUrl = harness.baseUrl;

    const platform = await register(baseUrl, 'platform', 'Administration', BOOTSTRAP_SECRET);
    const actor = await register(baseUrl, 'workflow-actor', 'Workflow Tenant');
    expect(await waitForRealm(baseUrl, actor.accessToken)).toMatchObject({
      status: 200,
      body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
    });

    const taskId = `torrent-${crypto.randomUUID()}`;
    const started = await requestJson<{ instanceId: string }>(
      baseUrl,
      'POST',
      '/workflows',
      actor.accessToken,
      {
        name: TORRENT_PROOF_WORKFLOW,
        version: 1,
        input: { taskId, title: '  Created after durable approval  ' },
      },
    );
    expect(started.status).toBe(200);
    expect(started.body.instanceId).toBeString();

    const interactions = await waitForOpenInteraction(
      baseUrl,
      actor.accessToken,
      started.body.instanceId,
    );
    expect(interactions).toHaveLength(1);

    const foreignResponse = await requestJson<Record<string, unknown>>(
      baseUrl,
      'POST',
      `/workflows/${started.body.instanceId}/interactions/${interactions[0]!.interactionId}/responses`,
      platform.accessToken,
      {
        submissionId: 'foreign-proof-approval',
        channel: 'proof-web',
        payload: { approved: true },
      },
    );
    expect(foreignResponse).toMatchObject({
      status: 404,
      body: { code: 'WORKFLOW_NOT_FOUND' },
    });

    const response = await requestJson<{ outcome: string }>(
      baseUrl,
      'POST',
      `/workflows/${started.body.instanceId}/interactions/${interactions[0]!.interactionId}/responses`,
      actor.accessToken,
      {
        submissionId: 'torrent-proof-approval',
        channel: 'proof-web',
        payload: { approved: true },
      },
    );
    expect(response).toMatchObject({ status: 200, body: { outcome: 'accepted' } });

    const completed = await waitForRunStatus(
      baseUrl,
      actor.accessToken,
      started.body.instanceId,
      'completed',
    );
    expect(completed.body).toMatchObject({
      instance_id: started.body.instanceId,
      tenant_id: actor.tenant.tenantId,
      started_by: actor.user.userId,
      status: 'completed',
      definition_version: 1,
    });

    const task = await waitForTask(baseUrl, actor.accessToken, taskId);
    expect(task.body).toMatchObject({
      row: {
        task_id: taskId,
        title: 'Created after durable approval',
        status: 'open',
        created_by_user_id: actor.user.userId,
        assigned_membership_id: actor.tenant.membershipId,
      },
    });

    const declinedTaskId = `torrent-${crypto.randomUUID()}`;
    const declinedRun = await requestJson<{ instanceId: string }>(
      baseUrl,
      'POST',
      '/workflows',
      actor.accessToken,
      {
        name: TORRENT_PROOF_WORKFLOW,
        version: 1,
        input: { taskId: declinedTaskId, title: 'Never persisted' },
      },
    );
    const declinedInteraction = await waitForOpenInteraction(
      baseUrl,
      actor.accessToken,
      declinedRun.body.instanceId,
    );
    expect((await requestJson<{ outcome: string }>(
      baseUrl,
      'POST',
      `/workflows/${declinedRun.body.instanceId}/interactions/${declinedInteraction[0]!.interactionId}/responses`,
      actor.accessToken,
      {
        submissionId: 'torrent-proof-decline',
        channel: 'proof-web',
        payload: { approved: false },
      },
    )).body.outcome).toBe('accepted');
    await waitForRunStatus(
      baseUrl,
      actor.accessToken,
      declinedRun.body.instanceId,
      'completed',
    );
    expect((await requestJson<Record<string, unknown>>(
      baseUrl,
      'GET',
      `/api/resources/tasks/${declinedTaskId}`,
      actor.accessToken,
    )).status).toBe(404);
  }, 60_000);
});

async function startProofApp(): Promise<{ app: ManagedApp; baseUrl: string }> {
  const scratchParent = join(process.cwd(), '.zero');
  await mkdir(scratchParent, { recursive: true });
  scratchRoot = await mkdtemp(join(scratchParent, 'torrent-proof-'));
  const paths = {
    applicationDatabase: join(scratchRoot, 'application.db'),
    systemDatabase: join(scratchRoot, 'system.db'),
    tenantDatabases: join(scratchRoot, 'tenant-databases'),
    app: join(scratchRoot, 'app'),
    storage: join(scratchRoot, 'storage'),
    generated: join(scratchRoot, '.zero', 'generated'),
    output: join(scratchRoot, 'out'),
  } as const;
  await mkdir(paths.app, { recursive: true });

  const application = createPlatformSQLiteService({
    mode: 'file',
    path: paths.applicationDatabase,
  });
  const system = createPlatformSQLiteService({
    mode: 'file',
    path: paths.systemDatabase,
  });
  sqliteServices = [application, system];
  const proofApp = await createApp(createGuardianFabricProofConfig({
    bootstrap: { mode: 'secret', secret: BOOTSTRAP_SECRET },
    actorEntrypoint: ACTOR_ENTRYPOINT,
    paths,
    sqlite: { application, system },
    observability: { console: false, endpoint: false },
  }));
  proofApp.listen(0);
  return {
    app: proofApp,
    baseUrl: `http://localhost:${proofApp.server!.port}`,
  };
}

async function register(
  baseUrl: string,
  label: string,
  organizationName: string,
  bootstrapSecret?: string,
): Promise<Registration> {
  const suffix = crypto.randomUUID();
  const response = await requestJson<Registration>(baseUrl, 'POST', '/auth/register', undefined, {
    username: `${label}-${suffix}`,
    email: `${label}-${suffix}@example.test`,
    password: TEST_PASSWORD,
    organizationName: `${organizationName} ${suffix}`,
    ...(bootstrapSecret ? { bootstrapSecret } : {}),
  });
  expect(response.status).toBe(200);
  return response.body;
}

async function waitForRealm(baseUrl: string, token: string) {
  const deadline = Date.now() + 25_000;
  let response = await requestJson<Record<string, unknown>>(
    baseUrl,
    'GET',
    '/auth/data-realm/readiness',
    token,
  );
  while (Date.now() < deadline) {
    if (response.status === 200
      && (response.body.status === 'ready' || response.body.status === 'failed')) {
      return response;
    }
    const pollAfter = typeof response.body.pollAfterMs === 'number'
      ? response.body.pollAfterMs
      : 250;
    await new Promise((resolve) => setTimeout(resolve, pollAfter));
    response = await requestJson<Record<string, unknown>>(
      baseUrl,
      'POST',
      '/auth/data-realm/readiness/retry',
      token,
    );
  }
  throw new Error(
    `Timed out waiting for Fabric tenant realm readiness; last response: ${JSON.stringify(response)}`,
  );
}

async function waitForOpenInteraction(
  baseUrl: string,
  token: string,
  instanceId: string,
): Promise<InteractionProjection[]> {
  const response = await waitForResponse(
    () => requestJson<InteractionProjection[]>(
      baseUrl,
      'GET',
      `/workflows/${instanceId}/interactions`,
      token,
    ),
    (candidate) => candidate.status === 200
      && candidate.body.some((interaction) => interaction.status === 'open'),
    'Torrent interaction',
  );
  return response.body;
}

async function waitForRunStatus(
  baseUrl: string,
  token: string,
  instanceId: string,
  status: string,
) {
  return waitForResponse(
    () => requestJson<Record<string, unknown>>(
      baseUrl,
      'GET',
      `/workflows/${instanceId}`,
      token,
    ),
    (response) => response.status === 200 && response.body.status === status,
    `Torrent run status ${status}`,
  );
}

async function waitForTask(baseUrl: string, token: string, taskId: string) {
  return waitForResponse(
    () => requestJson<{ row?: Record<string, unknown> }>(
      baseUrl,
      'GET',
      `/api/resources/tasks/${taskId}`,
      token,
    ),
    (response) => response.status === 200 && response.body.row?.task_id === taskId,
    'approved Fabric task',
  );
}

async function waitForResponse<T>(
  operation: () => Promise<{ status: number; body: T }>,
  accepted: (response: { status: number; body: T }) => boolean,
  label: string,
): Promise<{ status: number; body: T }> {
  const deadline = Date.now() + 15_000;
  let latest = await operation();
  while (!accepted(latest) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    latest = await operation();
  }
  if (!accepted(latest)) {
    throw new Error(`Timed out waiting for ${label}; last response: ${JSON.stringify(latest)}`);
  }
  return latest;
}

async function requestJson<T>(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as T,
  };
}
