/** Short SYSTEM lease claims serialize one asset's external Storage work. No SQLite lock or auth-exclusive lease spans I/O. */
import type { ReactiveDB } from '../sync/reactive-db';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import { AuthError } from '../auth/types';

/** Expired/crashed work can be reclaimed; a late prior worker fails its final synchronous publication fence. */
export async function withBlogMediaLease<T>(db: ReactiveDB, id: string, authorize: () => void, operation: (fence: () => void) => Promise<T>, cleanupFailed: () => void): Promise<T> {
  const nonce = crypto.randomUUID(), expiresAt = Date.now() + 10 * 60_000;
  await withReactiveDBCommitAdmission(db, () => db.transaction(() => {
    authorize();
    const result = db.prepare('INSERT INTO _blog_media_leases(id,nonce,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET nonce=excluded.nonce,expires_at=excluded.expires_at WHERE _blog_media_leases.expires_at<=?').run(id, nonce, expiresAt, Date.now());
    if (result.changes !== 1) throw new AuthError('This media asset has active work; retry the same operation shortly.', 'BLOG_MEDIA_BUSY', 409);
    authorize();
  }));
  const fence = () => {
    authorize();
    const row = db.prepare('SELECT nonce,expires_at FROM _blog_media_leases WHERE id=?').get(id) as { nonce: string; expires_at: number } | null;
    if (!row || row.nonce !== nonce || row.expires_at <= Date.now()) throw new AuthError('The media operation lease expired.', 'BLOG_MEDIA_BUSY', 409);
  };
  try { fence(); return await operation(fence); }
  finally {
    try { await withReactiveDBCommitAdmission(db, () => db.transaction(() => { db.prepare('DELETE FROM _blog_media_leases WHERE id=? AND nonce=?').run(id, nonce); })); }
    catch { try { cleanupFailed(); } catch { /* Observers cannot change an accepted media outcome. */ } /* Expiry retains safe recovery. */ }
  }
}
