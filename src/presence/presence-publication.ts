/** Strict bounded publication values and fingerprints; no gateway closures or auth credentials cross IPC. */
import { stableStringify } from '../migrations/schema-snapshot';
import type { Row } from '../sync/types';
import { presenceError } from './presence-error';

export interface PresenceProjectionRow extends Row {
  readonly id: string; readonly scope_kind: 'application' | 'tenant'; readonly scope_id: string;
  readonly user_id: string; readonly status_key: string; readonly connected: 0 | 1;
  readonly revision: number; readonly owner_epoch: number; readonly updated_at: number;
}
/** Reset/merge/ready allow bounded directory snapshot pages without promoting partial projections. */
export interface PresencePublication {
  readonly installationId: string;
  readonly targetId: string;
  readonly scopeKind: 'application' | 'tenant';
  readonly scopeId: string;
  readonly ownerEpoch: number;
  readonly sourceAuthorityRevision: number;
  readonly revision: number;
  readonly freshUntil: number;
  readonly mode: 'reset' | 'merge' | 'ready' | 'checkpoint' | 'retire';
  readonly rows: readonly PresenceProjectionRow[];
  readonly removedIds: readonly string[];
}
export interface PresenceProjectionReceipt {
  readonly ownerEpoch: number;
  readonly revision: number;
  readonly applied: boolean;
  readonly duplicate: boolean;
}

/** Stable scope/user key, independent from tab/device IDs and status changes. */
export function presenceRowId(scopeKind: 'application' | 'tenant', scopeId: string, userId: string): string {
  return `gp_${new Bun.CryptoHasher('sha256').update(JSON.stringify([scopeKind, scopeId, userId])).digest('hex')}`;
}

/** Reject extensions/coercion and detach only bounded, canonical projection values. */
export function capturePresencePublication(input: unknown): PresencePublication {
  const value = record(input);
  exact(value, ['installationId', 'targetId', 'scopeKind', 'scopeId', 'ownerEpoch', 'sourceAuthorityRevision', 'revision', 'freshUntil', 'mode', 'rows', 'removedIds']);
  if (value.scopeKind !== 'application' && value.scopeKind !== 'tenant') throw invalid();
  const scopeKind = value.scopeKind, scopeId = id(value.scopeId);
  if (scopeKind === 'application' && scopeId !== 'application') throw invalid();
  const targetId = id(value.targetId);
  if (targetId !== (scopeKind === 'application' ? 'application' : `tenant:${scopeId}`)) throw invalid();
  if (!['reset', 'merge', 'ready', 'checkpoint', 'retire'].includes(value.mode as string)
    || typeof value.mode !== 'string' || !Array.isArray(value.rows) || value.rows.length > 500
    || !Array.isArray(value.removedIds) || value.removedIds.length > 500) throw invalid();
  const epoch = integer(value.ownerEpoch, 1), revision = integer(value.revision, 1);
  const rows = value.rows.map(inputRow => {
    const row = record(inputRow);
    exact(row, ['id', 'scope_kind', 'scope_id', 'user_id', 'status_key', 'connected', 'revision', 'owner_epoch', 'updated_at']);
    const userId = id(row.user_id);
    if (row.scope_kind !== scopeKind || row.scope_id !== scopeId
      || row.id !== presenceRowId(scopeKind, scopeId, userId)
      || row.connected !== 0 && row.connected !== 1
      || row.connected === 0 && row.status_key !== 'offline'
      || typeof row.status_key !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/u.test(row.status_key)
      || row.owner_epoch !== epoch || integer(row.revision, 1) > revision) throw invalid();
    return Object.freeze({ id: row.id, scope_kind: scopeKind, scope_id: scopeId, user_id: userId,
      status_key: row.status_key, connected: row.connected, revision: row.revision as number,
      owner_epoch: epoch, updated_at: integer(row.updated_at, 0) }) as PresenceProjectionRow;
  });
  const removedIds = value.removedIds.map(value => {
    if (typeof value !== 'string' || !/^gp_[0-9a-f]{64}$/u.test(value)) throw invalid();
    return value;
  });
  if (new Set(rows.map(row => row.id)).size !== rows.length || new Set(removedIds).size !== removedIds.length
    || rows.some(row => removedIds.includes(row.id))
    || value.mode !== 'merge' && (rows.length || removedIds.length)) throw invalid();
  return Object.freeze({ installationId: id(value.installationId), targetId, scopeKind, scopeId,
    ownerEpoch: epoch, sourceAuthorityRevision: integer(value.sourceAuthorityRevision, 0), revision, freshUntil: integer(value.freshUntil, 0),
    mode: value.mode as PresencePublication['mode'], rows: Object.freeze(rows), removedIds: Object.freeze(removedIds) });
}

/** Equal publication revisions must identify the same canonical payload, not just the same row key. */
export function presencePublicationFingerprint(publication: PresencePublication): string {
  return new Bun.CryptoHasher('sha256').update(stableStringify(publication)).digest('hex');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw invalid();
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 300 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) throw invalid();
  return value;
}
function integer(value: unknown, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw invalid();
  return value as number;
}
function invalid() { return presenceError('AUTH_PRESENCE_PROJECTION_INVALID'); }
