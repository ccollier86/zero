/** Pure server status precedence and catalog policy; heartbeats never imply human activity. */
import type {
  AuthPresenceIntent, AuthPresenceStatusDefinition, ResolvedAuthPresenceConfig,
} from '../auth/auth-presence-types';

export interface PresenceActivityLease {
  readonly lastActivityAt: number | null;
  readonly visible: boolean;
}

/** Stable public catalog; only configured manual keys can be written by a user. */
export function presenceStatusCatalog(config: ResolvedAuthPresenceConfig): readonly AuthPresenceStatusDefinition[] {
  return Object.freeze(([
    { key: 'available', label: 'Available', tone: 'success', icon: 'circle-check', selectable: true },
    { key: 'idle', label: 'Idle', tone: 'warning', icon: 'clock', selectable: false },
    { key: 'away', label: 'Away', tone: 'warning', icon: 'moon', selectable: true },
    { key: 'busy', label: 'Busy', tone: 'destructive', icon: 'pause', selectable: true },
    { key: 'offline', label: 'Offline', tone: 'muted', selectable: false },
    ...(config.onCallEnabled ? [{ key: 'on-call', label: 'On call', tone: 'primary', icon: 'signal', selectable: true } as const] : []),
    ...config.customStatuses.map(status => ({ ...status, selectable: true })),
  ] as AuthPresenceStatusDefinition[]).map(status => Object.freeze(status)));
}

/** A live active tab wins over idle/hidden tabs; manual busy/away/custom intent wins over activity. */
export function effectivePresenceStatus(
  leases: readonly PresenceActivityLease[], intent: AuthPresenceIntent,
  config: ResolvedAuthPresenceConfig, now: number,
): string {
  if (!leases.length) return 'offline';
  const manual = intent.expiresAt === null || intent.expiresAt > now ? intent.status : 'available';
  const admitted = presenceStatusCatalog(config).some(status => status.selectable && status.key === manual);
  if (admitted && manual !== 'available') return manual;
  if (leases.some(lease => lease.visible && lease.lastActivityAt !== null
    && now - lease.lastActivityAt < config.idleAfterMs)) return 'available';
  if (leases.some(lease => lease.lastActivityAt !== null
    && now - lease.lastActivityAt < config.awayAfterMs)) return 'idle';
  return 'away';
}
