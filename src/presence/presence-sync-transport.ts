/** Managed write-only heartbeat adapter; no identity, clocks or TTL are trusted from the wire. */
import { serviceDataScopeFromIdentity } from '../auth/service-data-scope';
import type { SyncPresenceTransport } from '../sync/sync-presence-transport';
import { presenceError } from './presence-error';
import type { PresenceService } from './presence-service';
import type { PresenceActivityReport } from './presence-lease-store';

/** Lazy service lookup preserves createApp's existing Sync-before-Guardian composition order. */
export function createPresenceSyncTransport(getService: () => PresenceService | null, tenancyMode: 'single' | 'multi'): SyncPresenceTransport {
  return {
    attach(manager) { return getService()?.attachEphemeralManager(manager) ?? (() => {}); },
    release(connectionId) { getService()?.release(connectionId); },
    handle(message, auth, connectionId, assertCurrent) {
      if (Object.keys(message).sort().join(',') !== 'key,topic,type,value' || message.type !== 'ephemeral.set'
        || message.topic !== 'guardian:presence' || message.key !== 'self' || !auth?.sessionId
        || auth.sessionKind !== 'web' && auth.sessionKind !== 'native'
        || auth.sessionKind === 'native' && (!auth.scope?.includes('profile') || !auth.scope.includes('profile:write'))) {
        throw presenceError('AUTH_PRESENCE_INVALID_INPUT');
      }
      const scope = serviceDataScopeFromIdentity(auth, tenancyMode), service = getService();
      if (!scope || !service) throw presenceError('AUTH_PRESENCE_NOT_READY');
      service.report({ scope, userId: auth.userId, connectionId }, message.value as unknown as PresenceActivityReport, assertCurrent);
    },
  };
}
