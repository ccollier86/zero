import { describe, expect, test } from 'bun:test';
import {
  MemoryEventStore,
  OBS_CODES,
  emitPlatformCodeTo,
} from '../../observability';
import type { PlatformObservabilityRuntime } from '../../observability/types';
import type { AuthPlatformCodeEmitter } from '../auth-observability';
import { NativeAuthorizationError } from '../native';
import { authorizeNativeGet } from './native-authorize-get';
import { authorizeNativePost } from './native-authorize-post';
import type { NativeAuthorizationService } from './native-authorization-service';
import type { NativeAuthHttpConfig } from './native-plugin-types';
import {
  emitUnexpectedNativeRequestFailure,
  type NativeRequestOperation,
} from './native-request-failure';
import { createNativeTenantPlugin } from './native-tenant.plugin';
import { createNativeTokenPlugin } from './native-token.plugin';
import { NativeTokenError } from './native-token-error';

const PRIVATE_FAILURE = 'database-private-detail secret@example.test';

describe('native request observability', () => {
  const cases: Array<[
    operation: NativeRequestOperation,
    expectedStatus: number,
    run: (config: NativeAuthHttpConfig) => Promise<Response>,
  ]> = [
    ['authorize.get', 500, (config) => authorizeNativeGet(
      config,
      new Request(`${config.issuer}/oauth/authorize?client_id=desktop`),
    )],
    ['authorize.post', 500, (config) => authorizeNativePost(
      config,
      formRequest(`${config.issuer}/oauth/authorize`, {
        request_id: 'request-id',
        decision: 'approve',
      }, { Origin: new URL(config.issuer).origin }),
    )],
    ['token.exchange', 503, async (config) => createNativeTokenPlugin(config).handle(
      formRequest(`${config.audience}/oauth/token`, {
        grant_type: 'authorization_code',
        code: 'authorization-code',
        client_id: 'desktop',
        redirect_uri: 'desktop:/oauth/callback',
        code_verifier: 'v'.repeat(64),
      }),
    )],
    ['token.revoke', 503, async (config) => createNativeTokenPlugin(config).handle(
      formRequest(`${config.audience}/oauth/revoke`, {
        token: 'private-refresh-token',
        client_id: 'desktop',
      }),
    )],
    ['tenant.list', 503, async (config) => createNativeTenantPlugin(config).handle(
      formRequest(`${config.audience}/oauth/tenants`, {
        refresh_token: 'private-refresh-token',
        client_id: 'desktop',
      }),
    )],
    ['tenant.switch', 503, async (config) => createNativeTenantPlugin(config).handle(
      formRequest(`${config.audience}/oauth/tenants/switch`, {
        refresh_token: 'private-refresh-token',
        client_id: 'desktop',
        tenant_id: 'tenant-private-id',
      }),
    )],
  ];

  for (const [operation, expectedStatus, run] of cases) {
    test(`reports an unexpected ${operation} failure without changing its safe response`, async () => {
      const capture = eventCapture();
      const config = nativeConfig(failingNativeService(), capture.emitCode);

      const response = await run(config);
      const responseText = await response.text();

      expect(response.status).toBe(expectedStatus);
      expect(responseText).not.toContain(PRIVATE_FAILURE);
      const [event] = capture.events.query({
        code: OBS_CODES.AUTH_NATIVE_REQUEST_FAILED.code,
      }).events;
      expect(event?.metadata).toEqual({ operation });
      expect(event?.error).toBeUndefined();
      expect(JSON.stringify(event)).not.toContain(PRIVATE_FAILURE);
      expect(capture.events.query({
        code: OBS_CODES.AUTH_NATIVE_REQUEST_FAILED.code,
      }).events).toHaveLength(1);
    });
  }

  for (const [operation, run] of [
    ['authorize.get', (config: NativeAuthHttpConfig) => authorizeNativeGet(
      config,
      new Request(`${config.issuer}/oauth/authorize?client_id=desktop`),
    )],
    ['authorize.post', (config: NativeAuthHttpConfig) => authorizeNativePost(
      config,
      formRequest(`${config.issuer}/oauth/authorize`, {
        request_id: 'request-id',
        decision: 'approve',
      }, { Origin: new URL(config.issuer).origin }),
    )],
  ] as const) {
    test(`normalizes unavailable-service ${operation} through the OAuth boundary`, async () => {
      const capture = eventCapture();
      const config = nativeConfig(null, capture.emitCode);

      const response = await run(config);
      const responseText = await response.text();

      expect(response.status).toBe(503);
      expect(responseText).toContain('Native authentication is temporarily unavailable.');
      const [event] = capture.events.query({
        code: OBS_CODES.AUTH_NATIVE_REQUEST_FAILED.code,
      }).events;
      expect(event?.metadata).toEqual({ operation });
      expect(event?.error).toBeUndefined();
      expect(capture.events.query({
        code: OBS_CODES.AUTH_NATIVE_REQUEST_FAILED.code,
      }).events).toHaveLength(1);
    });
  }

  test('does not report expected OAuth protocol rejections as operational failures', () => {
    const capture = eventCapture();
    const config = nativeConfig(failingNativeService(), capture.emitCode);

    emitUnexpectedNativeRequestFailure(
      config,
      'authorize.get',
      new NativeAuthorizationError('invalid_request', 'Invalid request.'),
    );
    emitUnexpectedNativeRequestFailure(
      config,
      'token.exchange',
      new NativeTokenError('invalid_grant', 'Invalid grant.'),
    );
    emitUnexpectedNativeRequestFailure(
      config,
      'token.exchange',
      new NativeTokenError('temporarily_unavailable', 'Retry shortly.'),
    );

    expect(capture.events.query({
      code: OBS_CODES.AUTH_NATIVE_REQUEST_FAILED.code,
    }).events).toHaveLength(0);
  });

  test('reports and redacts an authorization server_error description', async () => {
    const capture = eventCapture();
    const service = {
      start() {
        throw new NativeAuthorizationError('server_error', PRIVATE_FAILURE, 500);
      },
      getErrorTarget: () => null,
    } as unknown as NativeAuthorizationService;

    const response = await authorizeNativeGet(
      nativeConfig(service, capture.emitCode),
      new Request('https://zero.test/auth/oauth/authorize?client_id=desktop'),
    );
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).toContain('Authorization failed.');
    expect(responseText).not.toContain(PRIVATE_FAILURE);
    const failures = capture.events.query({
      code: OBS_CODES.AUTH_NATIVE_REQUEST_FAILED.code,
    }).events;
    expect(failures).toHaveLength(1);
    expect(failures[0]?.metadata).toEqual({ operation: 'authorize.get' });
    expect(failures[0]?.error).toBeUndefined();
  });
});

function failingNativeService(): NativeAuthorizationService {
  const fail = (): never => {
    throw new Error(PRIVATE_FAILURE);
  };
  return {
    start: fail,
    getRequest: fail,
    getErrorTarget: () => null,
    exchangeCode: fail,
    revoke: fail,
    listTenants: fail,
    switchTenant: fail,
  } as unknown as NativeAuthorizationService;
}

function nativeConfig(
  service: NativeAuthorizationService | null,
  emitCode: AuthPlatformCodeEmitter,
): NativeAuthHttpConfig {
  return {
    issuer: 'https://zero.test/auth',
    audience: 'https://zero.test',
    loginPath: '/login',
    registrationPath: '/register',
    emitCode,
    getService: () => service,
    getTokenService: () => null,
    getUserStore: () => null,
  };
}

function formRequest(
  url: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(fields),
  });
}

function eventCapture(): {
  events: MemoryEventStore;
  emitCode: AuthPlatformCodeEmitter;
} {
  const events = new MemoryEventStore();
  const runtime: PlatformObservabilityRuntime = {
    sink: events,
    store: events,
    config: { console: false },
  };
  return {
    events,
    emitCode: (definition, options) => emitPlatformCodeTo(runtime, definition, options),
  };
}
