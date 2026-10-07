/** Synchronous SYSTEM owner claims and manual intent CAS; publication mechanics live in separate stores. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { AuthPresenceIntent, ResolvedAuthPresenceConfig, UpdateAuthPresenceIntentInput } from '../auth/auth-presence-types';
import { presenceError } from './presence-error';
import { PRESENCE_OWNER_TABLE, presenceSystemSchemaReady, registerPresenceProjectionTables } from './presence-schema';
import { presenceStatusCatalog } from './presence-status';

export interface PresenceOwnerClaim {
  readonly installationId: string;
  readonly ownerId: string;
  readonly ownerEpoch: number;
  readonly freshUntil: number;
}
interface OwnerRow { installation_id: string; owner_id: string; owner_epoch: number; lease_until: number; next_revision: number }

/** Exact claim CAS prevents two gateways from independently aggregating the same SYSTEM installation. */
export class PresenceSystemStore {
  constructor(private readonly db: ReactiveDB, private readonly now: () => number = Date.now) {}

  ready(): boolean { return presenceSystemSchemaReady(this.db); }
  register(): void { this.assertReady(); registerPresenceProjectionTables(this.db); }

  /** An unexpired different owner is pending, not overridden. Recovery can claim only after retirement/expiry. */
  claim(ownerId: string, durationMs: number): PresenceOwnerClaim | null {
    this.assertReady();
    return this.db.transaction(() => {
      const now = this.now(), current = this.owner();
      if (current && current.owner_id !== ownerId && current.lease_until > now) return null;
      const epoch = current ? current.owner_id === ownerId && current.lease_until > now
        ? current.owner_epoch : current.owner_epoch + 1 : 1;
      if (!Number.isSafeInteger(epoch)) throw presenceError('AUTH_PRESENCE_OWNER_LOST');
      const installationId = current?.installation_id ?? crypto.randomUUID(), freshUntil = now + durationMs;
      this.db.prepare(`INSERT INTO _guardian_presence_authority
        (owner_key,installation_id,owner_id,owner_epoch,lease_until,next_revision) VALUES ('primary',?,?,?,?,1)
        ON CONFLICT(owner_key) DO UPDATE SET owner_id=excluded.owner_id,owner_epoch=excluded.owner_epoch,
          lease_until=excluded.lease_until,next_revision=CASE WHEN owner_epoch=excluded.owner_epoch THEN next_revision ELSE 1 END`)
        .run(installationId, ownerId, epoch, freshUntil);
      this.writeOwner(epoch, freshUntil, false);
      return Object.freeze({ installationId, ownerId, ownerEpoch: epoch, freshUntil });
    });
  }

  /** Renew one bounded shared owner checkpoint, never one SQL write per connection heartbeat. */
  checkpoint(claim: PresenceOwnerClaim, durationMs: number): PresenceOwnerClaim {
    return this.db.transaction(() => {
      this.assertOwner(claim); const freshUntil = this.now() + durationMs;
      this.db.prepare('UPDATE _guardian_presence_authority SET lease_until=? WHERE owner_key=?').run(freshUntil, 'primary');
      this.writeOwner(claim.ownerEpoch, freshUntil, false);
      return Object.freeze({ ...claim, freshUntil });
    });
  }

  /** Orderly shutdown publishes retirement while the SYSTEM runtime is still usable. */
  retire(claim: PresenceOwnerClaim): void {
    this.db.transaction(() => {
      const current = this.owner();
      if (!current || current.owner_id !== claim.ownerId || current.owner_epoch !== claim.ownerEpoch) return;
      this.db.prepare('UPDATE _guardian_presence_authority SET lease_until=0 WHERE owner_key=?').run('primary');
      this.writeOwner(claim.ownerEpoch, 0, true);
    });
  }

  /** Synchronous guard used at admission and publication FIFO/transaction boundaries. */
  assertOwner(claim: PresenceOwnerClaim): void {
    const current = this.owner();
    if (!current || current.owner_id !== claim.ownerId || current.owner_epoch !== claim.ownerEpoch
      || current.installation_id !== claim.installationId || current.lease_until <= this.now()) {
      throw presenceError('AUTH_PRESENCE_OWNER_LOST');
    }
  }

  /** Allocate monotonic publication order inside the surrounding SYSTEM transaction. */
  reserveRevision(claim: PresenceOwnerClaim): number {
    this.assertOwner(claim); const revision = this.owner()!.next_revision;
    if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER) throw presenceError('AUTH_PRESENCE_OWNER_LOST');
    this.db.prepare('UPDATE _guardian_presence_authority SET next_revision=next_revision+1 WHERE owner_key=?').run('primary');
    return revision;
  }

  /** Read app/org-scoped user intent; no membership, roles, or identity are inferred here. */
  intent(scope: ServiceDataScope, userId: string): AuthPresenceIntent {
    this.assertReady();
    const row = this.db.prepare(`SELECT status_key,expires_at,revision FROM _guardian_presence_intents
      WHERE scope_kind=? AND scope_id=? AND user_id=?`).get(scope.scopeKind, scope.scopeId, userId) as {
        status_key: string; expires_at: number | null; revision: number;
      } | null;
    return row ? Object.freeze({ status: row.status_key, expiresAt: row.expires_at, revision: row.revision })
      : Object.freeze({ status: 'available', expiresAt: null, revision: 0 });
  }

  /** User intent CAS and authority checks join one immediate writer transaction. */
  updateIntent(scope: ServiceDataScope, userId: string, input: UpdateAuthPresenceIntentInput,
    config: ResolvedAuthPresenceConfig, claim: PresenceOwnerClaim, assertAuthority: () => void): AuthPresenceIntent {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['status', 'expectedRevision', 'expiresAfterMs'].includes(key))
      || typeof input.status !== 'string' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
      || !presenceStatusCatalog(config).some(status => status.selectable && status.key === input.status)
      || input.expiresAfterMs != null && (!Number.isSafeInteger(input.expiresAfterMs)
        || input.expiresAfterMs < 1_000 || input.expiresAfterMs > 604_800_000)) {
      throw presenceError('AUTH_PRESENCE_INVALID_INPUT');
    }
    return this.db.transaction(() => {
      this.assertOwner(claim); assertAuthority();
      const previous = this.intent(scope, userId);
      if (previous.revision !== input.expectedRevision) throw presenceError('AUTH_PRESENCE_REVISION_CONFLICT');
      if (!Number.isSafeInteger(previous.revision) || previous.revision >= Number.MAX_SAFE_INTEGER) throw presenceError('AUTH_PRESENCE_REVISION_CONFLICT');
      const now = this.now(), expiresAt = input.expiresAfterMs == null ? null : now + input.expiresAfterMs;
      this.db.prepare(`INSERT INTO _guardian_presence_intents
        (scope_kind,scope_id,user_id,status_key,expires_at,revision,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(scope_kind,scope_id,user_id) DO UPDATE SET status_key=excluded.status_key,
          expires_at=excluded.expires_at,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(scope.scopeKind, scope.scopeId, userId, input.status, expiresAt, previous.revision + 1, now);
      assertAuthority(); this.assertOwner(claim);
      return Object.freeze({ status: input.status, expiresAt, revision: previous.revision + 1 });
    });
  }

  private owner(): OwnerRow | null {
    this.assertReady();
    return this.db.prepare('SELECT installation_id,owner_id,owner_epoch,lease_until,next_revision FROM _guardian_presence_authority WHERE owner_key=?')
      .get('primary') as OwnerRow | null;
  }
  private assertReady(): void { if (!this.ready()) throw presenceError('AUTH_PRESENCE_NOT_READY'); }
  private writeOwner(epoch: number, freshUntil: number, retired: boolean): void {
    this.db.insert(PRESENCE_OWNER_TABLE, { owner_key: 'primary', owner_epoch: epoch, fresh_until: freshUntil, retired: retired ? 1 : 0 });
  }
}
