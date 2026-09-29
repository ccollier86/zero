import { expect, test } from 'bun:test';

import { OBS_CODES } from '../observability/codes';
import type { PlatformEvent } from '../observability/types';
import {
  ZERO_AUTH_AUDIT_SERVICE,
  ZERO_AUTH_STORE,
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTH_TOKEN_SERVICE,
} from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { clearAuthRuntimeServices } from './auth-runtime-lifecycle';
import { createAuthRuntimeServiceGraph } from './auth-runtime-service-graph';

test('runtime teardown clears every service and retains the first stop failure', async () => {
  const appRuntime = new ZeroAppRuntime('auth-runtime-lifecycle-failure');
  const services = createAuthRuntimeServiceGraph();
  const calls: string[] = [];
  const emitted: string[] = [];
  const firstFailure = new Error('outbox stop failure');

  services.authEmailOutbox = {
    async stop() {
      calls.push('outbox');
      throw firstFailure;
    },
  } as unknown as NonNullable<typeof services.authEmailOutbox>;
  services.verifiedDomainOnboardingService = {
    async stop() {
      calls.push('verified-domains');
      throw new Error('verified-domain stop failure');
    },
  } as unknown as NonNullable<typeof services.verifiedDomainOnboardingService>;
  services.auditService = {
    stop() {
      calls.push('audit');
      throw new Error('audit stop failure');
    },
  } as unknown as NonNullable<typeof services.auditService>;
  services.userStore = {} as NonNullable<typeof services.userStore>;
  services.tokenService = {} as NonNullable<typeof services.tokenService>;
  const authorizationKernel = {} as NonNullable<
    Parameters<typeof clearAuthRuntimeServices>[0]['authorizationKernel']
  >;

  appRuntime.set(ZERO_AUTH_AUDIT_SERVICE, services.auditService);
  appRuntime.set(ZERO_AUTH_STORE, services.userStore);
  appRuntime.set(ZERO_AUTH_TOKEN_SERVICE, services.tokenService);
  appRuntime.set(ZERO_AUTHORIZATION_KERNEL, authorizationKernel);

  const emitCode = ((definition) => {
    emitted.push(definition.code);
    return {} as PlatformEvent;
  }) as AuthPlatformCodeEmitter;

  await expect(clearAuthRuntimeServices({
    runtime: appRuntime,
    authConfig: {} as Parameters<
      typeof clearAuthRuntimeServices
    >[0]['authConfig'],
    authorizationKernel,
    services,
    emitCode,
  }, true)).rejects.toBe(firstFailure);

  expect(calls).toEqual(['outbox', 'verified-domains', 'audit']);
  expect(Object.values(services).every((service) => service === null)).toBeTrue();
  expect(appRuntime.get(ZERO_AUTH_AUDIT_SERVICE)).toBeNull();
  expect(appRuntime.get(ZERO_AUTH_STORE)).toBeNull();
  expect(appRuntime.get(ZERO_AUTH_TOKEN_SERVICE)).toBeNull();
  expect(appRuntime.get(ZERO_AUTHORIZATION_KERNEL)).toBeNull();
  expect(emitted).toEqual([OBS_CODES.AUTH_STOPPED.code]);
});
