/** Canonical tracked SYSTEM publication and durable bounded actor-delivery outbox. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { readAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { presenceError } from './presence-error';
import { PRESENCE_TABLE } from './presence-client-tables';
import { capturePresencePublication, presenceRowId, type PresencePublication, type PresenceProjectionRow } from './presence-publication';
import { PresenceSystemStore, type PresenceOwnerClaim } from './presence-system-store';

export interface PendingPresencePublication { readonly eventId: string; readonly publication: PresencePublication }

/** Atomic source changes and outbox receipts use the already-owned SYSTEM writer. */
export class PresenceCanonicalStore {
  constructor(private readonly db: ReactiveDB, private readonly system: PresenceSystemStore, private readonly now: () => number = Date.now) {}

  rows(scope?: ServiceDataScope): readonly PresenceProjectionRow[] {
    return (scope ? this.db.prepare(`SELECT * FROM guardian_presence WHERE scope_kind=? AND scope_id=? ORDER BY id`).all(scope.scopeKind, scope.scopeId)
      : this.db.prepare('SELECT * FROM guardian_presence ORDER BY id').all()) as PresenceProjectionRow[];
  }
  /** Public readers select a bounded cursor page or one exact self row, never a full directory. */
  page(scope: ServiceDataScope, limit: number, after = ''): readonly PresenceProjectionRow[] {
    return this.db.prepare(`SELECT * FROM guardian_presence WHERE scope_kind=? AND scope_id=? AND id>?
      ORDER BY id LIMIT ?`).all(scope.scopeKind, scope.scopeId, after, limit) as PresenceProjectionRow[];
  }
  user(scope: ServiceDataScope, userId: string): PresenceProjectionRow | null {
    return this.db.prepare('SELECT * FROM guardian_presence WHERE scope_kind=? AND scope_id=? AND user_id=?')
      .get(scope.scopeKind, scope.scopeId, userId) as PresenceProjectionRow | null;
  }

  /** Publish only meaningful status/connectivity changes; a heartbeat never advances this row. */
  change(claim: PresenceOwnerClaim, scope: ServiceDataScope, userId: string, status: string, connected: boolean, publish = true,
    assertCurrent: () => void = () => {}): PresencePublication | null {
    return this.db.transaction(() => {
      this.system.assertOwner(claim); assertCurrent();
      const id = presenceRowId(scope.scopeKind, scope.scopeId, userId);
      const previous = this.db.get(PRESENCE_TABLE, id) as PresenceProjectionRow | null;
      if (previous?.owner_epoch === claim.ownerEpoch && previous.status_key === status && previous.connected === Number(connected)) return null;
      const revision = this.system.reserveRevision(claim);
      const row: PresenceProjectionRow = { id, scope_kind: scope.scopeKind, scope_id: scope.scopeId, user_id: userId,
        status_key: status, connected: connected ? 1 : 0, revision, owner_epoch: claim.ownerEpoch, updated_at: this.now() };
      this.db.insert(PRESENCE_TABLE, row);
      if (!publish) { this.system.assertOwner(claim); assertCurrent(); return null; }
      const publication = this.packet(claim, scope, revision, 'merge', [row], []);
      if (publish) this.enqueue(publication); this.system.assertOwner(claim); assertCurrent(); return publication;
    });
  }

  /** Removed memberships are tombstoned in the same publication transaction. */
  remove(claim: PresenceOwnerClaim, row: PresenceProjectionRow): void {
    this.db.transaction(() => {
      this.system.assertOwner(claim); const revision = this.system.reserveRevision(claim);
      this.db.delete(PRESENCE_TABLE, row.id);
      this.enqueue(this.packet(claim, { scopeKind: row.scope_kind, scopeId: row.scope_id }, revision, 'merge', [], [row.id]));
    });
  }

  /** Epoch reset and owner freshness transitions are separate bounded shared writes. */
  marker(claim: PresenceOwnerClaim, scope: Pick<ServiceDataScope, 'scopeKind' | 'scopeId'>, mode: Exclude<PresencePublication['mode'], 'merge'>): PresencePublication {
    return this.db.transaction(() => {
      const revision = this.system.reserveRevision(claim);
      const packet = this.packet(claim, scope, revision, mode, [], []); this.enqueue(packet); return packet;
    });
  }

  /** Bootstrap pages are emitted before the target's explicit ready receipt. */
  snapshot(claim: PresenceOwnerClaim, scope: ServiceDataScope): void {
    this.marker(claim, scope, 'reset');
    this.snapshotRows(claim, scope);
    this.marker(claim, scope, 'ready');
  }
  /** Full bounded rows are also required after same-owner retry; unchanged rows cannot be omitted after reset. */
  snapshotRows(claim: PresenceOwnerClaim, scope: ServiceDataScope): void {
    const rows = this.rows(scope);
    for (let start = 0; start < rows.length; start += 500) this.db.transaction(() => {
      const revision = this.system.reserveRevision(claim);
      this.enqueue(this.packet(claim, scope, revision, 'merge', rows.slice(start, start + 500), []));
    });
  }

  pending(limit = 100): readonly PendingPresencePublication[] {
    return (this.db.prepare(`SELECT o.event_id,o.payload_json FROM _guardian_presence_outbox o WHERE o.retry_at<=?
      AND NOT EXISTS (SELECT 1 FROM _guardian_presence_outbox earlier WHERE earlier.scope_kind=o.scope_kind
        AND earlier.scope_id=o.scope_id AND (earlier.owner_epoch<o.owner_epoch
          OR (earlier.owner_epoch=o.owner_epoch AND earlier.publication_revision<o.publication_revision)))
      ORDER BY o.owner_epoch,o.publication_revision LIMIT ?`)
      .all(this.now(), limit) as { event_id: string; payload_json: string }[])
      .map(row => ({ eventId: row.event_id, publication: capturePresencePublication(JSON.parse(row.payload_json)) }));
  }
  accepted(eventId: string): void { this.db.prepare('DELETE FROM _guardian_presence_outbox WHERE event_id=?').run(eventId); }
  hasPending(scope: ServiceDataScope): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM _guardian_presence_outbox WHERE scope_kind=? AND scope_id=? LIMIT 1').get(scope.scopeKind, scope.scopeId));
  }
  retry(eventId: string): void {
    this.db.prepare('UPDATE _guardian_presence_outbox SET retry_at=?,last_error=? WHERE event_id=?')
      .run(this.now() + 1000, 'AUTH_PRESENCE_PROJECTION_INVALID', eventId);
  }
  /** Earlier-owner packets must not keep a replacement owner's readiness falsely pending. */
  discardRetiredEpochs(claim: PresenceOwnerClaim): void {
    this.system.assertOwner(claim);
    this.db.prepare('DELETE FROM _guardian_presence_outbox WHERE owner_epoch<>?').run(claim.ownerEpoch);
  }
  /** Durable source snapshot revision, not a clock captured after the directory snapshot was computed. */
  authorityRevision(): number {
    const revision = readAuthAuthorityRevision(this.db);
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw presenceError('AUTH_PRESENCE_NOT_READY');
    return revision as number;
  }
  discardObsoleteAuthority(claim: PresenceOwnerClaim): ReadonlySet<string> {
    this.system.assertOwner(claim);
    const rows = this.db.prepare("SELECT DISTINCT scope_kind,scope_id FROM _guardian_presence_outbox WHERE json_extract(payload_json,'$.sourceAuthorityRevision')<>?")
      .all(this.authorityRevision()) as { scope_kind: string; scope_id: string }[];
    this.db.prepare("DELETE FROM _guardian_presence_outbox WHERE json_extract(payload_json,'$.sourceAuthorityRevision')<>?").run(this.authorityRevision());
    return new Set(rows.map(row => row.scope_kind === 'application' ? 'application' : `tenant:${row.scope_id}`));
  }

  private packet(claim: PresenceOwnerClaim, scope: Pick<ServiceDataScope, 'scopeKind' | 'scopeId'>, revision: number,
    mode: PresencePublication['mode'], rows: readonly PresenceProjectionRow[], removedIds: readonly string[]): PresencePublication {
    return capturePresencePublication({ installationId: claim.installationId,
      targetId: scope.scopeKind === 'application' ? 'application' : `tenant:${scope.scopeId}`,
      scopeKind: scope.scopeKind, scopeId: scope.scopeId, ownerEpoch: claim.ownerEpoch, revision,
      sourceAuthorityRevision: this.authorityRevision(),
      freshUntil: mode === 'retire' ? 0 : claim.freshUntil, mode, rows, removedIds });
  }
  private enqueue(publication: PresencePublication): void {
    if (publication.rows.length > 500) throw presenceError('AUTH_PRESENCE_PROJECTION_INVALID');
    const size = this.db.prepare('SELECT count(*) AS total FROM _guardian_presence_outbox').get() as { total: number };
    if (size.total >= 10_000) throw presenceError('AUTH_PRESENCE_CAPACITY_EXCEEDED');
    this.db.prepare(`INSERT INTO _guardian_presence_outbox
      (event_id,scope_kind,scope_id,owner_epoch,publication_revision,payload_json,retry_at,last_error) VALUES (?,?,?,?,?,?,0,NULL)`)
      .run(crypto.randomUUID(), publication.scopeKind, publication.scopeId, publication.ownerEpoch, publication.revision, JSON.stringify(publication));
  }
}
