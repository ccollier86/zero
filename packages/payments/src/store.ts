/** Private system-plane persistence. Provider calls never run inside a database transaction. */
import { createHash } from 'node:crypto';
import type { ReactiveDB } from '@zero/framework/sync';
import type { BillingSubject, BillingSnapshot, BillingOperation } from '@zero/framework/payments';
import { PaymentsError } from './errors';
import { publicSnapshot, type StoredBillingSnapshot } from './entitlements';
import type { PaymentsJob, PaymentsJobPage, PaymentsJobQuery } from './jobs';

export const PAYMENTS_VIEW_TABLE = '_zero_payments_views';
export function canonical(value: unknown): string {
  const normalize = (item: any): any => Array.isArray(item) ? item.map(normalize) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, normalize(item[key])])) : item;
  return JSON.stringify(normalize(value));
}
export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function subjectKey(subject: BillingSubject): string { return canonical(subject); }
/** Internal command partition for subjectless merchant work; never admitted from a browser payload. */
export type BillingCommandOwner = BillingSubject | { kind: 'merchant'; id: string };
const commandOwnerKey = (owner: BillingCommandOwner) => canonical(owner);
interface CommandRow { digest: string; status: string; result: string | null; created: number; lease: number; fence: string; error: string | null }
export interface InboxRow { id: string; payload: string; attempts: number; fence: string; customer: string | null; kind: 'webhook' | 'reconcile' | 'notify' }
export class PaymentsStore {
  constructor(readonly db: ReactiveDB, readonly connection: string, identity?: string) {
    db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS _zero_payments_schema(version INTEGER NOT NULL)');
    const versions = db.prepare('SELECT version FROM _zero_payments_schema').all() as { version: number }[];
    if (versions.length > 1 || versions.some(row => row.version !== 1)) throw new Error('[payments] Unsupported payment state schema; migration required.');
    for (const ddl of [
      'CREATE TABLE IF NOT EXISTS _zero_payments_connections(id TEXT PRIMARY KEY,identity TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS _zero_payments_customers(connection TEXT NOT NULL,subject TEXT NOT NULL,customer TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(connection,subject),UNIQUE(connection,customer))',
      'CREATE TABLE IF NOT EXISTS _zero_payments_commands(connection TEXT NOT NULL,subject TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created INTEGER NOT NULL,lease INTEGER NOT NULL,fence TEXT NOT NULL,error TEXT,PRIMARY KEY(connection,subject,id))',
      'CREATE TABLE IF NOT EXISTS _zero_payments_requests(connection TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,params TEXT NOT NULL,PRIMARY KEY(connection,id))',
      'CREATE TABLE IF NOT EXISTS _zero_payments_views(id TEXT PRIMARY KEY,connection TEXT NOT NULL,subject TEXT NOT NULL,revision INTEGER NOT NULL,snapshot TEXT NOT NULL,next_refresh INTEGER NOT NULL,UNIQUE(connection,subject))',
      'CREATE INDEX IF NOT EXISTS _zero_payments_views_refresh ON _zero_payments_views(connection,next_refresh)',
      'CREATE TABLE IF NOT EXISTS _zero_payments_inbox(connection TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,customer TEXT,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL,lease INTEGER NOT NULL DEFAULT 0,fence TEXT NOT NULL DEFAULT \'\',error TEXT,PRIMARY KEY(connection,id))',
      'CREATE INDEX IF NOT EXISTS _zero_payments_inbox_due ON _zero_payments_inbox(connection,status,due,lease)',
      'CREATE TABLE IF NOT EXISTS _zero_payments_locks(connection TEXT NOT NULL,id TEXT NOT NULL,fence TEXT NOT NULL,lease INTEGER NOT NULL,PRIMARY KEY(connection,id))',
    ]) db.exec(ddl);
    if (!versions.length) db.prepare('INSERT INTO _zero_payments_schema(version) VALUES(1)').run();
    if (identity) db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO _zero_payments_connections(id,identity) VALUES(?,?)').run(connection, identity);
      const row = db.prepare('SELECT identity FROM _zero_payments_connections WHERE id=?').get(connection) as { identity: string };
      if (row.identity !== identity) throw new PaymentsError('This connection ID belongs to another merchant/environment. Use a new connection ID.', 'PAYMENTS_CONNECTION_CONFLICT', 409);
    });
    });
  }
  customer(subject: BillingSubject): string | null { return (this.db.prepare('SELECT customer FROM _zero_payments_customers WHERE connection=? AND subject=?').get(this.connection, subjectKey(subject)) as { customer: string } | null)?.customer ?? null; }
  providerRequest<T>(id: string, kind: string): T | null {
    const row = this.db.prepare('SELECT kind,params FROM _zero_payments_requests WHERE connection=? AND id=?').get(this.connection, id) as { kind: string; params: string } | null;
    if (row && row.kind !== kind) throw new PaymentsError('Provider operation kind changed during replay.', 'PAYMENTS_COMMAND_CONFLICT', 409);
    return row ? JSON.parse(row.params) as T : null;
  }
  operation(subject: BillingCommandOwner, id: string, namespace: 'user' | 'merchant' = 'user'): BillingOperation | null {
    const row = this.db.prepare('SELECT status,created,error,lease FROM _zero_payments_commands WHERE connection=? AND subject=? AND id=?').get(this.connection, commandOwnerKey(subject), `${namespace}:${id}`) as Pick<CommandRow, 'status' | 'created' | 'error' | 'lease'> | null;
    return row ? { operationId: id, status: row.status as BillingOperation['status'], createdAt: new Date(row.created).toISOString(), error: row.error, retryAfterMs: Math.max(0, row.lease - Date.now()) } : null;
  }
  saveProviderRequest<T>(id: string, kind: string, params: T): T {
    return this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO _zero_payments_requests(connection,id,kind,params) VALUES(?,?,?,?)').run(this.connection, id, kind, canonical(params));
      return this.providerRequest<T>(id, kind)!;
    });
  }
  owner(customer: string): BillingSubject | null { const row = this.db.prepare('SELECT subject FROM _zero_payments_customers WHERE connection=? AND customer=?').get(this.connection, customer) as { subject: string } | null; return row ? JSON.parse(row.subject) : null; }
  bind(subject: BillingSubject, customer: string): void {
    this.db.transaction(() => {
      const existing = this.customer(subject); if (existing && existing !== customer) throw new PaymentsError('Billing subject is already bound to another customer.', 'PAYMENTS_BINDING_CONFLICT', 409);
      this.db.prepare('INSERT OR IGNORE INTO _zero_payments_customers(connection,subject,customer,created) VALUES(?,?,?,?)').run(this.connection, subjectKey(subject), customer, Date.now());
      if (this.customer(subject) !== customer) throw new PaymentsError('This provider customer belongs to a different subject.', 'PAYMENTS_BINDING_CONFLICT', 409);
    });
  }
  reserve(subject: BillingCommandOwner, operation: string, payload: unknown): { fence: string; key: string; replay?: unknown; uncertain?: boolean } {
    return this.db.transaction(() => {
      const owner = commandOwnerKey(subject), digest = hash(canonical(payload)), now = Date.now(), fence = crypto.randomUUID();
      const row = this.db.prepare('SELECT * FROM _zero_payments_commands WHERE connection=? AND subject=? AND id=?').get(this.connection, owner, operation) as CommandRow | null;
      const key = 'zero-' + hash(canonical([this.connection, owner, operation]));
      if (row) {
        if (row.digest !== digest) throw new PaymentsError('Operation ID already binds different payment input.', 'PAYMENTS_COMMAND_CONFLICT', 409);
        if (row.status === 'complete') return { fence: row.fence, key, replay: JSON.parse(row.result!) };
        if (row.status === 'rejected') throw new PaymentsError('This operation was rejected. Review the input before a new operation.', row.error ?? 'PAYMENTS_PROVIDER_REJECTED', 422);
        if (now - row.created > 23 * 3600000) throw new PaymentsError('This unresolved operation is outside the safe provider replay window. Manual reconciliation is required.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown');
        if (row.lease > now) throw new PaymentsError('This operation is still running. Reuse its operation ID after completion.', 'PAYMENTS_COMMAND_IN_PROGRESS', 409, 'unknown');
        const changed = this.db.prepare("UPDATE _zero_payments_commands SET status='pending',lease=?,fence=? WHERE connection=? AND subject=? AND id=? AND fence=? AND lease<=?").run(now + 240000, fence, this.connection, owner, operation, row.fence, now);
        if (!changed.changes) throw new PaymentsError('This operation has another active owner.', 'PAYMENTS_COMMAND_IN_PROGRESS', 409, 'unknown');
      } else this.db.prepare("INSERT INTO _zero_payments_commands(connection,subject,id,digest,status,created,lease,fence) VALUES(?,?,?,?,'pending',?,?,?)").run(this.connection, owner, operation, digest, now, now + 240000, fence);
      return { fence, key, uncertain: !!row && ['unknown', 'pending'].includes(row.status) };
    });
  }
  finish(subject: BillingCommandOwner, operation: string, fence: string, value: unknown, error?: PaymentsError): void {
    const changed = this.db.transaction(() => this.db.prepare('UPDATE _zero_payments_commands SET status=?,result=?,error=?,lease=0 WHERE connection=? AND subject=? AND id=? AND fence=?').run(error ? error.outcome === 'unknown' ? 'unknown' : error.retryable ? 'retryable' : 'rejected' : 'complete', error ? null : canonical(value), error?.code ?? null, this.connection, commandOwnerKey(subject), operation, fence));
    if (!changed.changes) throw new PaymentsError('Payment result lost its commit fence. Reconcile the existing operation.', 'PAYMENTS_OUTCOME_UNKNOWN', 409, 'unknown');
  }
  renewCommand(subject: BillingCommandOwner, operation: string, fence: string): void {
    const changed = this.db.transaction(() => this.db.prepare('UPDATE _zero_payments_commands SET lease=? WHERE connection=? AND subject=? AND id=? AND fence=? AND status=\'pending\' AND lease>?').run(Date.now() + 240000, this.connection, commandOwnerKey(subject), operation, fence, Date.now()));
    if (!changed.changes) throw new PaymentsError('Payment command lost its execution fence.', 'PAYMENTS_LEASE_LOST', 409, 'unknown');
  }
  assertCommand(subject: BillingCommandOwner, operation: string, fence: string): void {
    const row = this.db.prepare('SELECT created,lease,status FROM _zero_payments_commands WHERE connection=? AND subject=? AND id=? AND fence=?').get(this.connection, commandOwnerKey(subject), operation, fence) as Pick<CommandRow, 'created' | 'lease' | 'status'> | null;
    const now = Date.now();
    if (!row || row.status !== 'pending' || row.lease <= now || now - row.created >= 23 * 3600000) throw new PaymentsError('Payment execution is stale or outside its safe replay window. Reconcile the original operation.', 'PAYMENTS_LEASE_LOST', 409, 'unknown');
  }
  view(subject: BillingSubject): StoredBillingSnapshot | null { const row = this.db.prepare('SELECT snapshot FROM _zero_payments_views WHERE connection=? AND subject=?').get(this.connection, subjectKey(subject)) as { snapshot: string } | null; return row ? JSON.parse(row.snapshot) : null; }
  writeView(subject: BillingSubject, snapshot: StoredBillingSnapshot, lock: { id: string; fence: string }, notify = false, refreshMs = 150000): StoredBillingSnapshot {
    return this.db.transaction(() => {
      this.assertLock(lock); const previous = this.view(subject), revision = (previous?.revision ?? 0) + 1;
      const next = { ...snapshot, revision }, id = hash(canonical([this.connection, subject]));
      const row = { id, connection: this.connection, subject: subjectKey(subject), revision, snapshot: canonical(next) };
      this.db.prepare('INSERT INTO _zero_payments_views(id,connection,subject,revision,snapshot,next_refresh) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot,next_refresh=excluded.next_refresh').run(id, this.connection, row.subject, revision, row.snapshot, Date.now() + refreshMs);
      this.db.recordInternalChange({ table: PAYMENTS_VIEW_TABLE, op: previous ? 'UPDATE' : 'INSERT', rowId: id, row,
        previousRow: previous ? { id, connection: this.connection, subject: row.subject, revision: previous.revision, snapshot: canonical(previous) } : null });
      if (notify) this.admit(`view-${id}-${revision}`, 'notify', canonical({ subject, snapshot: publicSnapshot(next) }));
      return next;
    });
  }
  admit(id: string, kind: InboxRow['kind'], payload: string, customer: string | null = null): void {
    this.db.transaction(() => {
      const digest = hash(payload);
      this.db.prepare("INSERT OR IGNORE INTO _zero_payments_inbox(connection,id,kind,payload,digest,customer,status,due) VALUES(?,?,?,?,?,?,'pending',?)").run(this.connection, id, kind, payload, digest, customer, Date.now());
      const row = this.db.prepare('SELECT digest,kind,customer FROM _zero_payments_inbox WHERE connection=? AND id=?').get(this.connection, id) as { digest: string; kind: string; customer: string | null };
      if (row.digest !== digest || row.kind !== kind || row.customer !== customer) throw new PaymentsError('Payment event ID conflicts with an existing event.', 'PAYMENTS_EVENT_CONFLICT', 409);
    });
  }
  claim(): InboxRow | null {
    const now = Date.now(), row = this.db.prepare("SELECT id,payload,kind,customer,attempts FROM _zero_payments_inbox WHERE connection=? AND ((status IN ('pending','retry') AND due<=?) OR (status='processing' AND lease<=?)) ORDER BY due,id LIMIT 1").get(this.connection, now, now) as Omit<InboxRow, 'fence'> | null;
    if (!row) return null;
    return this.db.transaction(() => {
      const fence = crypto.randomUUID();
      const result = this.db.prepare("UPDATE _zero_payments_inbox SET status='processing',lease=?,fence=?,attempts=attempts+1 WHERE connection=? AND id=? AND ((status IN ('pending','retry') AND due<=?) OR (status='processing' AND lease<=?))").run(now + 240000, fence, this.connection, row.id, now, now);
      return result.changes ? { ...row, attempts: row.attempts + 1, fence } : null;
    });
  }
  complete(row: InboxRow): void { this.db.transaction(() => { this.assertInbox(row); this.db.prepare("UPDATE _zero_payments_inbox SET status='complete',payload='',lease=0 WHERE connection=? AND id=? AND fence=?").run(this.connection, row.id, row.fence); }); }
  renewInbox(row: InboxRow): void {
    const changed = this.db.transaction(() => this.db.prepare("UPDATE _zero_payments_inbox SET lease=? WHERE connection=? AND id=? AND fence=? AND status='processing' AND lease>?").run(Date.now() + 240000, this.connection, row.id, row.fence, Date.now()));
    if (!changed.changes) throw new PaymentsError('Billing job lost its claim.', 'PAYMENTS_LEASE_LOST', 409);
  }
  assertInbox(row: InboxRow): void {
    if (!this.db.prepare("SELECT 1 FROM _zero_payments_inbox WHERE connection=? AND id=? AND fence=? AND status='processing' AND lease>?").get(this.connection, row.id, row.fence, Date.now())) throw new PaymentsError('Billing job lost its claim.', 'PAYMENTS_LEASE_LOST', 409);
  }
  queueRefreshes(refreshMs: number): void {
    const now = Date.now();
    const rows = this.db.prepare('SELECT id,subject,revision FROM _zero_payments_views WHERE connection=? AND next_refresh<=? ORDER BY next_refresh LIMIT 10').all(this.connection, now) as { id: string; subject: string; revision: number }[];
    if (!rows.length) return;
    this.db.transaction(() => {
      for (const row of rows) {
        const changed = this.db.prepare('UPDATE _zero_payments_views SET next_refresh=? WHERE connection=? AND id=? AND next_refresh<=? AND revision=?').run(now + refreshMs, this.connection, row.id, now, row.revision);
        if (!changed.changes) continue;
        const customer = this.customer(JSON.parse(row.subject));
        if (customer) this.admit(`refresh-${row.id}-${row.revision}`, 'reconcile', '{}', customer);
      }
    });
  }
  fail(row: InboxRow, code: string): void { this.db.transaction(() => this.db.prepare('UPDATE _zero_payments_inbox SET status=?,due=?,lease=0,error=? WHERE connection=? AND id=? AND fence=?').run(row.attempts >= 12 ? 'quarantined' : 'retry', Date.now() + Math.min(300000, 1000 * 2 ** Math.min(row.attempts, 8)), code, this.connection, row.id, row.fence)); }
  pending(): { pending: number; quarantined: number } {
    const rows = this.db.prepare("SELECT status,count(*) AS count FROM _zero_payments_inbox WHERE connection=? AND status!='complete' GROUP BY status").all(this.connection) as { status: string; count: number }[];
    return { pending: rows.filter(row => row.status !== 'quarantined').reduce((n, row) => n + row.count, 0), quarantined: rows.find(row => row.status === 'quarantined')?.count ?? 0 };
  }
  replay(id: string): boolean { return this.db.transaction(() => this.db.prepare("UPDATE _zero_payments_inbox SET status='pending',due=?,attempts=0,lease=0 WHERE connection=? AND id=? AND status IN ('quarantined','retry')").run(Date.now(), this.connection, id)).changes > 0; }
  listJobs(query: PaymentsJobQuery = {}): PaymentsJobPage {
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || query.status !== undefined && !['pending', 'processing', 'retry', 'quarantined', 'complete'].includes(query.status) || query.after !== undefined && !/^[a-zA-Z0-9_-]{1,256}$/.test(query.after)) throw new PaymentsError('Invalid billing job query.', 'PAYMENTS_INPUT_INVALID');
    const rows = this.db.prepare(`SELECT id,kind,status,attempts,due,error FROM _zero_payments_inbox WHERE connection=? AND ${query.status ? 'status=?' : "status!='complete'"} ${query.after ? 'AND id>?' : ''} ORDER BY id LIMIT ?`).all(this.connection, ...(query.status ? [query.status] : []), ...(query.after ? [query.after] : []), limit + 1) as (Omit<PaymentsJob, 'dueAt'> & { due: number })[];
    return { items: rows.slice(0, limit).map(({ due, ...row }) => ({ ...row, dueAt: new Date(due).toISOString() })), ...(rows.length > limit ? { next: rows[limit - 1]!.id } : {}) };
  }
  lock(id: string): { id: string; fence: string } | null {
    return this.db.transaction(() => {
      const fence = crypto.randomUUID(), now = Date.now();
      this.db.prepare('INSERT OR IGNORE INTO _zero_payments_locks(connection,id,fence,lease) VALUES(?,?,?,?)').run(this.connection, id, fence, now + 240000);
      this.db.prepare('UPDATE _zero_payments_locks SET fence=?,lease=? WHERE connection=? AND id=? AND lease<=?').run(fence, now + 240000, this.connection, id, now);
      const row = this.db.prepare('SELECT fence FROM _zero_payments_locks WHERE connection=? AND id=?').get(this.connection, id) as { fence: string };
      return row.fence === fence ? { id, fence } : null;
    });
  }
  release(lock: { id: string; fence: string }): void { this.db.transaction(() => this.db.prepare('DELETE FROM _zero_payments_locks WHERE connection=? AND id=? AND fence=?').run(this.connection, lock.id, lock.fence)); }
  renew(lock: { id: string; fence: string }): void {
    this.db.transaction(() => {
      this.assertLock(lock);
      this.db.prepare('UPDATE _zero_payments_locks SET lease=? WHERE connection=? AND id=? AND fence=?').run(Date.now() + 240000, this.connection, lock.id, lock.fence);
    });
  }
  assertLock(lock: { id: string; fence: string }): void {
    if (!this.db.prepare('SELECT 1 FROM _zero_payments_locks WHERE connection=? AND id=? AND fence=? AND lease>?').get(this.connection, lock.id, lock.fence, Date.now())) throw new PaymentsError('Billing reconciliation lost its resource fence.', 'PAYMENTS_LEASE_LOST', 409);
  }
}
