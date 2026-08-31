/** Shared dependencies for native authorization start and completion. */

import type { ResolvedNativeAuthConfig } from './config';
import type { NativeIdTokenValidator } from './id-token';
import type { NativeLifecycle } from './lifecycle';
import type { NativeOidcMetadata } from './oidc-types';
import type { NativeSessionManager } from './session-manager';
import type { NativeAuthStateStore } from './state-store';
import type { NativeVaultStore } from './vault-store';

export interface NativeAuthorizationContext {
  config: ResolvedNativeAuthConfig;
  metadata: NativeOidcMetadata;
  vault: NativeVaultStore;
  state: NativeAuthStateStore;
  sessions: NativeSessionManager;
  validator: NativeIdTokenValidator;
  lifecycle: NativeLifecycle;
}
