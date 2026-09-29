import { describe, expect, test } from 'bun:test';

import { createNotificationPlugin } from '../notifications/notification.plugin';
import { createRoomPlugin } from '../rooms/room.plugin';
import { createSchedulerPlugin } from '../scheduler/scheduler.plugin';
import { createStoragePlugin } from '../storage/storage.plugin';
import type { StorageAdapter } from '../storage/types';
import { createReactiveDB } from '../sync/reactive-db';
import { AuthError } from './types';

const FIXTURE_PATH = '/__auth-error-response-fixture';
const ACTIONABLE_MESSAGE = 'Complete the required tenant selection';
const PRIVATE_MESSAGE = 'private-auth-diagnostic user@example.test token=private-token';

interface BoundaryApp {
  handle(request: Request): Response | Promise<Response>;
}

function throwFixture(kind: string): never {
  if (kind === 'actionable') {
    throw new AuthError(ACTIONABLE_MESSAGE, 'TENANT_REQUIRED', 422);
  }

  throw new AuthError(PRIVATE_MESSAGE, 'AUTH_STATE_INVARIANT_FAILED', 503);
}

async function expectSafeAuthErrorBoundary(
  app: BoundaryApp,
  prefix: string,
): Promise<void> {
  const actionable = await app.handle(new Request(
    `http://zero.test${prefix}${FIXTURE_PATH}/actionable`,
  ));
  expect(actionable.status).toBe(422);
  expect(await actionable.json()).toEqual({
    error: ACTIONABLE_MESSAGE,
    code: 'TENANT_REQUIRED',
  });

  const internal = await app.handle(new Request(
    `http://zero.test${prefix}${FIXTURE_PATH}/internal`,
  ));
  expect(internal.status).toBe(503);
  const body = await internal.json();
  expect(body).toEqual({
    error: 'Authentication service unavailable',
    code: 'AUTH_STATE_INVARIANT_FAILED',
  });
  expect(JSON.stringify(body)).not.toContain('private-auth-diagnostic');
  expect(JSON.stringify(body)).not.toContain('user@example.test');
  expect(JSON.stringify(body)).not.toContain('private-token');
}

const storageAdapter: StorageAdapter = {
  async writeBlob() {
    return { checksum: 'unused', size: 0, headBytes: new Uint8Array() };
  },
  async readBlob() {
    return null;
  },
  async readBlobRange() {
    return null;
  },
  async removeBlob() {},
  async blobExists() {
    return false;
  },
  async blobSize() {
    return 0;
  },
};

describe('built-in plugin auth error response boundaries', () => {
  test('notifications preserve actionable failures and redact private 5xx diagnostics', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const app = createNotificationPlugin({ db, getTokenService: () => null })
      .get(`${FIXTURE_PATH}/:kind`, ({ params }) => throwFixture(params.kind));

    try {
      await expectSafeAuthErrorBoundary(app, '/notifications');
    } finally {
      db.dispose();
    }
  });

  test('storage preserves actionable failures and redacts private 5xx diagnostics', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const app = createStoragePlugin({
      db,
      adapter: storageAdapter,
      getTokenService: () => null,
    }).get(`${FIXTURE_PATH}/:kind`, ({ params }) => throwFixture(params.kind));

    try {
      await expectSafeAuthErrorBoundary(app, '/storage');
    } finally {
      db.dispose();
    }
  });

  test('scheduler preserves actionable failures and redacts private 5xx diagnostics', async () => {
    const app = createSchedulerPlugin({ getTokenService: () => null })
      .get(`${FIXTURE_PATH}/:kind`, ({ params }) => throwFixture(params.kind));

    await expectSafeAuthErrorBoundary(app, '/scheduler');
  });

  test('rooms preserve actionable failures and redact private 5xx diagnostics', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const app = createRoomPlugin({ db, getTokenService: () => null })
      .get(`${FIXTURE_PATH}/:kind`, ({ params }) => throwFixture(params.kind));

    try {
      await expectSafeAuthErrorBoundary(app, '/rooms');
    } finally {
      db.dispose();
    }
  });
});
