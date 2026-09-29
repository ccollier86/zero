import { describe, expect, test } from 'bun:test';
import type { AuthPublicConfig } from './auth-types';
import {
  getAuthConfigController,
  type AuthConfigClient,
} from './auth-config-controller';
import { runRegistrationWithConfigRefresh } from './auth-hooks';

describe('registration auth-config coherence', () => {
  test('leaves the bootstrap snapshot immediately and publishes replacement policy', async () => {
    const requests: Deferred<AuthPublicConfig>[] = [];
    const client: AuthConfigClient = {
      getConfig() {
        const request = deferred<AuthPublicConfig>();
        requests.push(request);
        return request.promise;
      },
    };
    const controller = getAuthConfigController(client);
    const initial = controller.ensureCurrent();
    await flush();
    requests[0]!.resolve(config(true));
    await initial;
    expect(controller.getSnapshot().config?.registration.bootstrapRequired).toBe(true);

    await runRegistrationWithConfigRefresh(client, async () => ({ registered: true }));
    expect(controller.getSnapshot()).toEqual({
      status: 'loading',
      config: null,
      error: null,
    });

    await flush();
    requests[1]!.resolve(config(false));
    await flush();
    await flush();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      config: { registration: { bootstrapRequired: false } },
    });
  });

  test('keeps the prior snapshot when registration fails', async () => {
    const client: AuthConfigClient = { getConfig: async () => config(true) };
    const controller = getAuthConfigController(client);
    await controller.ensureCurrent();

    await expect(runRegistrationWithConfigRefresh(client, async () => {
      throw new Error('registration rejected');
    })).rejects.toThrow('registration rejected');
    expect(controller.getSnapshot().config?.registration.bootstrapRequired).toBe(true);
  });
});

function config(bootstrapRequired: boolean): AuthPublicConfig {
  return {
    registration: {
      mode: 'admin-only',
      bootstrapRequired,
      registrationEnabled: bootstrapRequired,
      publicRegistrationEnabled: bootstrapRequired,
      userCount: bootstrapRequired ? 0 : 1,
    },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
