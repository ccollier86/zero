/** Typed connection leases on app-local Sync ephemeral storage; no SQL or independent connection bus. */
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import type { ResolvedAuthPresenceConfig } from '../auth/auth-presence-types';
import { EphemeralStateManager, type EphemeralExpiration } from '../sync/ephemeral-manager';
import { EPHEMERAL_LIMITS } from '../sync/ephemeral-validation';
import type { JsonValue } from '../sync/types';
import { presenceError } from './presence-error';
import type { PresenceActivityLease } from './presence-status';

/** Identity is supplied only by admitted Sync/server scope, never the observation payload. */
export interface PresenceLeasePrincipal {
  readonly scope: ServiceDataScope;
  readonly userId: string;
  readonly connectionId: string;
}
/** Client intent has no timestamps or user/org/device identity. Sequence is per admitted connection. */
export interface PresenceActivityReport {
  readonly sequence: number;
  readonly activity: boolean;
  readonly visible: boolean;
}
interface StoredLease extends PresenceActivityLease, PresenceLeasePrincipal {
  readonly sequence: number;
  readonly namespace: string;
  readonly key: string;
}

/** Per-connection storage and expiration ownership; aggregation belongs to PresenceService. */
export class PresenceLeaseStore {
  private readonly leases = new Map<string, StoredLease>();
  private readonly sequences = new Map<string, number>();
  private readonly removeExpiration: () => void;
  private closed = false;

  constructor(
    private readonly manager: EphemeralStateManager,
    private readonly config: ResolvedAuthPresenceConfig,
    private readonly ownerEpoch: number,
    private readonly onAffected: (scope: ServiceDataScope, userId: string) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.removeExpiration = manager.onExpired(expiration => this.expired(expiration));
  }

  /** Sequence watermarks survive TTL expiry; the Sync runtime additionally fences closed connections. */
  report(principal: PresenceLeasePrincipal, input: PresenceActivityReport): void {
    if (this.closed) throw presenceError('AUTH_PRESENCE_OWNER_LOST');
    assertReport(input);
    const previous = this.leases.get(principal.connectionId);
    if (previous && (previous.userId !== principal.userId
      || serviceDataScopeKey(previous.scope) !== serviceDataScopeKey(principal.scope))) {
      throw presenceError('AUTH_PRESENCE_OWNER_LOST');
    }
    if (input.sequence <= (this.sequences.get(principal.connectionId) ?? 0)) throw presenceError('AUTH_PRESENCE_INVALID_INPUT');
    const namespace = `_guardian-presence:${serviceDataScopeKey(principal.scope)}`;
    const key = `${this.ownerEpoch}:${principal.connectionId}`;
    if (!previous) {
      const usage = this.manager.getUsage(namespace, principal.userId);
      if (usage.totalEntries >= EPHEMERAL_LIMITS.maxEntriesTotal
        || usage.namespaceEntries >= EPHEMERAL_LIMITS.maxEntriesPerNamespace
        || usage.actorEntries >= EPHEMERAL_LIMITS.maxEntriesPerActor) {
        throw presenceError('AUTH_PRESENCE_CAPACITY_EXCEEDED');
      }
      if (!this.sequences.has(principal.connectionId) && this.sequences.size >= EPHEMERAL_LIMITS.maxEntriesTotal) {
        throw presenceError('AUTH_PRESENCE_CAPACITY_EXCEEDED');
      }
    }
    const lease: StoredLease = Object.freeze({ ...principal, namespace, key, sequence: input.sequence,
      visible: input.visible, lastActivityAt: input.activity ? this.now() : previous?.lastActivityAt ?? null });
    this.leases.set(principal.connectionId, lease);
    this.sequences.set(principal.connectionId, input.sequence);
    this.manager.set(namespace, key, { sequence: lease.sequence, visible: lease.visible,
      lastActivityAt: lease.lastActivityAt } as JsonValue, principal.userId, this.config.leaseDurationMs);
    this.onAffected(principal.scope, principal.userId);
  }

  /** Read only current TTL leases; no clock from the client can renew or age a lease. */
  forUser(scope: ServiceDataScope, userId: string): readonly PresenceActivityLease[] {
    const namespace = `_guardian-presence:${serviceDataScopeKey(scope)}`;
    const entries = this.manager.getSnapshot(namespace);
    return [...this.leases.values()].filter(lease => lease.namespace === namespace && lease.userId === userId
      && Object.hasOwn(entries, lease.key));
  }

  /** Clean close retires only this connection, never all tabs/devices of its user. */
  release(connectionId: string): void {
    this.sequences.delete(connectionId);
    const lease = this.leases.get(connectionId);
    if (!lease) return;
    this.leases.delete(connectionId); this.manager.delete(lease.namespace, lease.key);
    this.onAffected(lease.scope, lease.userId);
  }

  /** Return deduplicated affected principals for automatic inactivity sweeps. */
  principals(): readonly Pick<PresenceLeasePrincipal, 'scope' | 'userId'>[] {
    const distinct = new Map<string, Pick<PresenceLeasePrincipal, 'scope' | 'userId'>>();
    for (const lease of this.leases.values()) distinct.set(JSON.stringify([serviceDataScopeKey(lease.scope), lease.userId]), lease);
    return [...distinct.values()];
  }

  /** Disposal cannot re-add entries/timers when retained work settles later. */
  close(): void {
    if (this.closed) return;
    this.closed = true; this.removeExpiration();
    for (const lease of this.leases.values()) this.manager.delete(lease.namespace, lease.key);
    this.leases.clear();
    this.sequences.clear();
  }

  private expired(expiration: EphemeralExpiration): void {
    if (this.closed || !expiration.namespace.startsWith('_guardian-presence:')) return;
    for (const [connectionId, lease] of this.leases) {
      if (lease.namespace === expiration.namespace && lease.key === expiration.key) {
        this.leases.delete(connectionId); this.onAffected(lease.scope, lease.userId); break;
      }
    }
  }
}

function assertReport(input: PresenceActivityReport): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'activity,sequence,visible'
    || !Number.isSafeInteger(input.sequence) || input.sequence < 1
    || typeof input.activity !== 'boolean' || typeof input.visible !== 'boolean') {
    throw presenceError('AUTH_PRESENCE_INVALID_INPUT');
  }
}
