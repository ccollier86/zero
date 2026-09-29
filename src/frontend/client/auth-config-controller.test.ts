import { describe, expect, test } from 'bun:test';

import {
  AuthConfigController,
  getAuthConfigController,
  type AuthConfigClient,
} from './auth-config-controller';
import type { AuthPublicConfig } from './auth-types';

describe('AuthConfigController', () => {
  test('coalesces ordinary loads and shares one immutable snapshot per client', async () => {
    const harness = createHarness();
    const controller = getAuthConfigController(harness.client);

    expect(getAuthConfigController(harness.client)).toBe(controller);
    expect(controller.getSnapshot()).toEqual({
      status: 'unknown',
      config: null,
      error: null,
    });

    const first = controller.ensureCurrent();
    const second = controller.ensureCurrent();
    expect(first).toBe(second);
    expect(controller.getSnapshot().status).toBe('loading');
    await flush();
    expect(harness.requests).toHaveLength(1);

    const source = config('first');
    harness.requests[0]!.resolve(source);
    const loaded = await first;
    await second;

    const snapshot = controller.getSnapshot();
    expect(snapshot).toBe(controller.getSnapshot());
    expect(snapshot).toMatchObject({ status: 'ready', error: null });
    expect(snapshot.config).toBe(loaded);
    expect(snapshot.config).not.toBe(source);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.config)).toBe(true);
    expect(Object.isFrozen(snapshot.config?.registration)).toBe(true);
    expect(Object.isFrozen(snapshot.config?.mfa?.methods)).toBe(true);

    source.registration.mode = 'disabled';
    expect(snapshot.config?.registration.mode).toBe('public');
    expect(() => snapshot.config?.mfa?.methods.push('email')).toThrow();
  });

  test('forced reload aborts and fences a superseded out-of-order response', async () => {
    const harness = createHarness();
    const controller = new AuthConfigController(harness.client);

    const first = controller.ensureCurrent();
    await flush();
    const firstSignal = harness.requests[0]!.signal;

    const forced = controller.refresh();
    expect(firstSignal.aborted).toBe(true);
    await flush();
    expect(harness.requests).toHaveLength(2);

    harness.requests[1]!.resolve(config('new'));
    await forced;
    expect(controller.getSnapshot().config?.tenancy?.terminology?.singular).toBe('new');

    harness.requests[0]!.resolve(config('stale'));
    await first;
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      config: { tenancy: { terminology: { singular: 'new' } } },
    });
  });

  test('publishes a safe initial error and retries from the error state', async () => {
    const harness = createHarness();
    const reported: unknown[] = [];
    const controller = new AuthConfigController(harness.client, {
      reportFailure(cause) {
        reported.push(cause);
        throw new Error('observability sink failed');
      },
    });

    const first = controller.ensureCurrent();
    await flush();
    harness.requests[0]!.reject(new Error('private network implementation detail'));
    await expect(first).resolves.toBeNull();

    expect(reported).toHaveLength(1);
    expect(controller.getSnapshot()).toEqual({
      status: 'error',
      config: null,
      error: 'Failed to load auth config',
    });

    const retry = controller.ensureCurrent();
    expect(controller.getSnapshot()).toEqual({
      status: 'loading',
      config: null,
      error: null,
    });
    await flush();
    harness.requests[1]!.resolve(config('retry'));
    await retry;
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      config: { tenancy: { terminology: { singular: 'retry' } } },
    });
  });

  test('shares one failed request while preserving strict imperative rejection', async () => {
    const harness = createHarness();
    const reported: unknown[] = [];
    const controller = new AuthConfigController(harness.client, {
      reportFailure(cause) { reported.push(cause); },
    });
    const strict = controller.refreshOrThrow();
    const stateConsumer = controller.ensureCurrent();
    await flush();
    expect(harness.requests).toHaveLength(1);

    const failure = new Error('upstream config failed');
    harness.requests[0]!.reject(failure);
    await expect(strict).rejects.toBe(failure);
    await expect(stateConsumer).resolves.toBeNull();
    expect(reported).toEqual([failure]);
    expect(controller.getSnapshot()).toEqual({
      status: 'error',
      config: null,
      error: 'Failed to load auth config',
    });
  });

  test('returns the shared immutable snapshot from a successful strict refresh', async () => {
    const harness = createHarness();
    const controller = new AuthConfigController(harness.client);
    const strict = controller.refreshOrThrow();
    await flush();
    harness.requests[0]!.resolve(config('strict'));

    const result = await strict;
    expect(result === controller.getSnapshot().config).toBeTrue();
    expect(Object.isFrozen(result)).toBe(true);
    expect(controller.getSnapshot().status).toBe('ready');
  });

  test('rejects a superseded strict refresh without publishing its stale response', async () => {
    const harness = createHarness();
    const controller = new AuthConfigController(harness.client);
    const stale = controller.refreshOrThrow();
    await flush();
    const current = controller.refreshOrThrow();
    await flush();

    harness.requests[0]!.resolve(config('stale'));
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.getSnapshot().status).toBe('loading');

    harness.requests[1]!.resolve(config('current'));
    await expect(current).resolves.toMatchObject({
      tenancy: { terminology: { singular: 'current' } },
    });
    expect(controller.getSnapshot().config?.tenancy?.terminology?.singular).toBe(
      'current',
    );
  });

  test('fails closed when a successful response has a malformed nested capability', async () => {
    const harness = createHarness();
    const controller = new AuthConfigController(harness.client, {
      reportFailure() {},
    });
    const pending = controller.ensureCurrent();
    await flush();
    harness.requests[0]!.resolve({
      ...config('malformed'),
      mfa: { enabled: true },
    } as unknown as AuthPublicConfig);

    await expect(pending).resolves.toBeNull();
    expect(controller.getSnapshot()).toEqual({
      status: 'error',
      config: null,
      error: 'Failed to load auth config',
    });
  });

  test('isolates listener failures from state publication and other listeners', async () => {
    const harness = createHarness();
    const controller = new AuthConfigController(harness.client);
    let notifications = 0;
    controller.subscribe(() => { throw new Error('listener failed'); });
    controller.subscribe(() => { notifications += 1; });

    const pending = controller.ensureCurrent();
    expect(notifications).toBe(1);
    await flush();
    harness.requests[0]!.resolve(config('listener-safe'));
    await pending;

    expect(notifications).toBe(2);
    expect(controller.getSnapshot().status).toBe('ready');
  });

  test('never shares requests or config between distinct auth clients', async () => {
    const alpha = createHarness();
    const beta = createHarness();
    const alphaController = getAuthConfigController(alpha.client);
    const betaController = getAuthConfigController(beta.client);
    expect(alphaController).not.toBe(betaController);

    const alphaPending = alphaController.ensureCurrent();
    const betaPending = betaController.ensureCurrent();
    await flush();
    expect(alpha.requests).toHaveLength(1);
    expect(beta.requests).toHaveLength(1);

    alpha.requests[0]!.resolve(config('alpha'));
    beta.requests[0]!.resolve(config('beta'));
    await Promise.all([alphaPending, betaPending]);

    expect(alphaController.getSnapshot().config?.tenancy?.terminology?.singular).toBe('alpha');
    expect(betaController.getSnapshot().config?.tenancy?.terminology?.singular).toBe('beta');
  });

  test('invalidates bootstrap-era policy before its replacement request starts', async () => {
    const harness = createHarness();
    const controller = new AuthConfigController(harness.client);
    const initial = controller.ensureCurrent();
    await flush();
    harness.requests[0]!.resolve(config('bootstrap'));
    await initial;

    controller.invalidate();
    expect(controller.getSnapshot()).toEqual({
      status: 'unknown',
      config: null,
      error: null,
    });

    const replacement = controller.ensureCurrent();
    expect(controller.getSnapshot()).toEqual({
      status: 'loading',
      config: null,
      error: null,
    });
    await flush();
    harness.requests[1]!.resolve({
      ...config('after-bootstrap'),
      registration: {
        mode: 'admin-only',
        bootstrapRequired: false,
        registrationEnabled: false,
        publicRegistrationEnabled: false,
      },
    });
    await replacement;

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      config: {
        registration: {
          bootstrapRequired: false,
          publicRegistrationEnabled: false,
        },
      },
    });
  });
});

function createHarness() {
  const requests: ConfigRequest[] = [];
  const client: AuthConfigClient = {
    getConfig(signal) {
      const pending = deferred<AuthPublicConfig>();
      requests.push({ ...pending, signal: signal ?? new AbortController().signal });
      return pending.promise;
    },
  };
  return { client, requests };
}

interface ConfigRequest {
  readonly promise: Promise<AuthPublicConfig>;
  readonly signal: AbortSignal;
  resolve(config: AuthPublicConfig): void;
  reject(cause: unknown): void;
}

function config(label: string): AuthPublicConfig {
  return {
    tenancy: {
      mode: 'multi',
      terminology: { singular: label, plural: `${label}s` },
    },
    registration: {
      mode: 'public',
      bootstrapRequired: false,
      registrationEnabled: true,
      publicRegistrationEnabled: true,
    },
    mfa: {
      enabled: true,
      policy: 'optional',
      methods: ['totp'],
      availableMethods: ['totp'],
      allowUserChoice: true,
      allowMultipleMethods: false,
      rememberDevice: false,
      recoveryCodes: false,
      ready: true,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
