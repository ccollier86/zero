/** Native-auth adapter for Zero Sync's async access-token lifecycle. */

import type { SyncClientConfig } from '../sync/types';
import type { NativeAuthClient, NativeAuthState } from './client-types';

export type NativeSyncAuthConfig = Pick<
  SyncClientConfig,
  'getToken' | 'refreshAuth' | 'bindAuthLifecycle'
>;

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
      let subject = authenticatedSubject(auth.state);
      let halted = auth.state.status !== 'authenticated';
      let wantsConnection = autoConnect;
      if (!halted && wantsConnection) client.connect();
      const unsubscribe = auth.subscribe((state) => {
        const nextSubject = authenticatedSubject(state);
        if (!nextSubject) {
          if (!halted) {
            wantsConnection ||= client.connected;
            client.reset();
          }
          halted = true;
          if (state.status === 'anonymous') subject = null;
          return;
        }
        const shouldResume = halted || subject !== nextSubject;
        if (!halted && subject !== nextSubject) {
          wantsConnection ||= client.connected;
          client.reset();
        }
        subject = nextSubject;
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

function authenticatedSubject(state: NativeAuthState): string | null {
  return state.status === 'authenticated' ? state.identity?.sub ?? null : null;
}
