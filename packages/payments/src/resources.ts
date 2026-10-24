/** Private provider ownership and intent records. Never infer ownership from email, an event payload or a browser resource ID. */
import type { ReactiveDB } from '@zero/framework/sync';
import type { BillingPage, BillingPageQuery } from '@zero/framework/payments';
import { canonical, hash, type BillingCommandOwner } from './store';
import { PaymentsError, invalid } from './errors';

export interface PaymentIntentRecord { reference: string; owner: BillingCommandOwner; operationId: string; details: Record<string, unknown> }
export interface PaymentResource<T = unknown> { kind: string; id: string; owner: BillingCommandOwner; reference: string | null; data: T | null; created: number }
export const providerJson = (value: unknown): string => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);

/** Provider-specific resource proofs supplement the shared customer directory without reassigning provider customers. */
export class PaymentsResources {
  constructor(private readonly db: ReactiveDB, private readonly connection: string) {
    db.transaction(() => {
      db.exec('CREATE TABLE IF NOT EXISTS _zero_payments_intents(connection TEXT NOT NULL,reference TEXT NOT NULL,owner TEXT NOT NULL,operation_id TEXT NOT NULL,details TEXT NOT NULL,PRIMARY KEY(connection,reference))');
      db.exec('CREATE TABLE IF NOT EXISTS _zero_payments_resources(connection TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,reference TEXT,data TEXT,created INTEGER NOT NULL,PRIMARY KEY(connection,kind,id))');
      db.exec('CREATE INDEX IF NOT EXISTS _zero_payments_resources_owner ON _zero_payments_resources(connection,owner,kind,created DESC,id DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS _zero_payments_resources_reference ON _zero_payments_resources(connection,owner,kind,reference,created DESC,id DESC)');
      db.exec('CREATE TABLE IF NOT EXISTS _zero_payments_square_attempts(connection TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(connection,id))');
    });
  }
  intent(owner: BillingCommandOwner, key: string, operationId: string, details: Record<string, unknown>): PaymentIntentRecord {
    const reference = hash(key).slice(0, 40), encoded = canonical(details);
    return this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO _zero_payments_intents VALUES(?,?,?,?,?)').run(this.connection, reference, canonical(owner), operationId, encoded);
      const stored = this.getIntent(reference)!;
      if (canonical(stored.owner) !== canonical(owner) || canonical(stored.details) !== encoded || stored.operationId !== operationId) throw new PaymentsError('Payment intent binding changed.', 'PAYMENTS_COMMAND_CONFLICT', 409);
      return stored;
    });
  }
  getIntent(reference: string): PaymentIntentRecord | null {
    const row = this.db.prepare('SELECT owner,operation_id,details FROM _zero_payments_intents WHERE connection=? AND reference=?').get(this.connection, reference) as { owner: string; operation_id: string; details: string } | null;
    return row ? { reference, owner: JSON.parse(row.owner), operationId: row.operation_id, details: JSON.parse(row.details) } : null;
  }
  bind<T>(owner: BillingCommandOwner, kind: string, id: string, data: T | null = null, reference: string | null = null, created = Date.now()): PaymentResource<T> {
    return this.db.transaction(() => {
      const prior = this.get<T>(kind, id);
      if (prior && (canonical(prior.owner) !== canonical(owner) || prior.reference && reference && prior.reference !== reference)) throw new PaymentsError('Provider resource already belongs to another billing intent.', 'PAYMENTS_BINDING_CONFLICT', 409);
      const value = data === null ? prior?.data ?? null : data;
      const providerCreated = data && typeof data === 'object' && 'createdAt' in data && typeof data.createdAt === 'string' ? Date.parse(data.createdAt) : NaN;
      const timestamp = prior?.data !== null && prior?.data !== undefined ? prior.created : Number.isFinite(providerCreated) ? providerCreated : created;
      this.db.prepare('INSERT INTO _zero_payments_resources VALUES(?,?,?,?,?,?,?) ON CONFLICT(connection,kind,id) DO UPDATE SET data=excluded.data,reference=excluded.reference,created=excluded.created').run(this.connection, kind, id, canonical(owner), reference ?? prior?.reference ?? null, value === null ? null : providerJson(value), timestamp);
      return this.get<T>(kind, id)!;
    });
  }
  get<T = unknown>(kind: string, id: string): PaymentResource<T> | null {
    const row = this.db.prepare('SELECT * FROM _zero_payments_resources WHERE connection=? AND kind=? AND id=?').get(this.connection, kind, id) as { owner: string; reference: string | null; data: string | null; created: number } | null;
    return row ? { kind, id, owner: JSON.parse(row.owner), reference: row.reference, data: row.data === null ? null : JSON.parse(row.data), created: row.created } : null;
  }
  require<T = unknown>(owner: BillingCommandOwner, kind: string, id: string): PaymentResource<T> {
    const row = this.get<T>(kind, id);
    if (!row || canonical(row.owner) !== canonical(owner)) throw new PaymentsError('Payment resource is outside this billing subject.', 'PAYMENTS_RESOURCE_FORBIDDEN', 403);
    return row;
  }
  page<T>(owner: BillingCommandOwner, kind: string, query: BillingPageQuery = {}): BillingPage<PaymentResource<T>> {
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || query.after !== undefined && (typeof query.after !== 'string' || query.after.length > 256)) invalid('Payment pagination is invalid.');
    const cursor = query.after ? this.require(owner, kind, query.after) : null;
    const rows = this.db.prepare(`SELECT id FROM _zero_payments_resources WHERE connection=? AND owner=? AND kind=? AND data IS NOT NULL
      ${cursor ? 'AND (created < ? OR (created = ? AND id < ?))' : ''} ORDER BY created DESC,id DESC LIMIT ?`).all(this.connection, canonical(owner), kind, ...(cursor ? [cursor.created, cursor.created, cursor.id] : []), limit + 1) as { id: string }[];
    return { items: rows.slice(0, limit).map(row => this.require<T>(owner, kind, row.id)), ...(rows.length > limit ? { next: rows[limit - 1]!.id } : {}) };
  }
  all<T>(owner: BillingCommandOwner, kind: string, maximum = 1000): PaymentResource<T>[] {
    const rows = this.db.prepare('SELECT id FROM _zero_payments_resources WHERE connection=? AND owner=? AND kind=? LIMIT ?').all(this.connection, canonical(owner), kind, maximum + 1) as { id: string }[];
    if (rows.length > maximum) throw new PaymentsError('Payment resource reconciliation exceeded its bound; no partial grants were published.', 'PAYMENTS_RECONCILE_LIMIT', 503);
    return rows.map(row => this.require<T>(owner, kind, row.id));
  }
  /** Reconciliation previews are bounded independently of the lifetime history; older rows remain pageable. */
  recent<T>(owner: BillingCommandOwner, kind: string, limit = 100, reference?: string, includePending = false): PaymentResource<T>[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) invalid('Invalid internal history bound.');
    const rows = this.db.prepare(`SELECT id FROM _zero_payments_resources WHERE connection=? AND owner=? AND kind=? ${includePending ? '' : 'AND data IS NOT NULL'} ${reference ? 'AND reference=?' : ''} ORDER BY created DESC,id DESC LIMIT ?`).all(this.connection, canonical(owner), kind, ...(reference ? [reference] : []), limit) as { id: string }[];
    return rows.map(row => this.require<T>(owner, kind, row.id));
  }
  /** Non-idempotent provider writes are attempted once; uncertain outcomes must be read/reconciled, never blindly resent. */
  attempt(id: string, digest: string): boolean {
    return this.db.transaction(() => this.db.prepare('INSERT OR IGNORE INTO _zero_payments_square_attempts VALUES(?,?,?)').run(this.connection, id, digest)).changes > 0;
  }
  clearAttempt(id: string, digest: string): void {
    this.db.transaction(() => this.db.prepare('DELETE FROM _zero_payments_square_attempts WHERE connection=? AND id=? AND digest=?').run(this.connection, id, digest));
  }
}
