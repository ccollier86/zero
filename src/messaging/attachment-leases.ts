/** Short durable SYSTEM claims fence one attachment's cross-file byte I/O; no SQL or exclusive auth lease spans a stream. */
import type { ReactiveDB } from '../sync/reactive-db';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import { AuthError } from '../auth/types';
export const MESSAGING_LEASE_SQL = 'CREATE TABLE IF NOT EXISTS _messaging_blob_leases (id TEXT PRIMARY KEY,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL)';
export function installMessagingLeases(db: ReactiveDB, allowed: boolean): void {
  const row = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get('_messaging_blob_leases') as { type: string; sql: string } | null;
  const normalize = (s: string) => s.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
  if (row && (row.type !== 'table' || !row.sql || normalize(row.sql) !== normalize(MESSAGING_LEASE_SQL))) throw new AuthError('Messaging attachment ownership is incompatible.', 'MESSAGING_STATE_INVALID', 500);
  if (!row) { if (!allowed) throw new AuthError('Messaging attachments require their additive migration.', 'MESSAGING_NOT_READY', 503); db.exec(MESSAGING_LEASE_SQL); }
}
export async function withMessagingAttachmentLease<T>(db: ReactiveDB, id: string, check: () => void, work: (fence: () => void) => Promise<T>, cleanupFailed: () => void): Promise<T> {
  const nonce = crypto.randomUUID(), expires = Date.now() + 10 * 60000;
  await withReactiveDBCommitAdmission(db, () => db.transaction(() => {
    check(); const result = db.prepare('INSERT INTO _messaging_blob_leases(id,nonce,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET nonce=excluded.nonce,expires_at=excluded.expires_at WHERE _messaging_blob_leases.expires_at<=?').run(id, nonce, expires, Date.now());
    if (result.changes !== 1) throw new AuthError('The attachment has active work.', 'MESSAGING_ATTACHMENT_BUSY', 409); check();
  }));
  const fence = () => { check(); const row = db.prepare('SELECT nonce,expires_at FROM _messaging_blob_leases WHERE id=?').get(id) as { nonce: string; expires_at: number } | null;
    if (!row || row.nonce !== nonce || row.expires_at <= Date.now()) throw new AuthError('The attachment operation lease expired.', 'MESSAGING_ATTACHMENT_BUSY', 409); };
  try { fence(); return await work(fence); }
  finally { try { await withReactiveDBCommitAdmission(db, () => db.transaction(() => { db.prepare('DELETE FROM _messaging_blob_leases WHERE id=? AND nonce=?').run(id, nonce); })); }
    catch { try { cleanupFailed(); } catch { /* Expiry retains recovery; diagnostics never change a completed outcome. */ } } }
}
