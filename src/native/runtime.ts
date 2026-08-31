/** Internal composition root for the platform-neutral native auth SDK. */

import { createAuthenticatedFetch } from './authenticated-fetch';
import { createOperationSignal, raceWithSignal } from './abort';
import { NativeAuthorizationFlow } from './authorization-flow';
import type { ResolvedNativeAuthConfig } from './config';
import { discoverNativeOidc } from './discovery';
import { NativeIdTokenValidator } from './id-token';
import type { NativeLifecycle } from './lifecycle';
import { NativeSessionManager } from './session-manager';
import type { NativeAuthStateStore } from './state-store';
import type { NativeVaultStore } from './vault-store';

export interface NativeAuthRuntime {
  metadata: Awaited<ReturnType<typeof discoverNativeOidc>>;
  flow: NativeAuthorizationFlow;
  sessions: NativeSessionManager;
  fetch: ReturnType<typeof createAuthenticatedFetch>;
}

export async function createNativeAuthRuntime(
  config: ResolvedNativeAuthConfig,
  vault: NativeVaultStore,
  state: NativeAuthStateStore,
  lifecycle: NativeLifecycle,
): Promise<NativeAuthRuntime> {
  const bounded = createOperationSignal(undefined, config.networkTimeoutMs, 'OIDC discovery timed out.');
  let metadata: Awaited<ReturnType<typeof discoverNativeOidc>>;
  try {
    metadata = await raceWithSignal(
      discoverNativeOidc(config.issuer, config.fetch, bounded.signal),
      bounded.signal,
    );
  } finally {
    bounded.dispose();
  }
  const validator = new NativeIdTokenValidator(
    metadata, config.clientId, config.fetch, config.crypto,
    config.clockSkewSeconds, config.now,
  );
  const sessions = new NativeSessionManager({
    metadata, issuer: config.issuer, clientId: config.clientId,
    fetch: config.fetch, vault, state, validator, lifecycle,
    networkTimeoutMs: config.networkTimeoutMs,
  });
  const flow = new NativeAuthorizationFlow({
    config, metadata, vault, state, sessions, validator, lifecycle,
  });
  return {
    metadata,
    flow,
    sessions,
    fetch: createAuthenticatedFetch(config.issuer, config.fetch, sessions),
  };
}
