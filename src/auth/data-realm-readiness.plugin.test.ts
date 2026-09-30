import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createDataRealmReadinessPlugin,
  type DataRealmReadinessService,
} from './data-realm-readiness.plugin';
import type { TokenService } from './token-service';
import { identityProjectionError } from './identity-projection-error';
import { DatabaseError } from '../databases/database-error';
import { AuthError } from './types';

const AUTH = Object.freeze({
  userId: 'user-1',
  email: 'member@example.test',
  role: 'user',
  credentialKind: 'session' as const,
  sessionScopeKind: 'tenant' as const,
  sessionScopeId: 'tenant-1',
  tenantId: 'tenant-1',
  membershipId: 'membership-1',
});

describe('data realm readiness plugin', () => {
  it('passes only live request authority to inspect and retry', async () => {
    const operations: string[] = [];
    const service: DataRealmReadinessService = {
      inspect: ({ auth }) => {
        operations.push(`inspect:${auth.tenantId}`);
        return snapshot('provisioning');
      },
      retry: ({ auth }) => {
        operations.push(`retry:${auth.membershipId}`);
        return snapshot('retrying');
      },
    };
    const app = new Elysia().use(createDataRealmReadinessPlugin({
      getTokenService: () => tokenService(),
      getReadinessService: () => service,
    }));

    const inspect = await app.handle(authorizedRequest(
      'http://localhost/data-realm/readiness?targetId=attacker-target',
      'GET',
    ));
    const retry = await app.handle(authorizedRequest(
      'http://localhost/data-realm/readiness/retry',
      'POST',
    ));

    expect(inspect.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(inspect.headers.get('cache-control')).toBe('private, no-store');
    expect(await inspect.json()).toEqual(snapshot('provisioning'));
    expect(await retry.json()).toEqual(snapshot('retrying'));
    expect(operations).toEqual([
      'inspect:tenant-1',
      'retry:membership-1',
    ]);
  });

  it.each([
    ['IDENTITY_PROJECTION_NOT_READY', 'DATA_REALM_NOT_READY'],
    ['IDENTITY_PROJECTION_QUARANTINED', 'DATA_REALM_UNAVAILABLE'],
  ] as const)('maps %s to a public-safe 503 readiness code', async (
    projectionCode,
    publicCode,
  ) => {
    const service: DataRealmReadinessService = {
      inspect() { throw identityProjectionError(projectionCode); },
      retry() { throw identityProjectionError(projectionCode); },
    };
    const app = readinessErrorBoundary().use(createDataRealmReadinessPlugin({
      getTokenService: () => tokenService(),
      getReadinessService: () => service,
    }));

    const response = await app.handle(authorizedRequest(
      'http://localhost/data-realm/readiness/retry',
      'POST',
    ));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Authentication service unavailable',
      code: publicCode,
    });
  });

  it.each([
    ['DATABASE_BACKPRESSURE', 'DATA_REALM_NOT_READY'],
    ['DATABASE_SCHEMA_MISMATCH', 'DATA_REALM_UNAVAILABLE'],
  ] as const)('maps %s to a public-safe 503 readiness code', async (
    databaseCode,
    publicCode,
  ) => {
    const privateDetail = '/private/tenant/acme.sqlite SELECT * FROM secrets';
    const service: DataRealmReadinessService = {
      inspect() {
        throw new DatabaseError(databaseCode, privateDetail, {
          details: { path: privateDetail, sql: privateDetail },
        });
      },
      retry() {
        throw new DatabaseError(databaseCode, privateDetail, {
          details: { path: privateDetail, sql: privateDetail },
        });
      },
    };
    const app = readinessErrorBoundary().use(createDataRealmReadinessPlugin({
      getTokenService: () => tokenService(),
      getReadinessService: () => service,
    }));

    const response = await app.handle(authorizedRequest(
      'http://localhost/data-realm/readiness/retry',
      'POST',
    ));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: 'Authentication service unavailable',
      code: publicCode,
    });
    expect(JSON.stringify(body)).not.toContain(privateDetail);
  });
});

function readinessErrorBoundary() {
  return new Elysia().onError(({ error, set }) => {
    if (!(error instanceof AuthError)) return undefined;
    set.status = error.status;
    return {
      error: error.status >= 500
        ? 'Authentication service unavailable'
        : error.message,
      code: error.code,
    };
  });
}

function tokenService(): TokenService {
  return {
    resolveAuthContext: async () => AUTH,
  } as unknown as TokenService;
}

function authorizedRequest(url: string, method: string): Request {
  return new Request(url, {
    method,
    headers: { Authorization: 'Bearer opaque-test-token' },
  });
}

function snapshot(status: 'provisioning' | 'retrying') {
  return {
    status,
    scope: 'tenant' as const,
    pendingOperations: 1,
    retryable: false,
    errorCode: null,
    updatedAt: 42,
    pollAfterMs: 500,
  };
}
