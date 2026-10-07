/** Freshness-aware projection over the SDK's ordered, scoped ReactiveDB cache. */
import type { Row } from '../../sync/types';
import type { AuthPresenceCapabilities, AuthPresenceObservation } from '../../auth/auth-presence-types';

export function readGuardianPresenceRows(rows: Readonly<Record<string, Row>>, owner: Row | undefined,
  scope: { scopeKind: 'application' | 'tenant'; scopeId: string }, capabilities: AuthPresenceCapabilities | null,
  connected: boolean, now: number): Readonly<Record<string, AuthPresenceObservation>> {
  if (!capabilities?.enabled || capabilities.state !== 'ready') return {};
  const result: Record<string, AuthPresenceObservation> = {};
  for (const row of Object.values(rows)) {
    if (row.scope_kind !== scope.scopeKind || row.scope_id !== scope.scopeId || typeof row.user_id !== 'string'
      || typeof row.status_key !== 'string' || !capabilities.statuses.some(status => status.key === row.status_key)
      || !nonnegativeInteger(row.revision) || !nonnegativeInteger(row.owner_epoch) || !nonnegativeInteger(row.updated_at)
      || row.connected !== 0 && row.connected !== 1) continue;
    const fresh = connected && owner?.retired === 0 && owner.owner_epoch === row.owner_epoch
      && owner.owner_key === 'primary' && nonnegativeInteger(owner.fresh_until) && owner.fresh_until > now
      && owner.fresh_until - now <= capabilities.ownerLeaseDurationMs;
    result[row.user_id] = Object.freeze({ userId: row.user_id, status: row.status_key,
      connected: row.connected === 1, revision: row.revision, ownerEpoch: row.owner_epoch,
      updatedAt: row.updated_at, freshUntil: nonnegativeInteger(owner?.fresh_until) ? owner.fresh_until : 0, stale: !fresh });
  }
  return Object.freeze(result);
}
function nonnegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
