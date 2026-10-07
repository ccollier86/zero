/** Actor-owned, monotonic scoped projection application; only the private writer operation can invoke it. */
import type { ReactiveDB } from '../sync/reactive-db';
import { presenceError } from './presence-error';
import { capturePresencePublication, presencePublicationFingerprint, type PresenceProjectionReceipt } from './presence-publication';
import { PRESENCE_OWNER_TABLE, PRESENCE_TABLE } from './presence-schema';

export const PRESENCE_PROJECTION_BINDING_TABLE = '_guardian_presence_projection_binding';
export const PRESENCE_PROJECTION_BINDING_SQL = `CREATE TABLE IF NOT EXISTS _guardian_presence_projection_binding (
  target_key TEXT PRIMARY KEY, installation_id TEXT NOT NULL, target_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, owner_epoch INTEGER NOT NULL,
  publication_revision INTEGER NOT NULL, fingerprint TEXT NOT NULL, ready INTEGER NOT NULL
)`;
export interface PresenceProjectionState {
  readonly installationId: string; readonly targetId: string; readonly ownerEpoch: number;
  readonly revision: number; readonly ready: boolean;
}
interface BindingRow { installation_id: string; target_id: string; scope_kind: string; scope_id: string;
  owner_epoch: number; publication_revision: number; fingerprint: string; ready: number }

/** Apply actual ReactiveDB changes and target-local receipts in one serialized actor transaction. */
export class PresenceProjectionStore {
  constructor(private readonly db: ReactiveDB) {}

  inspect(targetId?: string): PresenceProjectionState | null {
    const row = this.binding(targetId);
    return row ? Object.freeze({ installationId: row.installation_id, targetId: row.target_id,
      ownerEpoch: row.owner_epoch, revision: row.publication_revision, ready: row.ready === 1 }) : null;
  }

  /** Duplicate delivery is idempotent; older owner/revision and mismatched installation cannot overwrite. */
  apply(input: unknown): PresenceProjectionReceipt {
    const value = capturePresencePublication(input), fingerprint = presencePublicationFingerprint(value);
    return this.db.transaction(() => {
      const old = this.binding(value.targetId);
      if (old && (old.installation_id !== value.installationId || old.target_id !== value.targetId
        || old.scope_kind !== value.scopeKind || old.scope_id !== value.scopeId)) throw invalid();
      if (old && (value.ownerEpoch < old.owner_epoch
        || value.ownerEpoch === old.owner_epoch && value.revision < old.publication_revision)) {
        return receipt(value.ownerEpoch, value.revision, false, false);
      }
      if (old && value.ownerEpoch === old.owner_epoch && value.revision === old.publication_revision) {
        if (old.fingerprint !== fingerprint) throw invalid();
        return receipt(value.ownerEpoch, value.revision, false, true);
      }
      if ((!old || value.ownerEpoch > old.owner_epoch) && value.mode !== 'reset') throw invalid();
      if (value.mode === 'reset') {
        const rows = this.db.prepare('SELECT id FROM guardian_presence WHERE scope_kind=? AND scope_id=?').all(value.scopeKind, value.scopeId) as { id: string }[];
        for (const row of rows) this.db.delete(PRESENCE_TABLE, row.id);
      }
      for (const row of value.rows) this.db.insert(PRESENCE_TABLE, row);
      for (const id of value.removedIds) this.db.delete(PRESENCE_TABLE, id);
      this.db.insert(PRESENCE_OWNER_TABLE, { owner_key: value.targetId, owner_epoch: value.ownerEpoch,
        fresh_until: value.freshUntil, retired: value.mode === 'retire' ? 1 : 0 });
      const ready = value.mode === 'reset' || value.mode === 'retire' ? 0 : value.mode === 'ready' ? 1 : old?.ready ?? 0;
      this.db.prepare(`INSERT INTO _guardian_presence_projection_binding
        (target_key,installation_id,target_id,scope_kind,scope_id,owner_epoch,publication_revision,fingerprint,ready)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(target_key) DO UPDATE SET
          owner_epoch=excluded.owner_epoch,publication_revision=excluded.publication_revision,
          fingerprint=excluded.fingerprint,ready=excluded.ready`)
        .run(value.targetId, value.installationId, value.targetId, value.scopeKind, value.scopeId, value.ownerEpoch, value.revision, fingerprint, ready);
      return receipt(value.ownerEpoch, value.revision, true, false);
    });
  }

  private binding(targetId?: string): BindingRow | null {
    return (targetId === undefined ? this.db.prepare('SELECT installation_id,target_id,scope_kind,scope_id,owner_epoch,publication_revision,fingerprint,ready FROM _guardian_presence_projection_binding ORDER BY target_key LIMIT 1').get()
      : this.db.prepare('SELECT installation_id,target_id,scope_kind,scope_id,owner_epoch,publication_revision,fingerprint,ready FROM _guardian_presence_projection_binding WHERE target_key=?').get(targetId)) as BindingRow | null;
  }
}
function receipt(ownerEpoch: number, revision: number, applied: boolean, duplicate: boolean): PresenceProjectionReceipt {
  return Object.freeze({ ownerEpoch, revision, applied, duplicate });
}
function invalid() { return presenceError('AUTH_PRESENCE_PROJECTION_INVALID'); }
