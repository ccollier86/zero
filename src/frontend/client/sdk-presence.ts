/** SDK composition only: presence consumes the existing auth, Sync and ephemeral lifecycles. */
import type { AuthClient } from './auth-client';
import type { AuthorizationDataBoundarySource } from './authorization-data-boundary';
import type { SyncClient } from '../../sync/client/sync-client';
import type { EphemeralClient } from '../../sync/client/ephemeral-client';
import type { Row } from '../../sync/types';
import { PRESENCE_TABLE, PRESENCE_OWNER_TABLE } from '../../presence/presence-client-tables';
import { GuardianPresenceClient } from './guardian-presence-client';
import { isAuthorizationDataReady, isAuthorizationScopeReady } from './authorization-scope-readiness';
import { reportAuthClientActionFailure } from './auth-action-observability';

export function createSdkPresence(enabled: boolean, url: string, auth: AuthClient | null,
  dataBoundary: AuthorizationDataBoundarySource, sync: SyncClient, ephemeral: EphemeralClient): GuardianPresenceClient {
  return new GuardianPresenceClient({
    enabled,
    readBoundary() {
      const projection = auth?.authorizationState.snapshot;
      const scope = projection?.scope;
      const transition = auth?.sessionTransition;
      const validated = auth?.authorizationState.status === 'ready' || auth?.authorizationState.status === 'refreshing';
      return {
        key: JSON.stringify([auth?.authorizationScopeKey, auth?.user?.userId, scope?.kind, scope?.scopeId,
          projection?.revision, transition?.phase, transition?.revision, dataBoundary.revision]),
        ready: Boolean(auth?.isAuthenticated && scope && validated && projection?.identity.userId === auth.user?.userId
          && transition && isAuthorizationScopeReady(transition, auth.isRestoring)
          && isAuthorizationDataReady(dataBoundary.revision, auth.authorizationState.status, auth.isAuthenticated)),
        connected: sync.connected,
        scopeKind: scope?.kind ?? 'application',
        scopeId: scope?.scopeId ?? '',
      };
    },
    subscribeBoundary(callback) {
      const removeAuth = auth?.subscribe(callback);
      const removeAuthority = auth?.subscribeAuthorization(callback);
      const removeData = dataBoundary.subscribe(callback);
      const subscription = sync.store.subscribe(callback);
      return () => { removeAuth?.(); removeAuthority?.(); removeData(); subscription.unsubscribe(); };
    },
    subscribeReportErrors(callback) {
      return ephemeral.onError(error => { if (error.topic === 'guardian:presence' && error.operation === 'set') callback(); });
    },
    authenticatedFetch(path, init) {
      if (!auth) return Promise.reject(new Error('Presence requires Guardian authentication.'));
      return auth.fetchWithAuth(`${url}${path}`, init);
    },
    readRows() {
      const tables = sync.store.getSnapshot().context;
      return { rows: (tables[PRESENCE_TABLE] ?? {}) as Record<string, Row>,
        owner: (tables[PRESENCE_OWNER_TABLE] as Record<string, Row> | undefined)?.primary };
    },
    sendTransient: value => ephemeral.setTransient('guardian:presence', 'self', value),
    reportFailure: cause => reportAuthClientActionFailure('presence', cause, { codeOnly: true }),
  });
}
