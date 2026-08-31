/** Provider revocation followed by unconditional local credential deletion. */

import type { ResolvedNativeAuthConfig } from './config';
import { revokeNativeRefreshToken } from './revocation';
import type { NativeAuthRuntime } from './runtime';
import { createOperationSignal, invokeAsync, raceWithSignal } from './abort';
import type { NativeLifecycle } from './lifecycle';
import type { NativeVaultStore } from './vault-store';

interface NativeSignOutInput {
  config: ResolvedNativeAuthConfig;
  vault: NativeVaultStore;
  lifecycle: NativeLifecycle;
  active: NativeAuthRuntime | null;
  runtime: () => Promise<NativeAuthRuntime>;
  onLocalCleared: () => void;
}

export async function performNativeSignOut(
  input: NativeSignOutInput,
): Promise<void> {
  const local = await input.lifecycle.commit(async () => {
    let failure: unknown;
    let stored: Awaited<ReturnType<NativeVaultStore['loadSession']>> = null;
    try {
      stored = await input.vault.loadSession();
    } catch (error) {
      failure = error;
    }
    const cleanup = await Promise.allSettled([
      invokeAsync(() => input.active
        ? input.active.sessions.clearLocal()
        : input.vault.clearSession()),
      invokeAsync(() => input.vault.clearPending()),
    ]);
    failure ??= cleanup.find((result) => result.status === 'rejected')?.reason;
    input.onLocalCleared();
    return { failure, stored };
  });
  let failure = local.failure;
  if (local.stored) {
    try {
      const active = input.active ?? await input.runtime();
      const bounded = createOperationSignal(
        undefined, input.config.networkTimeoutMs, 'OIDC revocation timed out.',
      );
      try {
        await raceWithSignal(revokeNativeRefreshToken({
          metadata: active.metadata, clientId: input.config.clientId,
          fetch: input.config.fetch,
        }, local.stored.refreshToken, bounded.signal), bounded.signal);
      } finally {
        bounded.dispose();
      }
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}
