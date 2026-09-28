/**
 * workflow.plugin.test.ts
 *
 * Exercises the HTTP ownership boundary for durable workflow instances.
 * Direct WorkflowService calls remain trusted server operations; browser-facing
 * routes expose an instance only to its starter or the global platform admin.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createAuthPlugin,
  getAuthStore,
  getTokenService,
} from '../auth/auth.plugin';
import type { UserRecord } from '../auth/types';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  createWorkflowPlugin,
  getWorkflowRegistry,
  getWorkflowService,
} from './workflow.plugin';

let db: ReactiveDB;
let app: ReturnType<typeof createApp> | null = null;
let baseUrl = '';

function createApp(db: ReactiveDB) {
  return new Elysia()
    .use(createAuthPlugin({ db, bootstrap: 'public' }))
    .use(createWorkflowPlugin({ db }))
    .listen(0);
}

async function waitForPlugins(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (
      getAuthStore() &&
      getTokenService() &&
      getWorkflowRegistry() &&
      getWorkflowService()
    ) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Plugins did not start');
}

async function createUser(role = 'user'): Promise<{
  user: UserRecord;
  token: string;
}> {
  const suffix = crypto.randomUUID();
  const user = await getAuthStore()!.createUser({
    username: `${role}_${suffix}`,
    email: `${role}_${suffix}@test.local`,
    password: 'password123',
    role,
  });
  const tokens = await getTokenService()!.issueTokenPair(user);
  return { user, token: tokens.accessToken };
}

async function requestJson<T = Record<string, unknown>>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data: data as T };
}

async function startWorkflow(token: string): Promise<string> {
  const response = await requestJson<{ instanceId: string }>(
    'POST',
    '/workflows',
    token,
    { name: 'authorization-test', input: { source: 'test' } },
  );
  expect(response.status).toBe(200);
  return response.data.instanceId;
}

beforeAll(async () => {
  db = createReactiveDB({ mode: 'memory' });
  app = createApp(db);
  baseUrl = `http://localhost:${app.server!.port}`;
  await waitForPlugins();

  const registry = getWorkflowRegistry()!;
  registry.registerHandler('await-approval', async ({ waitEvent }) => ({
    approved: waitEvent?.payload ?? null,
  }));
  registry.create({
    name: 'authorization-test',
    steps: [{
      name: 'Await approval',
      handler: 'await-approval',
      waitFor: 'approval',
    }],
  });
});

afterAll(async () => {
  await app?.stop();
  app = null;
  expect(getWorkflowRegistry()).toBeNull();
  expect(getWorkflowService()).toBeNull();
  db.dispose();
});

describe('workflow HTTP authorization', () => {
  test('lists only the caller workflows while global admins retain the full list', async () => {
    const owner = await createUser();
    const other = await createUser();
    const admin = await createUser('admin');
    const ownerInstanceId = await startWorkflow(owner.token);
    const otherInstanceId = await startWorkflow(other.token);

    const ownerList = await requestJson<Array<Record<string, unknown>>>(
      'GET',
      '/workflows',
      owner.token,
    );
    expect(ownerList.status).toBe(200);
    expect(ownerList.data.some((row) => row.instance_id === ownerInstanceId)).toBe(true);
    expect(ownerList.data.some((row) => row.instance_id === otherInstanceId)).toBe(false);
    expect(ownerList.data.every((row) => row.started_by === owner.user.userId)).toBe(true);

    const adminList = await requestJson<Array<Record<string, unknown>>>(
      'GET',
      '/workflows',
      admin.token,
    );
    expect(adminList.status).toBe(200);
    expect(adminList.data.some((row) => row.instance_id === ownerInstanceId)).toBe(true);
    expect(adminList.data.some((row) => row.instance_id === otherInstanceId)).toBe(true);
  });

  test('limits instance, step, and event reads to the owner or global admin', async () => {
    const owner = await createUser();
    const other = await createUser();
    const admin = await createUser('admin');
    const instanceId = await startWorkflow(owner.token);

    const ownerInstance = await requestJson<Record<string, unknown>>(
      'GET',
      `/workflows/${instanceId}`,
      owner.token,
    );
    expect(ownerInstance.status).toBe(200);
    expect(ownerInstance.data).toMatchObject({
      instance_id: instanceId,
      started_by: owner.user.userId,
    });

    for (const suffix of ['', '/steps', '/events']) {
      const denied = await requestJson<Record<string, unknown>>(
        'GET',
        `/workflows/${instanceId}${suffix}`,
        other.token,
      );
      expect(denied.status).toBe(404);

      const allowed = await requestJson(
        'GET',
        `/workflows/${instanceId}${suffix}`,
        admin.token,
      );
      expect(allowed.status).toBe(200);
    }
  });

  test('prevents another user from sending events or controlling lifecycle', async () => {
    const owner = await createUser();
    const other = await createUser();
    const admin = await createUser('admin');
    const eventInstanceId = await startWorkflow(owner.token);

    const deniedEvent = await requestJson(
      'POST',
      `/workflows/${eventInstanceId}/events`,
      other.token,
      { eventName: 'approval', payload: { approved: false } },
    );
    expect(deniedEvent.status).toBe(404);
    expect(getWorkflowService()!.getEvents(eventInstanceId)).toHaveLength(0);

    const ownerEvent = await requestJson<{ ok: boolean; matched: boolean }>(
      'POST',
      `/workflows/${eventInstanceId}/events`,
      owner.token,
      { eventName: 'approval', payload: { approved: true } },
    );
    expect(ownerEvent).toEqual({
      status: 200,
      data: { ok: true, matched: true },
    });

    const lifecycleInstanceId = await startWorkflow(owner.token);
    const deniedPause = await requestJson(
      'POST',
      `/workflows/${lifecycleInstanceId}/pause`,
      other.token,
    );
    expect(deniedPause.status).toBe(404);
    expect(getWorkflowService()!.getInstance(lifecycleInstanceId)?.status).toBe('running');

    const ownerPause = await requestJson(
      'POST',
      `/workflows/${lifecycleInstanceId}/pause`,
      owner.token,
    );
    expect(ownerPause).toEqual({ status: 200, data: { ok: true } });

    const adminResume = await requestJson(
      'POST',
      `/workflows/${lifecycleInstanceId}/resume`,
      admin.token,
    );
    expect(adminResume).toEqual({ status: 200, data: { ok: true } });

    const deniedCancel = await requestJson(
      'POST',
      `/workflows/${lifecycleInstanceId}/cancel`,
      other.token,
    );
    expect(deniedCancel.status).toBe(404);
    expect(getWorkflowService()!.getInstance(lifecycleInstanceId)?.status).toBe('running');

    const adminCancel = await requestJson(
      'POST',
      `/workflows/${lifecycleInstanceId}/cancel`,
      admin.token,
    );
    expect(adminCancel).toEqual({ status: 200, data: { ok: true } });
    expect(getWorkflowService()!.getInstance(lifecycleInstanceId)?.status).toBe('cancelled');
  });
});
