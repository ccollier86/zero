/** Native-auth adapter for Zero Sync's async access-token lifecycle. */

import type { SyncClientConfig } from '../sync/types';
import type { NativeAuthClient, NativeAuthState } from './client-types';

export type NativeSyncAuthConfig = Pick<
  SyncClientConfig,
  'getToken' | 'refreshAuth' | 'bindAuthLifecycle'
>;

interface NativeSyncAuthority {
  readonly subject: string;
  readonly activeTenantId: string | null;
}

/** Connect a NativeAuthClient without exposing its refresh credential. */
export function createNativeSyncAuth(
  auth: Pick<NativeAuthClient, 'getAccessToken' | 'refresh' | 'state' | 'subscribe'>,
): NativeSyncAuthConfig {
  return {
    getToken: () => auth.getAccessToken(),
    async refreshAuth() {
      await auth.refresh();
      return auth.getAccessToken();
    },
    bindAuthLifecycle(client, autoConnect) {
      let authority = authenticatedAuthority(auth.state);
      let halted = auth.state.status !== 'authenticated';
      let wantsConnection = autoConnect;
      if (!halted && wantsConnection) client.connect();
      const unsubscribe = auth.subscribe((state) => {
        const nextAuthority = authenticatedAuthority(state);
        if (!nextAuthority) {
          if (!halted) {
            wantsConnection ||= client.connected;
            client.reset();
          }
          halted = true;
          if (state.status === 'anonymous') authority = null;
          return;
        }
        const authorityChanged = !sameAuthority(authority, nextAuthority);
        const shouldResume = halted || authorityChanged;
        if (!halted && authorityChanged) {
          wantsConnection ||= client.connected;
          client.reset();
        }
        authority = nextAuthority;
        halted = false;
        if (shouldResume && wantsConnection) client.connect();
      });
      if (auth.state.status === 'uninitialized' && wantsConnection) {
        void auth.getAccessToken().catch(() => undefined);
      }
      return unsubscribe;
    },
  };
}

function authenticatedAuthority(state: NativeAuthState): NativeSyncAuthority | null {
  if (state.status !== 'authenticated' || !state.identity?.sub) return null;
  return Object.freeze({
    subject: state.identity.sub,
    activeTenantId: state.activeTenant?.tenantId ?? null,
  });
}

function sameAuthority(
  left: NativeSyncAuthority | null,
  right: NativeSyncAuthority,
): boolean {
  return left?.subject === right.subject
    && left.activeTenantId === right.activeTenantId;
}
