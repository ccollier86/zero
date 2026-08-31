/** Serializable native-auth broker commands and host transport contracts. */

import type { NativeAuthErrorInfo, NativeAuthState } from './client-types';

export type NativeAuthBrokerRequest =
  | { operation: 'state' | 'initialize' | 'refresh' | 'getAccessToken' | 'signOut' }
  | { operation: 'signIn' | 'signUp'; loginHint?: string }
  | { operation: 'completeAuthorization'; callbackUrl: string };

export interface NativeAuthBrokerSnapshot {
  revision: number;
  state: NativeAuthState;
}

export type NativeAuthBrokerResponse =
  | { ok: true; snapshot: NativeAuthBrokerSnapshot; accessToken?: string | null }
  | { ok: false; snapshot: NativeAuthBrokerSnapshot; error: NativeAuthErrorInfo };

export type NativeAuthBrokerStateListener = (snapshot: NativeAuthBrokerSnapshot) => void;

/** Host-owned IPC bridge. Implementations must not log request payloads. */
export interface NativeAuthBrokerTransport {
  request(
    command: NativeAuthBrokerRequest,
    options?: { signal?: AbortSignal },
  ): Promise<NativeAuthBrokerResponse>;
  subscribeState(listener: NativeAuthBrokerStateListener): () => void;
}
