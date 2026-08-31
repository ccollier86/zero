/** Dependencies needed for session restoration and refresh rotation. */

import type { NativeFetch } from './adapter-types';
import type { NativeIdTokenValidator } from './id-token';
import type { NativeLifecycle } from './lifecycle';
import type { NativeOidcMetadata, NativeStoredSession } from './oidc-types';
import type { NativeAuthStateStore } from './state-store';
import type { NativeVaultStore } from './vault-store';

export interface NativeSessionContext {
  metadata: NativeOidcMetadata;
  issuer: string;
  clientId: string;
  fetch: NativeFetch;
  vault: NativeVaultStore;
  state: NativeAuthStateStore;
  validator: NativeIdTokenValidator;
  lifecycle: NativeLifecycle;
  networkTimeoutMs: number;
}

export function storedSessionMatchesClient(
  session: NativeStoredSession,
  issuer: string,
  clientId: string,
): boolean {
  return session.issuer === issuer && session.clientId === clientId
    && session.subject === session.identity.sub && session.identity.iss === issuer;
}
