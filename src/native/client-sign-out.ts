/** Public-client sign-out orchestration kept separate from the facade. */

import type { ResolvedNativeAuthConfig } from './config';
import { toNativeAuthError } from './errors';
import type { NativeLifecycle } from './lifecycle';
import type { NativeRuntimeLoader } from './runtime-loader';
import { performNativeSignOut } from './sign-out';
import type { NativeAuthStateStore } from './state-store';
import type { NativeVaultStore } from './vault-store';

interface ClientSignOutInput {
  config: ResolvedNativeAuthConfig;
  vault: NativeVaultStore;
  lifecycle: NativeLifecycle;
  loader: NativeRuntimeLoader;
  state: NativeAuthStateStore;
}

export async function signOutNativeClient(input: ClientSignOutInput): Promise<void> {
  const generation = input.lifecycle.supersede();
  input.loader.currentRuntime()?.flow.cancel();
  let locallyCleared = false;
  const markAnonymous = () => {
    locallyCleared = true;
    if (!input.lifecycle.isCurrent(generation)) return;
    input.state.setAnonymous();
    input.loader.markInitialized();
  };
  try {
    await performNativeSignOut({
      config: input.config,
      vault: input.vault,
      lifecycle: input.lifecycle,
      active: input.loader.currentRuntime(),
      runtime: () => input.loader.runtime(),
      onLocalCleared: markAnonymous,
    });
  } catch (error) {
    if (!locallyCleared) markAnonymous();
    throw toNativeAuthError(error, 'OIDC_SIGN_OUT_FAILED');
  }
}
