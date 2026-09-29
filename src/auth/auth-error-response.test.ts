import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { MemoryEventStore, OBS_CODES } from '../observability';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB } from '../sync/reactive-db';
import { getPublicAuthErrorMessage } from './auth-error-response';
import { createAuthPlugin } from './auth.plugin';
import { AuthError } from './types';

describe('auth HTTP error responses', () => {
  test('preserves actionable client failures', () => {
    const error = new AuthError('Tenant membership is required', 'TENANT_REQUIRED', 403);

    expect(getPublicAuthErrorMessage(error)).toBe('Tenant membership is required');
  });

  test('does not expose internal 5xx diagnostics', () => {
    const error = new AuthError(
      'Invariant failed for user@example.test with token private-token',
      'AUTH_STATE_INVARIANT_FAILED',
      500,
    );

    const message = getPublicAuthErrorMessage(error);
    expect(message).toBe('Authentication service unavailable');
    expect(message).not.toContain('user@example.test');
    expect(message).not.toContain('private-token');
  });

  test('covers auth request-hook failures at the namespace boundary', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const appRuntime = new ZeroAppRuntime('auth-public-error-response');
    const events = new MemoryEventStore();
    appRuntime.set(ZERO_OBSERVABILITY_RUNTIME, {
      sink: events,
      store: events,
      config: { console: false },
    });
    const app = new Elysia().use(createAuthPlugin({
      db,
      runtime: appRuntime,
      bootstrap: 'public',
      onRuntimeCreated(runtime) {
        runtime.assertCurrentProfile = () => {
          throw new AuthError(
            'Invariant failed for user@example.test with private-token',
            'AUTH_STATE_INVARIANT_FAILED',
            500,
          );
        };
      },
    }));

    try {
      const response = await app.handle(new Request('http://zero.test/auth/missing'));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: 'Authentication service unavailable',
        code: 'AUTH_STATE_INVARIANT_FAILED',
      });
      expect(JSON.stringify(body)).not.toContain('private-token');
      expect(JSON.stringify(body)).not.toContain('user@example.test');
      const [failure] = events.query({ code: OBS_CODES.APP_REQUEST_FAILED.code }).events;
      expect(failure?.metadata).toEqual({
        method: 'GET',
        path: '/auth/missing',
        status: 500,
        authCode: 'AUTH_STATE_INVARIANT_FAILED',
      });
      expect(failure?.error).toBeUndefined();
    } finally {
      await appRuntime.dispose();
      db.dispose();
    }
  });
});
