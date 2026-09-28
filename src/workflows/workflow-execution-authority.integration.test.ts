import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Elysia, type AnyElysia } from 'elysia';
import type { AuthRuntime } from '../auth/auth-runtime';
import { createAuthPlugin } from '../auth/auth.plugin';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { WorkflowRegistry } from './workflow-registry';
import type { WorkflowService } from './workflow-service';
import { createWorkflowPlugin } from './workflow.plugin';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  workflows: WorkflowService;
  url: string;
}

interface Registration {
  accessToken: string;
  user: { userId: string };
  tenant: { tenantId: string; membershipId: string };
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

describe('durable workflow execution authority', () => {
  test('rejects stale async output after live tenant authority changes', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let observedTenant: string | null = null;
    const harness = await startHarness({
      register(registry) {
        registry.registerHandler('gated', async (context) => {
          observedTenant = context.execution.tenantId;
          expect(context.input).toEqual({ recordId: 'record-1' });
          expect(context.workflowInput).toEqual({ recordId: 'record-1' });
          expect(context.zero).toMatchObject({ tenantId: context.execution.tenantId });
          entered.resolve();
          await release.promise;
          return { stale: true };
        });
        registry.create({
          name: 'gated-authority',
          steps: [{ name: 'Gated', handler: 'gated' }],
        });
      },
    });
    const actor = await register(harness, 'authority-owner', 'Authority Org');

    const pending = post(harness, '/workflows', actor.accessToken, {
      name: 'gated-authority',
      input: { recordId: 'record-1' },
    });
    await entered.promise;
    expect(String(observedTenant)).toBe(actor.tenant.tenantId);
    const persistedSeal = harness.db.prepare(`SELECT authority_json
      FROM _workflow_execution_authorities WHERE actor_user_id = ?`)
      .get(actor.user.userId) as { authority_json: string };
    expect(persistedSeal.authority_json).not.toContain(actor.accessToken);
    expect(persistedSeal.authority_json).not.toContain('refreshToken');

    harness.runtime.getTenancyService()!
      .bumpMembershipAuthorizationGeneration(actor.tenant.membershipId);
    release.resolve();

    const started = await pending;
    expect(started.status).toBe(200);
    const instanceId = String(started.body.instanceId);
    expect(harness.workflows.getInstance(instanceId, tenantScope(actor))).toMatchObject({
      status: 'failed',
      error: 'Workflow execution authority is no longer valid',
      output: null,
    });
    expect(harness.workflows.getSteps(instanceId, tenantScope(actor))[0]).toMatchObject({
      status: 'failed',
      output: null,
      retry_at: null,
    });
    expect(harness.db.prepare(`SELECT status, invalidation_reason
      FROM _workflow_execution_authorities WHERE instance_id = ?`)
      .get(instanceId)).toEqual({
        status: 'invalid',
        invalidation_reason: 'authority-revoked',
      });
  });

  test('hides guessed instance ids across tenants and prevents tenant swapping', async () => {
    const harness = await startHarness({
      register(registry) {
        registry.registerHandler('approval', async ({ waitEvent, execution }) => ({
          tenantId: execution.tenantId,
          approved: waitEvent?.payload,
        }));
        registry.create({
          name: 'tenant-approval',
          steps: [{ name: 'Approval', handler: 'approval', waitFor: 'approved' }],
        });
      },
    });
    const alpha = await register(harness, 'alpha-owner', 'Alpha Org');
    const beta = await register(harness, 'beta-owner', 'Beta Org');

    const created = await post(harness, '/workflows', alpha.accessToken, {
      name: 'tenant-approval',
      input: { tenantId: beta.tenant.tenantId },
    });
    expect(created.status).toBe(200);
    const instanceId = String(created.body.instanceId);

    expect((await get(harness, `/workflows/${instanceId}`, beta.accessToken)).status)
      .toBe(404);
    expect((await post(
      harness,
      `/workflows/${instanceId}/events`,
      beta.accessToken,
      { eventName: 'approved', payload: true },
    )).status).toBe(404);

    const accepted = await post(
      harness,
      `/workflows/${instanceId}/events`,
      alpha.accessToken,
      { eventName: 'approved', payload: true },
    );
    expect(accepted).toMatchObject({ status: 200, body: { ok: true, matched: true } });
    expect(harness.workflows.getInstance(instanceId, tenantScope(alpha))).toMatchObject({
      tenant_id: alpha.tenant.tenantId,
      status: 'completed',
    });
    const output = JSON.parse(String(
      harness.workflows.getInstance(instanceId, tenantScope(alpha))!.output,
    ));
    expect(output).toEqual({ tenantId: alpha.tenant.tenantId, approved: true });
  });

  test('preserves the sealed actor context across restart and retry', async () => {
    const raw = new Database(':memory:');
    let attempt = 0;
    const registerRetry = (registry: WorkflowRegistry) => {
      registry.registerHandler('retry-after-restart', async ({ execution }) => {
        attempt += 1;
        if (attempt === 1) throw new Error('retry me');
        return { tenantId: execution.tenantId, attempt };
      });
      registry.create({
        name: 'restart-retry',
        steps: [{
          name: 'Retry after restart',
          handler: 'retry-after-restart',
          retries: 2,
        }],
      });
    };

    const first = await startHarness({ database: raw, register: registerRetry });
    const actor = await register(first, 'restart-owner', 'Restart Org');
    const created = await post(first, '/workflows', actor.accessToken, {
      name: 'restart-retry',
      input: { durable: true },
    });
    const instanceId = String(created.body.instanceId);
    expect(first.workflows.getSteps(instanceId, tenantScope(actor))[0]).toMatchObject({
      status: 'failed',
      retries: 1,
    });
    await stopHarness(first);

    const second = await startHarness({ database: raw, register: registerRetry });
    second.db.update('workflow_steps',
      String(second.workflows.getSteps(instanceId, tenantScope(actor))[0]!.step_id), {
        retry_at: new Date(0).toISOString(),
      });
    expect(await second.workflows.pollRetries()).toBe(1);
    const completed = second.workflows.getInstance(instanceId, tenantScope(actor));
    expect(completed).toMatchObject({ status: 'completed' });
    expect(JSON.parse(String(completed!.output))).toEqual({
      tenantId: actor.tenant.tenantId,
      attempt: 2,
    });
    await stopHarness(second);
    raw.close();
  });

  test('fails a scheduled retry before dispatch when its parent session was revoked', async () => {
    let attempts = 0;
    const harness = await startHarness({
      register(registry) {
        registry.registerHandler('retry-revoked', async () => {
          attempts += 1;
          throw new Error('transient');
        });
        registry.create({
          name: 'retry-revoked',
          steps: [{ name: 'Retry', handler: 'retry-revoked', retries: 3 }],
        });
      },
    });
    const actor = await register(harness, 'retry-owner', 'Retry Org');
    const created = await post(harness, '/workflows', actor.accessToken, {
      name: 'retry-revoked',
      input: {},
    });
    const instanceId = String(created.body.instanceId);
    const step = harness.workflows.getSteps(instanceId, tenantScope(actor))[0]!;
    expect(step).toMatchObject({ status: 'failed', retries: 1 });
    expect(attempts).toBe(1);

    const context = await harness.runtime.getTokenService()!
      .resolveAuthContext(actor.accessToken);
    expect(context?.sessionId).toBeString();
    harness.runtime.getAuthSessionService()!.revoke(
      context!.sessionId!,
      'workflow-test-revocation',
    );
    harness.db.update('workflow_steps', step.step_id, {
      retry_at: new Date(0).toISOString(),
    });

    expect(await harness.workflows.pollRetries()).toBe(1);
    expect(attempts).toBe(1);
    expect(harness.workflows.getInstance(instanceId, tenantScope(actor))).toMatchObject({
      status: 'failed',
      error: 'Workflow execution authority is no longer valid',
    });
  });

  test('fails closed without invoking a waiting handler when its private seal is corrupt', async () => {
    let calls = 0;
    const harness = await startHarness({
      register(registry) {
        registry.registerHandler('sealed-wait', async () => {
          calls += 1;
          return { shouldNotCommit: true };
        });
        registry.create({
          name: 'sealed-wait',
          steps: [{ name: 'Wait', handler: 'sealed-wait', waitFor: 'continue' }],
        });
      },
    });
    const actor = await register(harness, 'seal-owner', 'Seal Org');
    const created = await post(harness, '/workflows', actor.accessToken, {
      name: 'sealed-wait',
      input: {},
    });
    const instanceId = String(created.body.instanceId);
    harness.db.prepare(`UPDATE _workflow_execution_authorities
      SET authority_json = authority_json || ' ' WHERE instance_id = ?`)
      .run(instanceId);

    const event = await post(
      harness,
      `/workflows/${instanceId}/events`,
      actor.accessToken,
      { eventName: 'continue' },
    );
    expect(event.status).toBe(200);
    expect(calls).toBe(0);
    expect(harness.workflows.getInstance(instanceId, tenantScope(actor))).toMatchObject({
      status: 'failed',
      error: 'Workflow execution authority is no longer valid',
    });
    expect(harness.db.prepare(`SELECT invalidation_reason
      FROM _workflow_execution_authorities WHERE instance_id = ?`)
      .get(instanceId)).toEqual({ invalidation_reason: 'authority-seal-invalid' });
  });
});

async function startHarness(options: {
  database?: Database;
  register: (registry: WorkflowRegistry) => void;
}): Promise<Harness> {
  const db = options.database
    ? createReactiveDB({ database: options.database })
    : createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  let workflows: WorkflowService | null = null;
  const app = new Elysia()
    .use(createAuthPlugin({
      db,
      tenancy: 'multi',
      bootstrap: 'public',
      registration: { mode: 'public' },
      onRuntimeCreated(created) { runtime = created; },
    }))
    .use(createWorkflowPlugin({
      db,
      ensureAuthReady: async () => { await runtime!.start(); },
      getTokenService: () => runtime?.getTokenService() ?? null,
      authorization: {
        getAuthorizationKernel: () => runtime?.getAuthorizationKernel() ?? null,
        getPropertyStore: () => runtime?.getStore() ?? null,
        getRoleAssignments: () => runtime?.getAuthorizationRoleService() ?? null,
      },
      executionServices: {
        createServices({ authority, assertCurrentAuthority }) {
          return Object.freeze({
            tenantId: authority.scope.tenantId,
            assertCurrentAuthority,
          });
        },
      },
      onRegistryCreated: options.register,
      onServiceCreated(service) { workflows = service; },
    }));
  app.listen(0);
  const deadline = Date.now() + 5_000;
  const currentRuntime = () => runtime as AuthRuntime | null;
  const currentWorkflows = () => workflows as WorkflowService | null;
  while (!currentRuntime()?.getTokenService() || !currentWorkflows()) {
    if (Date.now() >= deadline) throw new Error('Workflow harness did not start');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const harness: Harness = {
    app,
    db,
    runtime: currentRuntime()!,
    workflows: currentWorkflows()!,
    url: `http://localhost:${app.server!.port}`,
  };
  active.push(harness);
  return harness;
}

async function register(
  harness: Harness,
  username: string,
  organizationName: string,
): Promise<Registration> {
  const response = await fetch(`${harness.url}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@example.test`,
      password: 'password123',
      organizationName,
    }),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Registration>;
}

async function post(
  harness: Harness,
  path: string,
  token: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${harness.url}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Record<string, any>,
  };
}

async function get(harness: Harness, path: string, token: string) {
  const response = await fetch(`${harness.url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Record<string, any>,
  };
}

function tenantScope(actor: Registration) {
  return trustedSystemServiceDataScope({
    scopeKind: 'tenant',
    tenantId: actor.tenant.tenantId,
  });
}

async function stopHarness(harness: Harness): Promise<void> {
  const index = active.indexOf(harness);
  if (index >= 0) active.splice(index, 1);
  await harness.app.stop();
  harness.db.dispose();
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
